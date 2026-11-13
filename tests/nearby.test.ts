import type { Coord3, LatLng } from '../src/domain/types';
import { haversineM } from '../src/import/summary';
import { angleGap, routeBearing, sameRoute } from '../src/routes/diversity';
import type { AdaptedRoute } from '../src/routes/adapt';
import { analyzeRoute } from '../src/routes/analyze';
import { generateRoutes, rateCandidate, type GeneratedRoute } from '../src/routes/generator';
import type { HistoryWaypoint } from '../src/routes/historyWaypoints';
import { DEAD_END_BACKTRACK, NEARBY_ORS_BUDGET, proposeNearbyRoutes, type NearbyCard, type NearbyDeps, type NearbyUpdate } from '../src/routes/nearby';
import { OrsError, type fetchPathFeature, type OrsFeature } from '../src/routes/ors';
import type { SharedOrsAccess } from '../src/routes/orsProxy';
import { geometryQuality } from '../src/routes/quality';
import { RouteSourceError } from '../src/routes/sources/schema';
import type { OsmWaypoint } from '../src/routes/sources/waypoints';
import type { SharedWaypointPlanner } from '../src/ai/waypointCombos';

// Todo es sintético: un inicio inventado en el mar, puntos de paso a rumbos fijos y vueltas en rombo.
const START: LatLng = { lat: 41, lng: 2.5 };
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((START.lat * Math.PI) / 180);
const D_KM = 60;
const target = { start: START, distanceKm: D_KM, elevGainM: null };

const toXY = (p: LatLng) => ({ x: (p.lng - START.lng) * M_LNG, y: (p.lat - START.lat) * M_LAT });
const fromXY = (x: number, y: number): LatLng => ({ lat: START.lat + y / M_LAT, lng: START.lng + x / M_LNG });
/** Punto a `km` del inicio con rumbo `deg` (0 norte, 90 este). */
const at = (deg: number, km: number): LatLng => {
  const a = (deg * Math.PI) / 180;
  return fromXY(Math.sin(a) * km * 1000, Math.cos(a) * km * 1000);
};

/** Puntos cada 400 m como mucho, para que `visitsWaypoints` y el solape vean el recorrido entero. */
function densify(points: LatLng[]): LatLng[] {
  const out: LatLng[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = toXY(points[i - 1]);
    const b = toXY(points[i]);
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 400));
    for (let k = 1; k <= n; k++) out.push(fromXY(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n));
  }
  return out;
}

/** Vuelta que pasa por los puntos sin repetir carretera: cada tramo se desvía a su derecha hasta sumar `km`. */
function loopThrough(waypoints: LatLng[], km: number): LatLng[] {
  const xy = waypoints.map(toXY);
  const legs = xy.slice(1).map((b, i) => Math.hypot(b.x - xy[i].x, b.y - xy[i].y));
  const f = Math.max(1, (km * 1000) / legs.reduce((s, l) => s + l, 0));
  const out: LatLng[] = [waypoints[0]];
  xy.slice(1).forEach((b, i) => {
    const a = xy[i];
    const l = legs[i] || 1;
    const h = (l / 2) * Math.sqrt(f * f - 1);
    const ux = (b.x - a.x) / l;
    const uy = (b.y - a.y) / l;
    out.push(fromXY((a.x + b.x) / 2 + uy * h, (a.y + b.y) / 2 - ux * h), waypoints[i + 1]);
  });
  return densify(out);
}

/** Sube `gain` metros hasta la mitad del recorrido y baja después. */
function feature(points: LatLng[], gain: number): OrsFeature {
  const coordinates: Coord3[] = points.map((p, i) => [p.lng, p.lat, 100 + gain * (1 - Math.abs((2 * i) / (points.length - 1) - 1))]);
  const n = coordinates.length - 1;
  const all = (value: number) => ({ values: [[0, n, value]] as [number, number, number][], summary: [{ value, distance: 60_000, amount: 100 }] });
  return {
    geometry: { type: 'LineString', coordinates },
    properties: { summary: { distance: 60_000, duration: 9000 }, extras: { surface: all(3), waytypes: all(2), steepness: all(0) } },
  };
}

/** ORS simulado: dibuja la vuelta por los puntos que le piden; `fail` decide qué llamada falla. */
function fakePath(o: { km?: number; gain?: number; fail?: (call: number) => Error | null; shape?: (waypoints: LatLng[]) => LatLng[];
  kmOf?: (waypoints: LatLng[]) => number; gainOf?: (waypoints: LatLng[]) => number } = {}) {
  let call = 0;
  return vi.fn<typeof fetchPathFeature>(async (_access, waypoints) => {
    call++;
    const error = o.fail?.(call);
    if (error) throw error;
    return feature(o.shape ? o.shape(waypoints) : loopThrough(waypoints, o.kmOf?.(waypoints) ?? o.km ?? D_KM), o.gainOf?.(waypoints) ?? o.gain ?? 500);
  });
}

const osm = (i: number, deg: number, extra: Partial<OsmWaypoint> = {}): OsmWaypoint => ({
  id: `osm-pass-${i}`, kind: 'puerto', name: `Coll sintètic ${i}`, ...at(deg, 23), ele: 900, distanceM: 23_000, interes: 2, ...extra,
});
/** Ocho puertos separados 46° (el último queda a 38° del primero). */
const RING = [0, 46, 92, 138, 184, 230, 276, 322];
const ring = () => RING.map((deg, i) => osm(i + 1, deg));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const noRwgps = { getToken: async () => 'sesion-sintetica', fetch: (async () => json({ data: { routes: [], total: 0 } })) as unknown as typeof fetch };

const fakeGenerate = (routes: GeneratedRoute[] = []) =>
  vi.fn<typeof generateRoutes>(async (req) => ({ routes, rejected: [], requestsUsed: req.budget ?? 0, stoppedBy: null }));

function deps(over: Partial<NearbyDeps> = {}): NearbyDeps {
  return {
    ors: 'clave-sintetica', rwgps: noRwgps, reference: null, visited: new Set(), ai: null,
    findWaypoints: async () => ring(), historyWaypoints: async () => [],
    fetchPath: fakePath(), generate: fakeGenerate(), wait: vi.fn(async () => {}),
    ...over,
  };
}

type Motor = Extract<NearbyCard, { kind: 'motor' }>;
const motorCards = (cards: NearbyCard[]) => cards.filter((c): c is Motor => c.kind === 'motor');
const lineOf = (card: NearbyCard): LatLng[] =>
  card.kind === 'motor' ? card.route.coords.map(([lng, lat]) => ({ lat, lng })) : card.proposal.adapted.coords;

describe('proposeNearbyRoutes', () => {
  it('sin rutas reales propone al menos 5 vueltas del motor en rumbos distintos, sin solaparse y dentro de ±10 %', async () => {
    const res = await proposeNearbyRoutes(target, deps());
    const motor = motorCards(res.cards);
    expect(motor.length).toBeGreaterThanOrEqual(5);
    expect(res.cards.length).toBeLessThanOrEqual(6);
    for (const card of motor) {
      expect(Math.abs(card.route.distanceM - D_KM * 1000)).toBeLessThanOrEqual(D_KM * 100);
      expect(card.combo).toBe('codigo');
      expect(card.via).toHaveLength(1);
    }
    const lines = res.cards.map(lineOf);
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        expect(angleGap(routeBearing(lines[i], START), routeBearing(lines[j], START))).toBeGreaterThanOrEqual(45);
        expect(sameRoute(lines[i], lines[j])).toBe(false);
      }
    }
    // De más a menos puntuación.
    const scores = motor.map((c) => c.route.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(res.requestsUsed).toBeLessThanOrEqual(NEARBY_ORS_BUDGET);
    expect(res.usedAi).toBe(false);
  });

  it('las rutas reales van primero y el motor no repite su rumbo', async () => {
    const realDegs: Record<string, number> = { '11': 0, '12': 184 };
    const circuit = (deg: number, n = 120): LatLng[] => {
      const r = (D_KM * 1000) / (2 * Math.PI);
      const a = (deg * Math.PI) / 180;
      const cx = Math.sin(a) * r;
      const cy = Math.cos(a) * r;
      return Array.from({ length: n + 1 }, (_, i) => {
        const t = Math.atan2(-cy, -cx) + (i / n) * 2 * Math.PI;
        return fromXY(cx + r * Math.cos(t), cy + r * Math.sin(t));
      });
    };
    const rwgps = {
      getToken: async () => 'sesion-sintetica',
      fetch: (async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        if (body.op === 'nearby') {
          return json({ data: { total: 2, routes: Object.entries(realDegs).map(([id, deg]) => ({
            id, name: `Vuelta sintética ${id}`, author: 'Autora sintética', distanceM: D_KM * 1000, elevGainM: 500,
            start: START, line: circuit(deg).map((p) => [p.lng, p.lat]), passM: 50,
          })) } });
        }
        return json({ data: { route: { name: `Vuelta sintética ${body.id}`, user: { name: 'Autora sintética' },
          track_points: circuit(realDegs[body.id], 360).map((p, i) => ({ x: p.lng, y: p.lat, e: 100 + (i % 20) })) } } });
      }) as unknown as typeof fetch,
    };
    const adapt = vi.fn(async (points: LatLng[]): Promise<AdaptedRoute> => ({
      coords: points.map((p) => ({ lat: p.lat, lng: p.lng })), distanceM: D_KM * 1000, elevGainM: 500, connectorM: 0, passesNearM: 0, rotated: false, warnings: [],
    }));
    const fetchPath = fakePath();
    const res = await proposeNearbyRoutes(target, deps({ rwgps, adapt, fetchPath }));

    expect(res.cards.slice(0, 2).map((c) => c.kind)).toEqual(['real', 'real']);
    const motor = motorCards(res.cards);
    expect(motor.length).toBeGreaterThan(0);
    for (const card of motor) {
      for (const deg of Object.values(realDegs)) expect(angleGap(routeBearing(lineOf(card), START), deg)).toBeGreaterThanOrEqual(45);
    }
    // El puerto del norte ni se pide a ORS: su dirección ya la ocupa una ruta real.
    const north = at(0, 23);
    expect(fetchPath.mock.calls.some(([, w]) => w.some((p) => Math.abs(p.lat - north.lat) < 1e-9 && Math.abs(p.lng - north.lng) < 1e-9))).toBe(false);
    expect(res.cards.length).toBeLessThanOrEqual(6);
  });

  it(`nunca pasa de ${NEARBY_ORS_BUDGET} consultas a ORS, aunque fallen todas`, async () => {
    const many = Array.from({ length: 16 }, (_, i) => osm(i + 1, i * 22.5));
    const fetchPath = fakePath({ fail: () => new OrsError('no_route', 'sin ruta', 2009) });
    const generate = fakeGenerate();
    const res = await proposeNearbyRoutes(target, deps({ findWaypoints: async () => many, fetchPath, generate }));
    expect(fetchPath.mock.calls.length).toBeLessThanOrEqual(NEARBY_ORS_BUDGET);
    expect(res.requestsUsed).toBeLessThanOrEqual(NEARBY_ORS_BUDGET);
    expect(res.cards).toHaveLength(0);
    expect(res.warnings.join(' ')).toMatch(/0 vueltas/);
  });

  it('reparte con round_trip lo que queda del presupuesto y no lo excede', async () => {
    const fetchPath = fakePath({ fail: (call) => (call <= 3 ? new OrsError('no_route', 'sin ruta', 2009) : null), km: 80 });
    const generate = fakeGenerate();
    const res = await proposeNearbyRoutes(target, deps({ fetchPath, generate }));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].budget).toBe(NEARBY_ORS_BUDGET - fetchPath.mock.calls.length);
    expect(res.requestsUsed).toBe(NEARBY_ORS_BUDGET);
  });

  describe('cima en fondo de saco', () => {
    // Rombo de 30 km hasta un cruce a 8 km y un ramal de 15 km hasta la cima, que se baja por la misma carretera.
    const spur = (waypoints: LatLng[]): LatLng[] => {
      const top = waypoints[1];
      const junction = at(0, 8);
      const h = Math.sqrt(7.5 ** 2 - 4 ** 2) * 1000;
      const mid = toXY(at(0, 4));
      return densify([START, fromXY(mid.x + h, mid.y), junction, top, junction, fromXY(mid.x - h, mid.y), START]);
    };
    const run = (point: OsmWaypoint) =>
      proposeNearbyRoutes(target, deps({ findWaypoints: async () => [point], fetchPath: fakePath({ shape: spur }) }));

    it('la geometría de la prueba retrocede entre el 15 % y el 30 %', () => {
      const f = feature(spur([START, at(0, 23), START]), 500);
      const ratio = geometryQuality(f.geometry.coordinates).backtrackM / analyzeRoute(f, 0).distanceM;
      expect(ratio).toBeGreaterThan(0.15);
      expect(ratio).toBeLessThan(DEAD_END_BACKTRACK);
    });

    it('se acepta si el punto es una cima con deadEnd', async () => {
      const res = await run(osm(1, 0, { id: 'osm-peak-1', kind: 'cima', name: 'Turó sintètic', deadEnd: true, interes: 3 }));
      expect(motorCards(res.cards).map((c) => c.via)).toEqual([['Turó sintètic']]);
    });

    it('se rechaza si el punto es un pueblo', async () => {
      const res = await run(osm(1, 0, { id: 'osm-place-1', kind: 'pueblo', name: 'Poble sintètic', ele: null, interes: 0 }));
      expect(motorCards(res.cards)).toHaveLength(0);
    });
  });

  it('con un desnivel imposible no cuenta ninguna vuelta y avisa del más alto conseguido', async () => {
    const res = await proposeNearbyRoutes({ ...target, elevGainM: 800 }, deps({ fetchPath: fakePath({ gain: 400 }) }));
    expect(motorCards(res.cards)).toHaveLength(0);
    expect(res.warnings.join(' ')).toContain('400 m');
  });

  it('si fallan los puntos de OSM sigue con el historial y round_trip, con aviso', async () => {
    const habitual: HistoryWaypoint = { id: 'hist-cell-1', kind: 'habitual', name: 'Tramo habitual 1', ...at(100, 23), ele: null, distanceM: 23_000 };
    const generate = fakeGenerate();
    const fetchPath = fakePath();
    const res = await proposeNearbyRoutes(target, deps({
      findWaypoints: async () => { throw new RouteSourceError('unavailable'); },
      historyWaypoints: async () => [habitual], fallbackWaypoints: () => [],
      fetchPath, generate,
    }));
    expect(res.warnings.some((w) => /puertos/.test(w))).toBe(true);
    expect(motorCards(res.cards).map((c) => c.via)).toEqual([['tramo habitual']]);
    expect(fetchPath).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].budget).toBe(NEARBY_ORS_BUDGET - 1);
  });

  describe('sin puntos de OSM usa puntos por rumbo', () => {
    it('si Overpass falla, ORS ajusta a carretera un anillo de puntos y salen 5 vueltas sin pedir round_trip', async () => {
      const generate = fakeGenerate();
      const fetchPath = fakePath();
      const res = await proposeNearbyRoutes(target, deps({ findWaypoints: async () => { throw new RouteSourceError('unavailable'); }, fetchPath, generate }));
      const motor = motorCards(res.cards);
      expect(motor.length).toBeGreaterThanOrEqual(5);
      for (const card of motor) for (const name of card.via) expect(name).toMatch(/^rumbo /);
      expect(generate).not.toHaveBeenCalled();
      expect(res.warnings.join(' ')).toMatch(/puntos por rumbo/);
    });

    it('no espera a Overpass más del tope: sigue con los puntos por rumbo', async () => {
      const res = await proposeNearbyRoutes(target, deps({ findWaypoints: () => new Promise(() => {}), waypointsWaitMs: 5 }));
      expect(motorCards(res.cards).length).toBeGreaterThanOrEqual(5);
      expect(res.warnings.join(' ')).toMatch(/puntos por rumbo/);
    });

    it('con puntos de OSM no añade los de rumbo', async () => {
      const res = await proposeNearbyRoutes(target, deps());
      for (const card of motorCards(res.cards)) for (const name of card.via) expect(name).not.toMatch(/^rumbo /);
    });
  });

  it('sin ningún punto de paso busca vueltas circulares y solo acepta las que cumplen', async () => {
    const vuelta = (deg: number, km: number) =>
      rateCandidate(analyzeRoute(feature(loopThrough([START, at(deg, 23), START], km), 500), deg), { distanceM: D_KM * 1000, elevGainM: null, preferNew: true }, { reference: null, visited: new Set() });
    const generate = fakeGenerate([vuelta(0, 60), vuelta(90, 60), vuelta(180, 75), vuelta(200, 60), vuelta(270, 59)]);
    const updates: NearbyUpdate[] = [];
    const res = await proposeNearbyRoutes(target, deps({ findWaypoints: async () => [], fallbackWaypoints: () => [], generate, onUpdate: (u) => updates.push(u) }));
    expect(generate.mock.calls[0][0].budget).toBe(NEARBY_ORS_BUDGET);
    expect(updates).toContainEqual({ kind: 'waypoints', count: 0 });
    // La de 75 km no cumple ±10 %; por eso la de 200°, a solo 20° de ella, sí entra.
    expect(motorCards(res.cards).map((c) => c.combo)).toEqual(['vuelta', 'vuelta', 'vuelta', 'vuelta']);
    expect(res.warnings.join(' ')).toMatch(/4 vueltas/);
    expect(res.warnings.join(" ")).toMatch(/No hay puertos/);
  });

  it('las combinaciones de la IA se marcan como tales', async () => {
    const ai: SharedWaypointPlanner = { combine: vi.fn(async () => ({ combinaciones: [{ puntos: ['w1'], direccion: 'norte' as const, titulo: 'Por el coll' }] })) };
    const res = await proposeNearbyRoutes(target, deps({ ai }));
    expect(res.usedAi).toBe(true);
    expect(motorCards(res.cards).some((c) => c.combo === 'ia')).toBe(true);
  });

  it('con el límite por minuto espera 60 s con aviso y repite la misma consulta', async () => {
    const controller = new AbortController();
    const wait = vi.fn(async () => {});
    const updates: NearbyUpdate[] = [];
    const fetchPath = fakePath({ fail: (call) => (call === 3 ? new OrsError('rate_minute', 'Has pasado de 40 consultas por minuto en ORS.') : null) });
    const res = await proposeNearbyRoutes(target, deps({ fetchPath, wait, signal: controller.signal, onUpdate: (u) => updates.push(u) }));
    expect(wait).toHaveBeenCalledWith(60_000, controller.signal);
    expect(updates).toContainEqual({ kind: 'waiting', seconds: 60 });
    expect(fetchPath.mock.calls[3][1]).toEqual(fetchPath.mock.calls[2][1]);
    expect(motorCards(res.cards).length).toBeGreaterThanOrEqual(5);
  });

  it('cancelar durante la espera corta al momento con AbortError', async () => {
    const controller = new AbortController();
    const wait = vi.fn(async (_ms: number, signal?: AbortSignal) => {
      controller.abort();
      signal?.throwIfAborted();
    });
    const fetchPath = fakePath({ fail: (call) => (call === 3 ? new OrsError('rate_minute', 'límite') : null) });
    await expect(proposeNearbyRoutes(target, deps({ fetchPath, wait, signal: controller.signal }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchPath).toHaveBeenCalledTimes(3);
  });

  it('sin cuota diaria tras 3 aceptadas devuelve esas 3 con aviso, sin lanzar', async () => {
    const quota = new OrsError('quota_day', 'Has gastado las 2.000 consultas diarias de ORS.');
    const generate = fakeGenerate();
    const res = await proposeNearbyRoutes(target, deps({ fetchPath: fakePath({ fail: (call) => (call === 4 ? quota : null) }), generate }));
    expect(motorCards(res.cards)).toHaveLength(3);
    expect(res.warnings).toContain(quota.message);
    expect(generate).not.toHaveBeenCalled();
  });

  it('avisa de cada tarjeta en cuanto se acepta, para conservarla si se cancela', async () => {
    const updates: NearbyUpdate[] = [];
    const res = await proposeNearbyRoutes(target, deps({ onUpdate: (u) => updates.push(u) }));
    const emitted = updates.flatMap((u) => (u.kind === 'card' ? [u.card] : []));
    expect(emitted.length).toBe(res.cards.length);
    expect(new Set(emitted)).toEqual(new Set(res.cards));
  });

  describe('límite por minuto en las vueltas circulares (sin puntos de paso)', () => {
    const limit = () => new OrsError('rate_minute', 'El servicio común de rutas admite 8 consultas por minuto por persona. Espera 30 s y vuelve a probar.');
    /** Servicio común simulado: cada semilla da una vuelta de 60 km hacia un lado distinto. */
    const shared = (fail: (call: number) => boolean): SharedOrsAccess & { calls: () => number } => {
      let call = 0;
      const fetch = async (request: { operation: string; seed?: number }) => {
        call++;
        if (fail(call)) throw limit();
        return feature(loopThrough([START, at(((request.seed ?? 0) % 8) * 46, 23), START], D_KM), 500);
      };
      return { kind: 'shared', fetch: fetch as SharedOrsAccess['fetch'], fetchAll: async () => [], calls: () => call };
    };
    const run = (ors: SharedOrsAccess, over: Partial<NearbyDeps> = {}) =>
      proposeNearbyRoutes(target, deps({ ors, findWaypoints: async () => [], fallbackWaypoints: () => [], generate: (req, d) => generateRoutes(req, { ...d, seedBase: 0 }), ...over }));

    it('en la primera consulta espera con aviso y sigue, en vez de devolver 0 rutas', async () => {
      const wait = vi.fn(async () => {});
      const updates: NearbyUpdate[] = [];
      const res = await run(shared((call) => call === 1), { wait, onUpdate: (u) => updates.push(u) });
      expect(wait).toHaveBeenCalledTimes(1);
      expect(updates).toContainEqual({ kind: 'waiting', seconds: 60 });
      expect(motorCards(res.cards).length).toBeGreaterThanOrEqual(5);
      expect(res.warnings.join(' ')).not.toMatch(/Espera 30 s/);
    });

    it('a media búsqueda conserva lo aceptado, espera y completa', async () => {
      const wait = vi.fn(async () => {});
      const res = await run(shared((call) => call === 4), { wait });
      expect(wait).toHaveBeenCalledTimes(1);
      expect(motorCards(res.cards).length).toBeGreaterThanOrEqual(5);
      expect(res.requestsUsed).toBeLessThanOrEqual(NEARBY_ORS_BUDGET);
    });

    it('espera como mucho 3 veces en toda la búsqueda y entonces avisa', async () => {
      const wait = vi.fn(async () => {});
      const ors = shared(() => true);
      const res = await run(ors, { wait });
      expect(wait).toHaveBeenCalledTimes(3);
      expect(ors.calls()).toBe(4);
      expect(res.cards).toHaveLength(0);
      expect(res.warnings.join(' ')).toMatch(/8 consultas por minuto/);
    });
  });

  describe('aprende de cada respuesta de ORS', () => {
    const straightKm = (waypoints: LatLng[]) =>
      waypoints.slice(1).reduce((sum, p, i) => sum + Math.hypot(toXY(p).x - toXY(waypoints[i]).x, toXY(p).y - toXY(waypoints[i]).y), 0) / 1000;
    /** Dos anillos: a 23 km (60 km de vuelta con factor 1,3) y a 16 km (60 km con factor 1,85). */
    const rings = () => RING.flatMap((deg, i) => [osm(i + 1, deg), osm(i + 101, deg, { ...at(deg, 16), distanceM: 16_000 })]);

    it('en carreteras de montaña (1,85 veces la línea recta) pasa a puntos más cercanos y llega a 5', async () => {
      const fetchPath = fakePath({ kmOf: (waypoints) => straightKm(waypoints) * 1.85 });
      const res = await proposeNearbyRoutes(target, deps({ findWaypoints: async () => rings(), fetchPath }));
      const motor = motorCards(res.cards);
      expect(motor.length).toBeGreaterThanOrEqual(5);
      for (const card of motor) expect(Math.abs(card.route.distanceM - D_KM * 1000)).toBeLessThanOrEqual(D_KM * 100);
      // La primera consulta mide el factor; después casi todas aciertan.
      expect(res.requestsUsed).toBeLessThanOrEqual(8);
    });

    it('usa el factor medido en el rumbo más próximo: al norte 1,85 y al sur 1,3', async () => {
      const north = (waypoints: LatLng[]) => toXY(waypoints[1]).y > 0;
      const fetchPath = fakePath({ kmOf: (waypoints) => straightKm(waypoints) * (north(waypoints) ? 1.85 : 1.3) });
      const res = await proposeNearbyRoutes(target, deps({ findWaypoints: async () => rings(), fetchPath }));
      expect(motorCards(res.cards).length).toBeGreaterThanOrEqual(5);
      expect(res.requestsUsed).toBeLessThanOrEqual(NEARBY_ORS_BUDGET);
    });

    it('con un desnivel moderado deja los puertos altos y va por los pueblos', async () => {
      // Sale de 100 m. Cada puerto está a 900 m; el terreno ondula 12 m por km.
      const points = RING.flatMap((deg, i) => [
        osm(i + 1, deg),
        osm(i + 201, deg + 4, { id: `osm-place-${i + 201}`, kind: 'pueblo', name: `Poble sintètic ${i}`, ele: null, interes: 1, ...at(deg + 4, 23) }),
      ]);
      const passes = points.filter((p) => p.kind === 'puerto');
      const viaPass = (waypoints: LatLng[]) => passes.some((p) => Math.abs(p.lat - waypoints[1].lat) < 1e-9 && Math.abs(p.lng - waypoints[1].lng) < 1e-9);
      const fetchPath = fakePath({ gainOf: (waypoints) => 12 * D_KM + (viaPass(waypoints) ? 800 : 0) });
      const res = await proposeNearbyRoutes({ ...target, elevGainM: 800 }, deps({ findWaypoints: async () => points, fetchPath }));
      const motor = motorCards(res.cards);
      expect(motor.length).toBeGreaterThanOrEqual(5);
      for (const card of motor) {
        expect(card.via[0]).toMatch(/Poble/);
        expect(Math.abs(card.route.elevGainM - 800)).toBeLessThanOrEqual(200);
      }
      // Una consulta para medir (por el puerto) y después solo pueblos.
      expect(res.requestsUsed).toBeLessThanOrEqual(8);
    });

    it('no pide una combinación cuyo rumbo queda a menos de 45° de una vuelta ya aceptada', async () => {
      // 16 puntos cada 22,5°: los vecinos de una aceptada no caben por diversidad y no deben gastar consultas.
      const many = Array.from({ length: 16 }, (_, i) => osm(i + 1, i * 22.5));
      const fetchPath = fakePath();
      const res = await proposeNearbyRoutes(target, deps({ findWaypoints: async () => many, fetchPath }));
      expect(motorCards(res.cards).length).toBeGreaterThanOrEqual(5);
      expect(fetchPath).toHaveBeenCalledTimes(motorCards(res.cards).length);
    });
  });

  describe('firme sin datos', () => {
    /** El 30 % central de la vuelta sin dato de firme, por una vía del tipo `waytype`. */
    const unknownOn = (waytype: number) => vi.fn<typeof fetchPathFeature>(async (_access, waypoints) => {
      const f = feature(loopThrough(waypoints, D_KM), 500);
      const n = f.geometry.coordinates.length - 1;
      const a = Math.round(n * 0.35);
      const b = Math.round(n * 0.65);
      const split = (inside: number, outside: number) => ({
        values: [[0, a, outside], [a, b, inside], [b, n, outside]] as [number, number, number][],
        summary: [{ value: outside, distance: 42_000, amount: 70 }, { value: inside, distance: 18_000, amount: 30 }],
      });
      f.properties.extras.surface = split(0, 3);
      f.properties.extras.waytypes = split(waytype, 2);
      return f;
    });

    it('en una carretera cuenta como asfalto: en OSM muchas comarcales no declaran el firme', async () => {
      const res = await proposeNearbyRoutes(target, deps({ fetchPath: unknownOn(2) }));
      expect(motorCards(res.cards).length).toBeGreaterThanOrEqual(5);
    });

    it('en un camino no: la vuelta se descarta', async () => {
      const res = await proposeNearbyRoutes(target, deps({ fetchPath: unknownOn(4) }));
      expect(motorCards(res.cards)).toHaveLength(0);
    });
  });

  describe('pistas', () => {
    /** ORS simulado: mete 2 km de pista en mitad de la vuelta mientras no le pidan evitar ese punto. */
    const withTrack = () => vi.fn<typeof fetchPathFeature>(async (_access, waypoints, _signal, avoid) => {
      const f = feature(loopThrough(waypoints, D_KM), 500);
      if (avoid?.length) return f;
      const n = f.geometry.coordinates.length - 1;
      const a = Math.round(n * 0.48);
      const b = Math.round(n * 0.52);
      f.properties.extras.surface = { values: [[0, a, 3], [a, b, 0], [b, n, 3]], summary: [{ value: 3, distance: 58_000, amount: 96 }, { value: 0, distance: 2_000, amount: 4 }] };
      f.properties.extras.waytypes = { values: [[0, a, 2], [a, b, 5], [b, n, 2]], summary: [{ value: 2, distance: 58_000, amount: 96 }, { value: 5, distance: 2_000, amount: 4 }] };
      return f;
    });

    it('una vuelta con pista se repite una vez pidiendo a ORS que evite ese punto, y las siguientes ya lo evitan', async () => {
      const fetchPath = withTrack();
      const res = await proposeNearbyRoutes(target, deps({ fetchPath }));
      const [first, second, third] = fetchPath.mock.calls;
      expect(first[3] ?? []).toEqual([]);
      expect(second[1]).toEqual(first[1]);
      expect(second[3]).toHaveLength(1);
      const mid = feature(loopThrough(first[1], D_KM), 500).geometry.coordinates;
      const [lng, lat] = mid[Math.round((mid.length - 1) * 0.5)];
      expect(haversineM(second[3]![0].lat, second[3]![0].lng, lat, lng)).toBeLessThan(200);
      expect(third[1]).not.toEqual(first[1]);
      expect(third[3]).toEqual(second[3]);
      expect(motorCards(res.cards).length).toBeGreaterThanOrEqual(5);
      expect(res.requestsUsed).toBe(fetchPath.mock.calls.length);
    });

    it('no manda pistas cercanas a la salida: un cuadrado allí deja a ORS sin ruta en todas las consultas', async () => {
      const fetchPath = vi.fn<typeof fetchPathFeature>(async (_access, waypoints) => {
        const f = feature(loopThrough(waypoints, D_KM), 500);
        const n = f.geometry.coordinates.length - 1;
        const b = Math.max(2, Math.round(n * 0.02));
        f.properties.extras.surface = { values: [[0, b, 0], [b, n, 3]], summary: [{ value: 3, distance: 58_800, amount: 98 }, { value: 0, distance: 1_200, amount: 2 }] };
        f.properties.extras.waytypes = { values: [[0, b, 5], [b, n, 2]], summary: [{ value: 2, distance: 58_800, amount: 98 }, { value: 5, distance: 1_200, amount: 2 }] };
        return f;
      });
      await proposeNearbyRoutes(target, deps({ fetchPath }));
      for (const call of fetchPath.mock.calls) {
        for (const a of call[3] ?? []) expect(haversineM(a.lat, a.lng, START.lat, START.lng)).toBeGreaterThanOrEqual(2000);
      }
    });

    it('si ORS no encuentra ruta con puntos que evitar, repite la misma vuelta sin ellos', async () => {
      const inner = withTrack();
      const fetchPath = vi.fn<typeof fetchPathFeature>(async (access, waypoints, signal, avoid) => {
        if (avoid?.length) throw new OrsError('no_route', 'sin ruta', 404);
        return inner(access, waypoints, signal, avoid);
      });
      await proposeNearbyRoutes(target, deps({ fetchPath }));
      const calls = fetchPath.mock.calls;
      const failed = calls.findIndex((c) => (c[3]?.length ?? 0) > 0);
      expect(failed).toBeGreaterThan(-1);
      expect(calls[failed + 1][1]).toEqual(calls[failed][1]);
      expect(calls[failed + 1][3] ?? []).toEqual([]);
    });

    it('nunca manda más de 12 puntos que evitar', async () => {
      const fetchPath = vi.fn<typeof fetchPathFeature>(async (_access, waypoints) => {
        const f = feature(loopThrough(waypoints, D_KM), 500);
        const n = f.geometry.coordinates.length - 1;
        const cut = [0.2, 0.25, 0.4, 0.45, 0.6, 0.65, 0.8, 0.85].map((x) => Math.round(n * x));
        const spans = (inside: number, outside: number) => [0, ...cut, n].slice(1).map((to, i, all) => [i === 0 ? 0 : all[i - 1], to, i % 2 ? inside : outside] as [number, number, number]);
        f.properties.extras.surface = { values: spans(0, 3), summary: [{ value: 3, distance: 48_000, amount: 80 }, { value: 0, distance: 12_000, amount: 20 }] };
        f.properties.extras.waytypes = { values: spans(5, 2), summary: [{ value: 2, distance: 48_000, amount: 80 }, { value: 5, distance: 12_000, amount: 20 }] };
        return f;
      });
      await proposeNearbyRoutes(target, deps({ fetchPath }));
      expect(fetchPath.mock.calls.length).toBeGreaterThan(4);
      for (const call of fetchPath.mock.calls) expect((call[3] ?? []).length).toBeLessThanOrEqual(12);
      expect(fetchPath.mock.calls.at(-1)![3]).toHaveLength(12);
    });
  });

  it('las esperas por el límite son 3 en total, no 3 por combinación', async () => {
    const wait = vi.fn(async () => {});
    const fetchPath = fakePath({ fail: () => new OrsError('rate_minute', 'límite') });
    const generate = fakeGenerate();
    const res = await proposeNearbyRoutes(target, deps({ fetchPath, wait, generate }));
    expect(wait).toHaveBeenCalledTimes(3);
    expect(fetchPath).toHaveBeenCalledTimes(4);
    expect(generate).not.toHaveBeenCalled();
    expect(res.requestsUsed).toBeLessThanOrEqual(NEARBY_ORS_BUDGET);
  });

  it('una consulta rechazada por el límite por minuto no gasta presupuesto', async () => {
    const fetchPath = fakePath({ fail: (call) => (call === 2 ? new OrsError('rate_minute', 'límite') : call > 2 ? new OrsError('no_route', 'sin ruta') : null) });
    const many = Array.from({ length: 24 }, (_, i) => osm(i + 1, i * 15));
    const res = await proposeNearbyRoutes(target, deps({ fetchPath, findWaypoints: async () => many }));
    // 14 consultas de verdad más la rechazada.
    expect(fetchPath).toHaveBeenCalledTimes(NEARBY_ORS_BUDGET + 1);
    expect(res.requestsUsed).toBe(NEARBY_ORS_BUDGET);
  });

  it('pide los puntos de paso a la vez que las rutas reales, sin esperar a que acaben', async () => {
    let asked = false;
    const rwgps = { getToken: async () => 'sesion-sintetica', fetch: (async () => {
      // Si los puntos se pidieran después, esta promesa no se resolvería nunca.
      await vi.waitFor(() => expect(asked).toBe(true));
      return json({ data: { routes: [], total: 0 } });
    }) as unknown as typeof fetch };
    const res = await proposeNearbyRoutes(target, deps({ rwgps, findWaypoints: async () => { asked = true; return ring(); } }));
    expect(res.warnings).toEqual([]);
    expect(motorCards(res.cards).length).toBeGreaterThanOrEqual(5);
  });

  it('un fallo de Ride with GPS no fatal se avisa y el motor sigue', async () => {
    const rwgps = { getToken: async () => 'sesion-sintetica', fetch: (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch };
    const res = await proposeNearbyRoutes(target, deps({ rwgps }));
    expect(res.warnings.some((w) => /Ride with GPS/.test(w))).toBe(true);
    expect(motorCards(res.cards).length).toBeGreaterThanOrEqual(5);
  });
});
