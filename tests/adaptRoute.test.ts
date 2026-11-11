import { haversineM } from '../src/import/summary';
import type { LatLng } from '../src/domain/types';
import type { RoutePoint } from '../src/routes/library';
import { OrsError, type OrsFeature } from '../src/routes/ors';
import type { SharedOrsAccess } from '../src/routes/orsProxy';
import type { SharedOrsRequest } from '../src/routes/shared/orsService';
import { adaptRoute, MAX_ADAPT_REQUESTS } from '../src/routes/adapt';

// Geometrías sintéticas en el mar frente a la costa (lat 41.0, lng 2.5), como el resto de fixtures.
const O = { lat: 41, lng: 2.5 };
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((O.lat * Math.PI) / 180);
const at = (x: number, y: number, ele = 100): RoutePoint => ({ lat: O.lat + y / M_LAT, lng: O.lng + x / M_LNG, ele });
const xy = (p: LatLng) => ({ x: (p.lng - O.lng) * M_LNG, y: (p.lat - O.lat) * M_LAT });
const near = (p: LatLng, x: number, y: number, tol = 15) => {
  const q = xy(p);
  return Math.hypot(q.x - x, q.y - y) <= tol;
};

function line(x0: number, y0: number, x1: number, y1: number, step = 10): RoutePoint[] {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
  return Array.from({ length: n + 1 }, (_, i) => at(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n));
}
const chain = (...parts: RoutePoint[][]) => parts.reduce((all, p) => [...all, ...(all.length ? p.slice(1) : p)], [] as RoutePoint[]);
/** Cuadrado cerrado en sentido antihorario desde la esquina inferior izquierda. */
const square = (x: number, y: number, side: number) =>
  chain(line(x, y, x + side, y), line(x + side, y, x + side, y + side), line(x + side, y + side, x, y + side), line(x, y + side, x, y));

function lengthOf(points: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  return d;
}

/** Respuesta de ORS con la forma documentada (`[lng, lat, ele]`, extras por índice y resumen). */
function feature(points: RoutePoint[], motorway = false): OrsFeature {
  const n = points.length - 1;
  const d = lengthOf(points);
  const cat = motorway ? 1 : 0;
  return {
    geometry: { type: 'LineString', coordinates: points.map(p => [p.lng, p.lat, p.ele ?? 100]) },
    properties: {
      summary: { distance: d, duration: d / 6 },
      extras: {
        surface: { values: [[0, n, 3]], summary: [{ value: 3, distance: d, amount: 100 }] },
        waytypes: { values: [[0, n, 2]], summary: [{ value: 2, distance: d, amount: 100 }] },
        steepness: { values: [[0, n, 0]], summary: [{ value: 0, distance: d, amount: 100 }] },
        waycategory: { values: [[0, n, cat]], summary: [{ value: cat, distance: d, amount: 100 }] },
      },
    },
  } as OrsFeature;
}

/** Carretera simulada de A a B: un quiebro a la derecha del rumbo, para no pisar la ruta ni volver por el mismo sitio. */
function dogleg(from: LatLng, to: LatLng): RoutePoint[] {
  const a = xy(from); const b = xy(to);
  const dx = b.x - a.x; const dy = b.y - a.y;
  const k = 0.3;
  const mx = (a.x + b.x) / 2 + dy * k; const my = (a.y + b.y) / 2 - dx * k;
  return chain(line(a.x, a.y, mx, my), line(mx, my, b.x, b.y));
}
/** Vuelta simulada de ORS: cuadrado hacia el suroeste del inicio, 15 % más larga de lo pedido. */
function roundTrip(start: LatLng, lengthM: number): RoutePoint[] {
  const s = xy(start); const side = (lengthM * 1.15) / 4;
  return chain(line(s.x, s.y, s.x, s.y - side), line(s.x, s.y - side, s.x - side, s.y - side), line(s.x - side, s.y - side, s.x - side, s.y), line(s.x - side, s.y, s.x, s.y));
}

/** ORS simulado como servicio común: se cuentan las consultas y se pueden forzar autopistas o errores. */
function fakeOrs(opts: { motorwayPath?: boolean; motorwayLoop?: boolean; fail?: OrsError } = {}) {
  const calls: SharedOrsRequest[] = [];
  const fetchOne = async (req: SharedOrsRequest): Promise<OrsFeature> => {
    calls.push(req);
    if (opts.fail) throw opts.fail;
    if (req.operation === 'path') return feature(dogleg(req.waypoints[0], req.waypoints[req.waypoints.length - 1]), opts.motorwayPath);
    return feature(roundTrip(req.start, req.lengthM), opts.motorwayLoop);
  };
  const access: SharedOrsAccess = { kind: 'shared', fetch: fetchOne, fetchAll: async req => [await fetchOne(req)] };
  return { access, calls };
}

describe('adaptar una ruta: salida desde mi inicio', () => {
  it('un circuito que pasa a menos de 300 m se rota para empezar y acabar en el punto más próximo, sin consultas', async () => {
    const { access, calls } = fakeOrs();
    const r = await adaptRoute(square(0, 0, 5000), { start: at(5100, 2500), mode: 'mi-inicio', targetKm: 20 }, { ors: access });
    expect(calls).toHaveLength(0);
    expect(r.rotated).toBe(true);
    expect(r.passesNearM).toBeCloseTo(100, -1);
    expect(near(r.coords[0], 5000, 2500)).toBe(true);
    expect(r.coords.at(-1)).toEqual(r.coords[0]);
    expect(r.distanceM).toBeGreaterThan(19_900);
    expect(r.distanceM).toBeLessThan(20_100);
    expect(r.connectorM).toBe(0);
    expect(r.rejected).toBeUndefined();
  });

  it('un circuito lejano se une con conectores de carretera de ida y de vuelta', async () => {
    const { access, calls } = fakeOrs();
    const start = at(6000, 2500);
    const r = await adaptRoute(square(0, 0, 5000), { start, mode: 'mi-inicio', targetKm: 22 }, { ors: access });
    expect(calls.map(c => c.operation)).toEqual(['path', 'path']);
    const [into, back] = calls as Extract<SharedOrsRequest, { operation: 'path' }>[];
    expect(near(into.waypoints[0], 6000, 2500, 1)).toBe(true);
    expect(near(into.waypoints[1], 5000, 2500)).toBe(true);
    expect(near(back.waypoints[0], 5000, 2500)).toBe(true);
    expect(near(back.waypoints[1], 6000, 2500, 1)).toBe(true);
    expect(r.passesNearM).toBeCloseTo(1000, -1);
    expect(r.connectorM).toBeGreaterThan(2000);
    expect(r.connectorM).toBeLessThan(2600);
    expect(near(r.coords[0], 6000, 2500)).toBe(true);
    expect(near(r.coords.at(-1)!, 6000, 2500)).toBe(true);
    expect(r.rejected).toBeUndefined();
  });

  it('una ruta lineal se toma por el extremo más próximo y se avisa de que va al revés', async () => {
    const { access, calls } = fakeOrs();
    const r = await adaptRoute(line(0, 0, 20_000, 0), { start: at(20_500, 0), mode: 'mi-inicio', targetKm: 45 }, { ors: access });
    expect(calls).toHaveLength(2);
    const into = calls[0] as Extract<SharedOrsRequest, { operation: 'path' }>;
    expect(near(into.waypoints[1], 20_000, 0)).toBe(true);
    expect(r.rotated).toBe(false);
    expect(r.warnings.some(w => /al revés/.test(w))).toBe(true);
    expect(near(r.coords[0], 20_500, 0)).toBe(true);
    expect(near(r.coords.at(-1)!, 20_500, 0)).toBe(true);
    expect(r.distanceM).toBeGreaterThan(40_000);
    expect(r.rejected).toBeUndefined();
  });
});

describe('adaptar una ruta: distancia', () => {
  it('si se pasa más de un 8 %, se recorta y se cierra por carretera desde el punto de corte', async () => {
    const { access, calls } = fakeOrs();
    const start = at(5000, 0);
    const r = await adaptRoute(square(0, 0, 10_000), { start, mode: 'mi-inicio', targetKm: 25 }, { ors: access });
    expect(calls).toHaveLength(1);
    const close = calls[0] as Extract<SharedOrsRequest, { operation: 'path' }>;
    expect(near(close.waypoints[1], 5000, 0, 1)).toBe(true);
    expect(r.distanceM).toBeGreaterThan(20_000);
    expect(r.distanceM).toBeLessThanOrEqual(27_000);
    expect(near(r.coords.at(-1)!, 5000, 0)).toBe(true);
    expect(r.warnings.some(w => /recorta/i.test(w))).toBe(true);
    expect(r.rejected).toBeUndefined();
  });

  it('si se queda más de un 20 % corta, se alarga con una vuelta de ORS de la longitud que falta', async () => {
    const { access, calls } = fakeOrs();
    const r = await adaptRoute(square(0, 0, 2500), { start: at(0, 0), mode: 'mi-inicio', targetKm: 20 }, { ors: access });
    expect(calls).toHaveLength(1);
    const loop = calls[0] as Extract<SharedOrsRequest, { operation: 'round_trip' }>;
    expect(loop.operation).toBe('round_trip');
    expect(near(loop.start, 0, 0, 1)).toBe(true);
    expect(loop.lengthM).toBeGreaterThan(7000);
    expect(loop.lengthM).toBeLessThan(8500);
    expect(r.distanceM).toBeGreaterThan(16_000);
    expect(r.distanceM).toBeLessThanOrEqual(21_600);
    expect(r.coords.at(-1)).toEqual(r.coords[0]);
    expect(r.warnings.some(w => /alarga/i.test(w))).toBe(true);
    expect(r.rejected).toBeUndefined();
  });

  it('si la vuelta para alargar no es de carretera, no se añade y se avisa', async () => {
    const { access } = fakeOrs({ motorwayLoop: true });
    const r = await adaptRoute(square(0, 0, 2500), { start: at(0, 0), mode: 'mi-inicio', targetKm: 20 }, { ors: access });
    expect(r.distanceM).toBeLessThan(10_100);
    expect(r.warnings.some(w => /autopista/.test(w))).toBe(true);
    expect(r.rejected).toBeUndefined();
  });

  it('avisa si el desnivel se aleja del pedido', async () => {
    const { access } = fakeOrs();
    const r = await adaptRoute(square(0, 0, 5000), { start: at(0, 0), mode: 'mi-inicio', targetKm: 20, targetGainM: 800 }, { ors: access });
    expect(r.elevGainM).toBe(0);
    expect(r.warnings.some(w => /desnivel/i.test(w))).toBe(true);
  });
});

describe('adaptar una ruta: desde el inicio de la ruta', () => {
  it('deja la ruta tal cual, sin conectores, aunque el inicio quede lejos', async () => {
    const { access, calls } = fakeOrs();
    const base = square(0, 0, 5000);
    const r = await adaptRoute(base, { start: at(20_000, 20_000), mode: 'inicio-ruta', targetKm: 20 }, { ors: access });
    expect(calls).toHaveLength(0);
    expect(r.coords).toEqual(base);
    expect(r.connectorM).toBe(0);
    expect(r.rotated).toBe(false);
    expect(r.passesNearM).toBeGreaterThan(21_000);
  });
});

describe('adaptar una ruta: validación y límites', () => {
  it('rechaza una ida y vuelta por la misma carretera', async () => {
    const { access, calls } = fakeOrs();
    const out = chain(line(0, 0, 10_000, 0), line(10_000, 0, 0, 0));
    const r = await adaptRoute(out, { start: at(0, 0), mode: 'mi-inicio', targetKm: 20 }, { ors: access });
    expect(calls).toHaveLength(0);
    expect(r.rejected).toMatch(/sentido contrario/);
  });

  it('rechaza la adaptación si el conector pasa por autopista', async () => {
    const { access, calls } = fakeOrs({ motorwayPath: true });
    const r = await adaptRoute(square(0, 0, 5000), { start: at(6000, 2500), mode: 'mi-inicio', targetKm: 22 }, { ors: access });
    expect(calls).toHaveLength(1);
    expect(r.rejected).toMatch(/autopista/);
  });

  it('rechaza una ruta con un salto de más de 5 km', async () => {
    const { access } = fakeOrs();
    const jump = [...line(0, 0, 1000, 0), ...line(7000, 0, 20_000, 0)];
    const r = await adaptRoute(jump, { start: at(0, 0), mode: 'inicio-ruta', targetKm: 19 }, { ors: access });
    expect(r.rejected).toMatch(/5 km/);
  });

  it('no pasa de 4 consultas a ORS aunque haga falta cerrar, conectar y alargar', async () => {
    const { access, calls } = fakeOrs();
    // Circuito abierto 200 m: hay que cerrarlo; el inicio queda a 1 km y la ruta se queda corta.
    const open = square(0, 0, 2500).slice(0, -20);
    const r = await adaptRoute(open, { start: at(-1000, 1250), mode: 'mi-inicio', targetKm: 30 }, { ors: access });
    expect(MAX_ADAPT_REQUESTS).toBe(4);
    expect(calls.length).toBeLessThanOrEqual(MAX_ADAPT_REQUESTS);
    expect(calls.map(c => c.operation)).toEqual(['path', 'path', 'path', 'round_trip']);
    expect(r.rejected).toBeUndefined();
  });

  it('el límite de cuota de ORS llega como error comprensible', async () => {
    const quota = new OrsError('quota_day', 'Has gastado las 2.000 consultas diarias de ORS.');
    const { access } = fakeOrs({ fail: quota });
    await expect(adaptRoute(square(0, 0, 5000), { start: at(6000, 2500), mode: 'mi-inicio', targetKm: 22 }, { ors: access })).rejects.toBe(quota);
  });

  it('respeta la cancelación sin gastar consultas', async () => {
    const { access, calls } = fakeOrs();
    const controller = new AbortController();
    controller.abort();
    await expect(adaptRoute(square(0, 0, 5000), { start: at(6000, 2500), mode: 'mi-inicio', targetKm: 22 }, { ors: access, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(0);
  });

  it('usa la función de carretera inyectada', async () => {
    const { access } = fakeOrs();
    const road = vi.fn(async (_: unknown, waypoints: LatLng[]) => dogleg(waypoints[0], waypoints[waypoints.length - 1]));
    await adaptRoute(square(0, 0, 5000), { start: at(6000, 2500), mode: 'mi-inicio', targetKm: 22 }, { ors: access, road });
    expect(road).toHaveBeenCalledTimes(2);
  });
});
