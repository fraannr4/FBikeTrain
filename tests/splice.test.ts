import { readFileSync } from 'node:fs';
import { db } from '../src/db/db';
import { haversineM } from '../src/import/summary';
import { sharedOrsAccess } from '../src/routes/orsProxy';
import type { LatLng, StoredActivity, TrackPoint } from '../src/domain/types';
import type { RoutePoint } from '../src/routes/library';
import { OrsError, type OrsFeature } from '../src/routes/ors';
import { activityToSpliceInput, defaultChoice, orsConnectors, spliceGpx, spliceRoutes, SPLICE, type SpliceInput } from '../src/routes/splice';
import type { UserReference } from '../src/metrics/reference';

// Geometrías sintéticas en el mar frente a la costa (lat 41.0, lng 2.5), como el resto de fixtures.
const O = { lat: 41, lng: 2.5 };
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((O.lat * Math.PI) / 180);
const at = (x: number, y: number, ele?: number): RoutePoint => ({ lat: O.lat + y / M_LAT, lng: O.lng + x / M_LNG, ...(ele === undefined ? {} : { ele }) });
const xy = (p: LatLng) => ({ x: (p.lng - O.lng) * M_LNG, y: (p.lat - O.lat) * M_LAT });

/** Puntos cada `step` m de (x0,y0) a (x1,y1), con altura opcional. */
function line(x0: number, y0: number, x1: number, y1: number, opts: { step?: number; ele?: (t: number) => number } = {}): RoutePoint[] {
  const step = opts.step ?? 10;
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
  return Array.from({ length: n + 1 }, (_, i) => at(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, opts.ele?.(i / n)));
}
const chain = (...parts: RoutePoint[][]) => parts.reduce((all, p) => [...all, ...(all.length ? p.slice(1) : p)], [] as RoutePoint[]);
/** Cuadrado cerrado en sentido antihorario desde la esquina inferior izquierda. */
const square = (x: number, y: number, side: number, ele?: (t: number) => number) =>
  chain(line(x, y, x + side, y, { ele }), line(x + side, y, x + side, y + side, { ele }), line(x + side, y + side, x, y + side, { ele }), line(x, y + side, x, y, { ele }));

const route = (id: string, points: RoutePoint[]): SpliceInput => ({ id, name: `Ruta ${id}`, points });
const flat = () => 100;

function distanceOf(points: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  return d;
}

type Extras = { motorway?: boolean; stateRoadPct?: number };
/** Respuesta de ORS con la forma documentada (`[lng, lat, ele]`, `extras` por índice y resumen). */
function feature(points: RoutePoint[], extras: Extras = {}): OrsFeature {
  const n = points.length - 1;
  const d = distanceOf(points);
  const state = extras.stateRoadPct ?? 0;
  return {
    geometry: { type: 'LineString', coordinates: points.map(p => [p.lng, p.lat, p.ele ?? 100]) },
    properties: {
      summary: { distance: d, duration: d / 6 },
      extras: {
        surface: { values: [[0, n, 3]], summary: [{ value: 3, distance: d, amount: 100 }] },
        waytypes: {
          values: [[0, n, state > 0 ? 1 : 2]],
          summary: state > 0
            ? [{ value: 1, distance: (d * state) / 100, amount: state }, { value: 2, distance: d * (1 - state / 100), amount: 100 - state }]
            : [{ value: 2, distance: d, amount: 100 }],
        },
        steepness: { values: [[0, n, 0]], summary: [{ value: 0, distance: d, amount: 100 }] },
        waycategory: { values: [[0, n, extras.motorway ? 1 : 0]], summary: [{ value: extras.motorway ? 1 : 0, distance: d, amount: 100 }] },
      },
    },
  } as OrsFeature;
}
const straight = (from: LatLng, to: LatLng, extras?: Extras) => {
  const a = xy(from); const b = xy(to);
  return feature(line(a.x, a.y, b.x, b.y, { ele: flat }), extras);
};
/** ORS simulado: un trayecto recto entre los dos puntos pedidos. */
const roads = () => vi.fn(async (from: LatLng, to: LatLng) => [straight(from, to)]);

describe('empalme de dos rutas: orden, sentido y puntos de unión', () => {
  it('rutas desconectadas: pide el conector entre los extremos más cercanos y deja una ruta continua', async () => {
    const a = route('A', line(0, 0, 5000, 0, { ele: flat }));
    const b = route('B', line(7000, 0, 12_000, 0, { ele: flat }));
    const connectors = roads();
    const result = await spliceRoutes([a, b], { returnToStart: false }, { connectors });
    const best = result.options.find(o => o.id === defaultChoice(result.options))!;
    expect(best.order).toBe('AB');
    expect(best.distanceM).toBeGreaterThan(11_900);
    expect(best.distanceM).toBeLessThan(12_100);
    expect(best.connectorM).toBeCloseTo(2000, -2);
    expect(best.pieces.map(p => p.source)).toEqual(['A', 'conector', 'B']);
    const [from, to] = connectors.mock.calls.find(([f]) => Math.abs(xy(f).x - 5000) < 1)!;
    expect(xy(from).x).toBeCloseTo(5000, 0);
    expect(xy(to).x).toBeCloseTo(7000, 0);
  });

  it('un tramo abierto nunca se invierte; una ruta circular sí', async () => {
    const open = await spliceRoutes([route('A', line(0, 0, 5000, 0)), route('B', line(7000, 0, 12_000, 0))], { returnToStart: false }, { connectors: roads() });
    expect(open.options.every(o => !o.reversed.A && !o.reversed.B)).toBe(true);
    const loops = await spliceRoutes([route('A', square(0, 0, 2000)), route('B', square(5000, 0, 2000))], { returnToStart: false }, { connectors: roads() });
    expect(loops.options.some(o => o.reversed.A || o.reversed.B)).toBe(true);
  });

  it('sentidos opuestos: no invierte el tramo y avisa del retroceso de más de 500 m', async () => {
    const a = route('A', line(0, 0, 5000, 0));
    const b = route('B', line(12_000, 0, 7000, 0));
    const result = await spliceRoutes([a, b], { returnToStart: false }, { connectors: roads() });
    expect(result.options.length).toBeGreaterThan(0);
    for (const o of result.options) {
      expect(o.reversed).toEqual({ A: false, B: false, C: false });
      expect(o.backtrackM).toBeGreaterThan(SPLICE.backtrackMinM);
    }
  });

  it('si las rutas pasan a menos de 300 m, une por el punto más cercano de cada circular', async () => {
    const a = route('A', square(0, 0, 2000));
    const b = route('B', square(2200, 500, 1000));
    const connectors = roads();
    const result = await spliceRoutes([a, b], { returnToStart: false }, { connectors });
    expect(result.options.length).toBeGreaterThan(0);
    for (const [from, to] of connectors.mock.calls) expect(haversineM(from.lat, from.lng, to.lat, to.lng)).toBeLessThan(SPLICE.nearM);
  });
});

describe('empalme de tres tramos', () => {
  // Tres circulares de 2 km de lado separadas 2 km entre sí.
  const a = route('A', square(0, 0, 2000));
  const b = route('B', square(4000, 0, 2000));
  const c = route('C', square(8000, 0, 2000));

  it('con tres tramos solo prueba el orden elegido y los conectores entre consecutivos', async () => {
    const connectors = roads();
    const out = await spliceRoutes([a, b, c], { returnToStart: false }, { connectors });
    expect(out.options.length).toBeGreaterThan(0);
    expect(out.options.every(o => o.order === 'ABC')).toBe(true);
    expect(out.options[0].pieces.map(p => p.source)).toEqual(['A', 'conector', 'B', 'conector', 'C']);
    // Un par de puntos por unión, cacheado entre los sentidos de cada circular.
    const calls = new Set(connectors.mock.calls.map(([from, to]) => `${from.lat},${from.lng}>${to.lat},${to.lng}`));
    expect(calls.size).toBe(2);
    expect(out.requestsUsed).toBe(2);
    expect(SPLICE.maxInputs).toBe(3);
  });

  it('con dos tramos sigue probando AB y BA', async () => {
    const out = await spliceRoutes([a, b], { returnToStart: false }, { connectors: roads() });
    expect(new Set(out.options.map(o => o.order))).toEqual(new Set(['AB', 'BA']));
    expect(out.options.every(o => o.reversed.C === false)).toBe(true);
  });

  it('rechaza 1 o 4 entradas', async () => {
    const deps = { connectors: roads() };
    await expect(spliceRoutes([a], { returnToStart: false }, deps)).rejects.toThrow('Se empalman entre 2 y 3 rutas.');
    await expect(spliceRoutes([a, b, c, a], { returnToStart: false }, deps)).rejects.toThrow('Se empalman entre 2 y 3 rutas.');
    expect(deps.connectors).not.toHaveBeenCalled();
  });

  it('dos tramos iguales entre tres no rompen y el solape se mide', async () => {
    const out = await spliceRoutes([a, a, b], { returnToStart: false }, { connectors: roads() });
    expect(out.options.length).toBeGreaterThan(0);
    expect(out.options[0].overlapM).toBeGreaterThan(0);
  });

  it('el id lleva un bit por tramo y el regreso cierra el recorrido de tres', async () => {
    const out = await spliceRoutes([a, b, c], { returnToStart: true }, { connectors: roads() });
    expect(out.options.length).toBeGreaterThan(0);
    for (const o of out.options) {
      expect(o.id).toMatch(/^ABC-[01]{3}(-alt)?$/);
      expect(o.pieces.at(-1)?.source).toBe('regreso');
    }
  });

  it('activityToSpliceInput descarta puntos sin GPS y exige 2 válidos', () => {
    const act: StoredActivity = { id: 'act-1', startTime: 1, sport: 'cycling', name: 'Mañana por la costa', totals: { distanceM: 1000, movingTimeS: 100, elapsedTimeS: 100, elevGainM: 0, avgSpeedMs: 10, maxSpeedMs: 10 }, hasTrack: true, source: 'gpx', importedAt: 1 };
    const track: TrackPoint[] = [{ t: 1 }, { t: 2, lat: 40, lng: -3, ele: 500 }, { t: 3, lat: 40.01, lng: -3 }];
    const input = activityToSpliceInput(act, track);
    expect(input).toMatchObject({ id: 'act-1', name: 'Mañana por la costa' });
    expect(input.points).toEqual([{ lat: 40, lng: -3, ele: 500 }, { lat: 40.01, lng: -3 }]);
    expect(() => activityToSpliceInput(act, [{ t: 1, lat: 40, lng: -3 }])).toThrow('Esa salida no tiene un track válido para empalmar.');
    expect(activityToSpliceInput({ ...act, name: undefined }, track).name).toBe('Salida sin nombre');
  });
});

describe('empalme: consultas a ORS', () => {
  it('invertir circulares no gasta consultas de más: como mucho 4 por empalme, con regreso', async () => {
    const connectors = roads();
    const result = await spliceRoutes([route('A', square(0, 0, 2000)), route('B', square(2200, 500, 1000))], { returnToStart: true }, { connectors });
    expect(result.options.length).toBeGreaterThan(0);
    expect(connectors.mock.calls.length).toBeLessThanOrEqual(4);
    expect(result.requestsUsed).toBe(connectors.mock.calls.length);
  });
});

describe('empalme: validez de los conectores', () => {
  it('descarta el conector con autopista y usa la alternativa limpia', async () => {
    const connectors = vi.fn(async (from: LatLng, to: LatLng) => {
      const a = xy(from); const b = xy(to);
      return [straight(from, to, { motorway: true }), feature(chain(line(a.x, a.y, (a.x + b.x) / 2, 600), line((a.x + b.x) / 2, 600, b.x, b.y)))];
    });
    const result = await spliceRoutes([route('A', line(0, 0, 5000, 0)), route('B', line(7000, 0, 12_000, 0))], { returnToStart: false }, { connectors });
    expect(result.discarded.some(d => d.reason === 'autopista')).toBe(true);
    expect(result.options.length).toBeGreaterThan(0);
    for (const o of result.options) expect(o.connectorM).toBeGreaterThan(2100);
  });

  it('descarta el conector con demasiada carretera principal', async () => {
    const connectors = vi.fn(async (from: LatLng, to: LatLng) => [straight(from, to, { stateRoadPct: 60 })]);
    const result = await spliceRoutes([route('A', line(0, 0, 5000, 0)), route('B', line(7000, 0, 12_000, 0))], { returnToStart: false }, { connectors });
    expect(result.options).toHaveLength(0);
    expect(result.discarded.map(d => d.reason)).toContain('carretera principal');
  });

  it('descarta el conector que empieza a más de 50 m del punto pedido', async () => {
    const connectors = vi.fn(async (_from: LatLng, to: LatLng) => [straight(at(5000, 400), to)]);
    const result = await spliceRoutes([route('A', line(0, 0, 5000, 0)), route('B', line(7000, 0, 12_000, 0))], { returnToStart: false }, { connectors });
    expect(result.options).toHaveLength(0);
    expect(result.discarded.map(d => d.reason)).toContain('salto');
  });

  it('conector imposible: sin carretera entre las rutas, ninguna opción y el motivo', async () => {
    const connectors = vi.fn(async () => { throw new OrsError('no_route', 'sin carretera'); });
    const result = await spliceRoutes([route('A', line(0, 0, 5000, 0)), route('B', line(7000, 0, 12_000, 0))], { returnToStart: false }, { connectors });
    expect(result.options).toHaveLength(0);
    expect(result.discarded.map(d => d.reason)).toContain('sin carretera');
  });
});

describe('empalme: cifras', () => {
  it('solapes: dos circulares que comparten un lado se unen sin conector y descuentan el tramo repetido', async () => {
    const connectors = roads();
    const result = await spliceRoutes([route('A', square(0, 0, 2000)), route('B', square(2000, 0, 2000))], { returnToStart: false }, { connectors });
    expect(connectors).not.toHaveBeenCalled();
    const o = result.options[0];
    expect(o.connectorM).toBe(0);
    expect(o.distanceM).toBeCloseTo(16_000, -2);
    expect(o.overlapM).toBeGreaterThan(1800);
    expect(o.overlapM).toBeLessThan(2200);
    expect(o.distinctM).toBeCloseTo(o.distanceM - o.overlapM, 3);
  });

  it('rutas sin altitud: el desnivel queda sin calcular, no a cero', async () => {
    const ref: UserReference = { source: 'history', weeks: 8, rides: 10, ridesPerWeek: 1.25, avgDistanceM: 10_000, avgElevGainM: 200, avgMovingTimeS: 1800, avgSpeedMs: 7, longestDistanceM: 20_000, maxElevGainM: 400 };
    const result = await spliceRoutes([route('A', line(0, 0, 5000, 0)), route('B', line(7000, 0, 12_000, 0))], { returnToStart: false }, { connectors: roads(), reference: ref });
    const o = result.options[0];
    expect(o.elevGainM).toBeNull();
    expect(o.difficulty).toBeNull();
    expect(o.estTimeS).toBeCloseTo(o.distanceM / 7, 0);
  });

  it('con altitud recalcula desnivel, duración y dificultad con la referencia', async () => {
    const ref: UserReference = { source: 'history', weeks: 8, rides: 10, ridesPerWeek: 1.25, avgDistanceM: 10_000, avgElevGainM: 50, avgMovingTimeS: 1800, avgSpeedMs: 7, longestDistanceM: 20_000, maxElevGainM: 400 };
    const up = (t: number) => 100 + 100 * t;
    const result = await spliceRoutes([route('A', line(0, 0, 5000, 0, { ele: up })), route('B', line(7000, 0, 12_000, 0, { ele: flat }))], { returnToStart: false }, { connectors: roads(), reference: ref });
    const o = result.options.find(x => x.order === 'AB')!;
    expect(o.elevGainM).toBeGreaterThanOrEqual(100);
    expect(o.difficulty).toBe('Dura');
  });

  it('«Volver al inicio» añade el conector de regreso y acaba donde empieza', async () => {
    const result = await spliceRoutes([route('A', line(0, 0, 5000, 0)), route('B', line(7000, 0, 12_000, 0))], { returnToStart: true }, { connectors: roads() });
    const o = result.options[0];
    expect(o.pieces.at(-1)?.source).toBe('regreso');
    const first = o.points[0]; const last = o.points[o.points.length - 1];
    expect(haversineM(first.lat, first.lng, last.lat, last.lng)).toBeLessThan(SPLICE.maxGapM);
  });

  it('la elección sin IA es la combinación más corta sin vías principales', () => {
    const base = { distinctM: 0, elevGainM: 0, estTimeS: null, difficulty: null, connectorM: 0, overlapM: 0, backtrackM: 0, points: [], pieces: [], order: 'AB', reversed: { A: false, B: false, C: false } };
    expect(defaultChoice([
      { ...base, id: 'corta-principal', distanceM: 10_000, mainRoadPct: 5 },
      { ...base, id: 'larga-limpia', distanceM: 12_000, mainRoadPct: 0 },
      { ...base, id: 'mas-larga-limpia', distanceM: 13_000, mainRoadPct: 0 },
    ])).toBe('larga-limpia');
  });
});

describe('empalme: alternativas', () => {
  /** Recta y un desvío por el norte: comparten poco trazado. */
  const twoWays = (detourY: number) => vi.fn(async (from: LatLng, to: LatLng) => {
    const a = xy(from); const b = xy(to);
    return [straight(from, to), feature(chain(line(a.x, a.y, a.x, detourY), line(a.x, detourY, b.x, detourY), line(b.x, detourY, b.x, b.y)))];
  });

  it('dos conectores parecidos (≤ 15 % de diferencia y < 70 % compartido) se proponen los dos', async () => {
    const result = await spliceRoutes([route('A', line(0, 0, 5000, 0)), route('B', line(7000, 0, 12_000, 0))], { returnToStart: false }, { connectors: twoWays(140) });
    const ab = result.options.filter(o => o.order === 'AB');
    expect(ab).toHaveLength(2);
    expect(ab[1].alternativeOf).toBe(ab[0].id);
  });

  it('si la segunda es mucho más larga, solo queda la primera', async () => {
    const result = await spliceRoutes([route('A', line(0, 0, 5000, 0)), route('B', line(7000, 0, 12_000, 0))], { returnToStart: false }, { connectors: twoWays(800) });
    expect(result.options.filter(o => o.order === 'AB')).toHaveLength(1);
  });
});

describe('empalme: cuota, cancelación y GPX', () => {
  it('cuota agotada: el error de ORS llega tal cual para mostrar el límite', async () => {
    const quota = new OrsError('quota_day', 'Has gastado las 2.000 consultas diarias de ORS.');
    const connectors = vi.fn(async () => { throw quota; });
    await expect(spliceRoutes([route('A', line(0, 0, 5000, 0)), route('B', line(7000, 0, 12_000, 0))], { returnToStart: false }, { connectors })).rejects.toBe(quota);
  });

  it('cancelación: no pide más conectores y termina con AbortError', async () => {
    const controller = new AbortController();
    const connectors = vi.fn(async (from: LatLng, to: LatLng) => { controller.abort(); return [straight(from, to)]; });
    await expect(spliceRoutes([route('A', line(0, 0, 5000, 0)), route('B', line(7000, 0, 12_000, 0))], { returnToStart: true }, { connectors, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(connectors).toHaveBeenCalledTimes(1);
  });

  it('el GPX final es 1.1, con trk, trkseg y ele, continuo y sin saltos de más de 50 m', async () => {
    const sparse = vi.fn(async (from: LatLng, to: LatLng) => {
      const a = xy(from); const b = xy(to);
      return [feature(line(a.x, a.y, b.x, b.y, { step: 400, ele: flat }))];
    });
    const result = await spliceRoutes([route('A', line(0, 0, 5000, 0, { ele: flat })), route('B', line(7000, 0, 12_000, 0, { ele: flat }))], { returnToStart: true }, { connectors: sparse });
    const gpx = spliceGpx('Empalme', result.options[0]);
    expect(gpx).toContain('version="1.1"');
    expect(gpx).toContain('http://www.topografix.com/GPX/1/1');
    expect(gpx).toMatch(/<trk>[\s\S]*<trkseg>/);
    expect(gpx).toContain('<ele>');
    const pts = [...gpx.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)">/g)].map(m => ({ lat: Number(m[1]), lng: Number(m[2]) }));
    expect(pts.length).toBeGreaterThan(100);
    for (let i = 1; i < pts.length; i++) expect(haversineM(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng)).toBeLessThanOrEqual(SPLICE.maxGapM);
  });
});

describe('empalme: conectores pedidos a ORS', () => {
  const PATH = readFileSync('tests/fixtures/ors/path-alternatives-ok.json', 'utf8');
  const SOL = { lat: 40.4168, lng: -3.7038 };
  const END = { lat: 40.4258, lng: -3.6938 };

  it('con clave personal pide el trayecto con alternativas, perfil de carretera y waycategory, y devuelve todas', async () => {
    await db.meta.clear();
    const f = vi.fn<typeof fetch>(async () => new Response(PATH, { status: 200 }));
    const features = await orsConnectors('test-key', f)(SOL, END);
    expect(features).toHaveLength(2);
    expect(String(f.mock.calls[0][0])).toBe('https://api.heigit.org/openrouteservice/v2/directions/cycling-road/geojson');
    const body = JSON.parse(String(f.mock.calls[0][1]!.body));
    expect(body.coordinates).toEqual([[SOL.lng, SOL.lat], [END.lng, END.lat]]);
    expect(body.extra_info).toContain('waycategory');
    expect(body.alternative_routes).toEqual({ target_count: 3, weight_factor: 1.4, share_factor: 0.6 });
    expect(body.options.round_trip).toBeUndefined();
  });

  it('con el servicio común pide solo la operación y recibe todas las alternativas', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: { features: JSON.parse(PATH).features } }), { status: 200 }));
    const features = await orsConnectors(sharedOrsAccess(async () => 'jwt', f))(SOL, END);
    expect(features).toHaveLength(2);
    expect(JSON.parse(String(f.mock.calls[0][1]!.body))).toEqual({ operation: 'path', waypoints: [SOL, END], alternatives: 3 });
  });

  it('el fixture de ORS da dos alternativas parecidas que se proponen', async () => {
    const features = (JSON.parse(PATH) as { features: OrsFeature[] }).features;
    const coords = (i: number) => features[i].geometry.coordinates;
    const a = route('A', line(-2000, 0, 0, 0).map(p => ({ ...p, lat: p.lat - O.lat + coords(0)[0][1], lng: p.lng - O.lng + coords(0)[0][0] })));
    const lastPoint = coords(0)[coords(0).length - 1];
    const b = route('B', line(0, 0, 2000, 0).map(p => ({ ...p, lat: p.lat - O.lat + lastPoint[1], lng: p.lng - O.lng + lastPoint[0] })));
    const result = await spliceRoutes([a, b], { returnToStart: false }, { connectors: async () => features });
    const ab = result.options.filter(o => o.order === 'AB');
    expect(ab).toHaveLength(2);
    expect(ab[1].mainRoadPct).toBeGreaterThan(0);
  });
});
