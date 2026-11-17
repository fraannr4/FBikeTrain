import type { StoredActivity, TrackPoint } from '../src/domain/types';
import { haversineM } from '../src/import/summary';
import {
  bestRouteResult, matchRouteRide, prepareRouteChallenge, PRIVACY_TRIM_M, trimRouteEnds,
} from '../src/social/routeChallenge';

// Todo sintético en el mar frente a la costa (lat 41.0, lng 2.5).
type P = { lat: number; lng: number };
const START = Date.parse('2026-11-16T09:00:00Z');
const NORTH = (km: number): P => ({ lat: 41.0 + km / 111.195, lng: 2.5 });
const length = (pts: P[]) => pts.slice(1).reduce((s, p, i) => s + haversineM(pts[i].lat, pts[i].lng, p.lat, p.lng), 0);

/** Recta de `from` a `to` con un vértice cada 50 m. */
function polyline(from: P, to: P): P[] {
  const n = Math.max(1, Math.ceil(haversineM(from.lat, from.lng, to.lat, to.lng) / 50));
  return Array.from({ length: n + 1 }, (_, i) => ({ lat: from.lat + (to.lat - from.lat) * i / n, lng: from.lng + (to.lng - from.lng) * i / n }));
}
/** Ruta lineal de 20 km hacia el norte. */
const ROUTE = polyline(NORTH(0), NORTH(20));
/** Bucle cuadrado de unos 4 × 2,5 km, en sentido horario visto desde el norte. */
const A = { lat: 41.0, lng: 2.5 }, B = { lat: 41.0 + 2.5 / 111.195, lng: 2.5 }, C = { lat: B.lat, lng: 2.5 + 1.5 / 84 }, D = { lat: 41.0, lng: C.lng };
const LOOP = [...polyline(A, B), ...polyline(B, C).slice(1), ...polyline(C, D).slice(1), ...polyline(D, A).slice(1)];

/** Recorre los vértices a `speed` m/s con un punto por segundo como mucho; `stops` añade paradas (índice de vértice → s). */
function ride(path: P[], speed = 8, t0 = START, stops: Record<number, number> = {}): TrackPoint[] {
  const out: TrackPoint[] = [{ t: t0, ...path[0] }];
  let t = t0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const d = haversineM(a.lat, a.lng, b.lat, b.lng);
    const steps = Math.max(1, Math.ceil(d / speed));
    for (let k = 1; k <= steps; k++) {
      t += d / speed / steps * 1000;
      out.push({ t, lat: a.lat + (b.lat - a.lat) * k / steps, lng: a.lng + (b.lng - a.lng) * k / steps });
    }
    for (let s = 0; s < (stops[i] ?? 0); s++) { t += 1000; out.push({ t, lat: b.lat, lng: b.lng }); }
  }
  return out;
}

describe('reto de ruta: recorte de privacidad', () => {
  it('quita 500 m de cada extremo, siguiendo el trazado', () => {
    expect(PRIVACY_TRIM_M).toBe(500);
    const trimmed = trimRouteEnds(ROUTE);
    expect(length(trimmed)).toBeCloseTo(length(ROUTE) - 1000, -1);
    expect(haversineM(trimmed[0].lat, trimmed[0].lng, ROUTE[0].lat, ROUTE[0].lng)).toBeCloseTo(500, -1);
    const last = ROUTE[ROUTE.length - 1], end = trimmed[trimmed.length - 1];
    expect(haversineM(end.lat, end.lng, last.lat, last.lng)).toBeCloseTo(500, -1);
  });
  it('en un bucle que sale y vuelve a Casa, ni el inicio ni el final quedan a menos de 500 m de ella', () => {
    const trimmed = trimRouteEnds(LOOP);
    for (const p of [trimmed[0], trimmed[trimmed.length - 1]]) expect(haversineM(p.lat, p.lng, A.lat, A.lng)).toBeGreaterThan(450);
  });
  it('prepara la ruta del servidor: recortada, como mucho 2.000 puntos y su distancia', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({ lat: 41.0 + i * 0.00005, lng: 2.5 + (i % 2) * 0.00001 }));
    const prepared = prepareRouteChallenge(many);
    expect(prepared.points.length).toBeLessThanOrEqual(2000);
    expect(prepared.distanceM).toBeGreaterThan(length(many) - 1100);
    expect(prepared.distanceM).toBeLessThan(length(many) - 900);
    expect(prepared.points[0][0]).toBeGreaterThan(many[0].lat);
  });
  it('rechaza una ruta que tras el recorte no llega a 1 km', () => {
    expect(() => prepareRouteChallenge(polyline(NORTH(0), NORTH(1.8)))).toThrow(/corta/);
  });
});

describe('reto de ruta: detección de la salida', () => {
  it('cuenta una salida que recorre la ruta, con el tiempo en movimiento entre inicio y final', () => {
    const points = ride(ROUTE);
    const match = matchRouteRide(ROUTE, points)!;
    expect(match.coverage).toBeGreaterThanOrEqual(0.9);
    expect(match.movingTimeS).toBeCloseTo(length(ROUTE) / 8, -1);
    expect(match.startedAt).toBe(START);
  });
  it('mide solo el tramo de la ruta, no la ida ni la vuelta desde Casa', () => {
    const home = NORTH(-3);
    const path = [...polyline(home, NORTH(0)), ...ROUTE.slice(1), ...polyline(NORTH(20), NORTH(23)).slice(1)];
    const match = matchRouteRide(ROUTE, ride(path))!;
    expect(match.movingTimeS).toBeCloseTo(length(ROUTE) / 8, -1);
    expect(match.startedAt).toBeCloseTo(START + 3000 / 8 * 1000, -4);
  });
  it('no cuenta una salida que cubre menos del 90 % del trazado', () => {
    const partial = polyline(NORTH(0), NORTH(17));
    expect(matchRouteRide(ROUTE, ride(partial))).toBeNull();
  });
  it('no cuenta la ruta en sentido contrario, ni lineal ni en bucle', () => {
    expect(matchRouteRide(ROUTE, ride([...ROUTE].reverse()))).toBeNull();
    const route = trimRouteEnds(LOOP);
    expect(matchRouteRide(route, ride(LOOP))).not.toBeNull();
    expect(matchRouteRide(route, ride([...LOOP].reverse()))).toBeNull();
    // Tres vueltas al revés cubren todas las celdas entre un paso por el inicio y otro por el final: decide el orden.
    const back = [...LOOP].reverse();
    expect(matchRouteRide(route, ride([...back, ...back.slice(1), ...back.slice(1)]))).toBeNull();
  });
  it('las paradas no suman tiempo: cuenta el tiempo en movimiento', () => {
    const stopped = matchRouteRide(ROUTE, ride(ROUTE, 8, START, { 100: 600 }))!;
    const straight = matchRouteRide(ROUTE, ride(ROUTE))!;
    expect(stopped.movingTimeS).toBeCloseTo(straight.movingTimeS, -1);
  });
  it('en dos vueltas a un bucle se queda con la vuelta más rápida', () => {
    const route = trimRouteEnds(LOOP);
    const slow = ride(LOOP, 6), fast = ride(LOOP, 9, slow[slow.length - 1].t + 1000);
    const match = matchRouteRide(route, [...slow, ...fast.slice(1)])!;
    expect(match.movingTimeS).toBeCloseTo(length(route) / 9, -1);
  });
  it('antitrampas: descarta una media superior a 60 km/h en el tramo', () => {
    expect(matchRouteRide(ROUTE, ride(ROUTE, 18))).toBeNull();
    expect(matchRouteRide(ROUTE, ride(ROUTE, 16))).not.toBeNull();
  });
  it('una salida sin GPS no cuenta', () => {
    expect(matchRouteRide(ROUTE, ride(ROUTE).map(({ t }) => ({ t })))).toBeNull();
  });
});

describe('reto de ruta: mejor resultado del historial local', () => {
  const activity = (id: string, startTime: number, over: Partial<StoredActivity> = {}): StoredActivity => ({
    id, startTime, sport: 'cycling', hasTrack: true, importedAt: startTime, source: 'gpx',
    totals: { distanceM: 20_000, elevGainM: 0, elapsedTimeS: 2600, movingTimeS: 2500, avgSpeedMs: 8, maxSpeedMs: 9 }, ...over,
  });
  it('elige la salida más rápida dentro de la ventana y devuelve solo cifras e id local', async () => {
    const tracks: Record<string, TrackPoint[]> = {
      slow: ride(ROUTE, 7, START + 3_600_000), fast: ride(ROUTE, 9, START + 90_000_000),
      before: ride(ROUTE, 12, START - 3_600_000), 'demo-1': ride(ROUTE, 12, START + 7_200_000),
    };
    const activities = Object.entries(tracks).map(([id, pts]) => activity(id, pts[0].t));
    const result = await bestRouteResult(ROUTE, 20_000, activities, async id => tracks[id], { from: START, to: START + 7 * 86_400_000 });
    expect(result).toEqual({ movingTimeS: expect.any(Number), coverage: expect.any(Number), riddenAt: START + 90_000_000, activityRef: 'fast' });
    expect(result!.movingTimeS).toBeCloseTo(length(ROUTE) / 9, -1);
    expect(Object.keys(result!)).toEqual(['movingTimeS', 'coverage', 'riddenAt', 'activityRef']);
  });
  it('sin salidas válidas, no hay resultado (pendiente de salida)', async () => {
    const short = activity('short', START + 1000, { totals: { distanceM: 5000, elevGainM: 0, elapsedTimeS: 700, movingTimeS: 600, avgSpeedMs: 8, maxSpeedMs: 9 } });
    const read = vi.fn(async () => ride(ROUTE));
    expect(await bestRouteResult(ROUTE, 20_000, [short], read, { from: START, to: START + 86_400_000 })).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
  it('ignora la parte de la salida que pasa del cierre del reto', async () => {
    const pts = ride(ROUTE, 8, START + 1000);
    const end = pts[Math.floor(pts.length / 2)].t;
    expect(await bestRouteResult(ROUTE, 20_000, [activity('late', START + 1000)], async () => pts, { from: START, to: end })).toBeNull();
  });
});
