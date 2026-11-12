import type { Coord3, LatLng } from '../src/domain/types';
import { angleGap, routeBearing, sameRoute } from '../src/routes/diversity';
import type { AdaptedRoute } from '../src/routes/adapt';
import { analyzeRoute } from '../src/routes/analyze';
import { rateCandidate, type generateRoutes, type GeneratedRoute } from '../src/routes/generator';
import type { HistoryWaypoint } from '../src/routes/historyWaypoints';
import { DEAD_END_BACKTRACK, NEARBY_ORS_BUDGET, proposeNearbyRoutes, type NearbyCard, type NearbyDeps, type NearbyUpdate } from '../src/routes/nearby';
import { OrsError, type fetchPathFeature, type OrsFeature } from '../src/routes/ors';
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
function fakePath(o: { km?: number; gain?: number; fail?: (call: number) => Error | null; shape?: (waypoints: LatLng[]) => LatLng[] } = {}) {
  let call = 0;
  return vi.fn<typeof fetchPathFeature>(async (_access, waypoints) => {
    call++;
    const error = o.fail?.(call);
    if (error) throw error;
    return feature(o.shape ? o.shape(waypoints) : loopThrough(waypoints, o.km ?? D_KM), o.gain ?? 500);
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
      historyWaypoints: async () => [habitual],
      fetchPath, generate,
    }));
    expect(res.warnings.some((w) => /puertos/.test(w))).toBe(true);
    expect(motorCards(res.cards).map((c) => c.via)).toEqual([['tramo habitual']]);
    expect(fetchPath).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].budget).toBe(NEARBY_ORS_BUDGET - 1);
  });

  it('sin ningún punto de paso busca vueltas circulares y solo acepta las que cumplen', async () => {
    const vuelta = (deg: number, km: number) =>
      rateCandidate(analyzeRoute(feature(loopThrough([START, at(deg, 23), START], km), 500), deg), { distanceM: D_KM * 1000, elevGainM: null, preferNew: true }, { reference: null, visited: new Set() });
    const generate = fakeGenerate([vuelta(0, 60), vuelta(90, 60), vuelta(180, 75), vuelta(200, 60), vuelta(270, 59)]);
    const updates: NearbyUpdate[] = [];
    const res = await proposeNearbyRoutes(target, deps({ findWaypoints: async () => [], generate, onUpdate: (u) => updates.push(u) }));
    expect(generate.mock.calls[0][0].budget).toBe(NEARBY_ORS_BUDGET);
    expect(updates).toContainEqual({ kind: 'waypoints', count: 0 });
    // La de 75 km no cumple ±10 %; por eso la de 200°, a solo 20° de ella, sí entra.
    expect(motorCards(res.cards).map((c) => c.combo)).toEqual(['vuelta', 'vuelta', 'vuelta', 'vuelta']);
    expect(res.warnings.join(' ')).toMatch(/4 vueltas/);
    expect(res.warnings.join(' ')).toMatch(/circulares/);
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

  it('un fallo de Ride with GPS no fatal se avisa y el motor sigue', async () => {
    const rwgps = { getToken: async () => 'sesion-sintetica', fetch: (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch };
    const res = await proposeNearbyRoutes(target, deps({ rwgps }));
    expect(res.warnings.some((w) => /Ride with GPS/.test(w))).toBe(true);
    expect(motorCards(res.cards).length).toBeGreaterThanOrEqual(5);
  });
});
