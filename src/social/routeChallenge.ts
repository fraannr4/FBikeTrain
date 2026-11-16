import type { LatLng, StoredActivity, TrackPoint } from '../domain/types';
import { buildVisitedCells } from '../metrics/grid';
import { computeTotals, haversineM } from '../import/summary';
import { lineCells } from '../routes/library/cells';
import type { RoutePoint } from '../routes/library';
import { challengePoints, type ChallengePoint } from './challenges';

/**
 * Reto de ruta, calculado en el dispositivo. Del track de las salidas no sale nada: solo el resultado
 * (tiempo en movimiento, cobertura, momento de paso por el inicio e id local de la salida). El servidor
 * comprueba rangos, pero no puede verificar el track: el reto se basa en la confianza.
 */

/** Metros que se quitan a cada extremo de la ruta antes de compartirla, para no revelar «Casa». */
export const PRIVACY_TRIM_M = 500;
/** Una ruta compartida tiene al menos 1 km tras el recorte (el servidor exige lo mismo). */
export const MIN_ROUTE_M = 1000;
/** Fracción mínima de las celdas de 200 m de la ruta que pisa la salida. */
export const MIN_COVERAGE = 0.9;
/** Media máxima admitida en el tramo: 60 km/h. */
export const MAX_ROUTE_SPEED_MS = 60 / 3.6;
/** Distancia a la que un punto de la salida «pasa» por el inicio, el final o un control de la ruta. */
const NEAR_M = 100;
/** Controles intermedios (cada 5 %) para comprobar el sentido; han de encontrarse en orden en el 80 %. */
const CHECKPOINTS = 19;
const MIN_ORDERED = 0.8;

const gps = (p: TrackPoint): p is TrackPoint & LatLng =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat!) <= 90 && Math.abs(p.lng!) <= 180;
const dist = (a: LatLng, b: LatLng) => haversineM(a.lat, a.lng, b.lat, b.lng);

/** Punto a `m` metros del inicio de la línea, interpolado, y el índice del vértice siguiente. */
function along(line: RoutePoint[], m: number): { point: RoutePoint; next: number } {
  let done = 0;
  for (let i = 1; i < line.length; i++) {
    const seg = dist(line[i - 1], line[i]);
    if (done + seg >= m && seg > 0) {
      const f = (m - done) / seg, a = line[i - 1], b = line[i];
      const point: RoutePoint = { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
      if (a.ele !== undefined && b.ele !== undefined) point.ele = a.ele + (b.ele - a.ele) * f;
      return { point, next: i };
    }
    done += seg;
  }
  return { point: line[line.length - 1], next: line.length };
}

const lineLength = (line: LatLng[]) => line.slice(1).reduce((s, p, i) => s + dist(line[i], p), 0);

/** Quita `trimM` metros de cada extremo siguiendo el trazado. Si no queda nada, devuelve `[]`. */
export function trimRouteEnds(points: RoutePoint[], trimM = PRIVACY_TRIM_M): RoutePoint[] {
  const total = lineLength(points);
  if (total <= 2 * trimM) return [];
  const head = along(points, trimM), tail = along(points, total - trimM);
  return [head.point, ...points.slice(head.next, tail.next), tail.point]
    .filter((p, i, all) => i === 0 || p.lat !== all[i - 1].lat || p.lng !== all[i - 1].lng);
}

/** Lo que se envía al crear el reto: la ruta recortada, como mucho 2.000 puntos, y su distancia. */
export function prepareRouteChallenge(points: RoutePoint[]): { points: ChallengePoint[]; distanceM: number } {
  const trimmed = trimRouteEnds(points);
  const distanceM = Math.round(lineLength(trimmed));
  if (trimmed.length < 2 || distanceM < MIN_ROUTE_M) throw new Error('La ruta es demasiado corta para un reto: necesita más de 2 km.');
  return { points: challengePoints(trimmed), distanceM };
}

export type RouteMatch = { movingTimeS: number; coverage: number; startedAt: number; startIdx: number; endIdx: number };

/** Índice más cercano a `target` en cada paso de la salida a menos de NEAR_M. */
function passes(ride: TrackPoint[], target: LatLng): number[] {
  const out: number[] = [];
  let best = -1, bestD = Infinity;
  for (let i = 0; i <= ride.length; i++) {
    const p = ride[i];
    const d = p && gps(p) ? dist(p, target) : Infinity;
    if (d <= NEAR_M) { if (d < bestD) { best = i; bestD = d; } continue; }
    if (best >= 0) out.push(best);
    best = -1; bestD = Infinity;
  }
  return out;
}

/** Sentido: los controles de la ruta aparecen en orden en la salida (búsqueda voraz hacia delante). */
function inOrder(window: TrackPoint[], checkpoints: LatLng[]): boolean {
  let at = 0, found = 0;
  for (const c of checkpoints) {
    for (let i = at; i < window.length; i++) {
      const p = window[i];
      if (gps(p) && dist(p, c) <= NEAR_M) { at = i; found++; break; }
    }
  }
  return found >= checkpoints.length * MIN_ORDERED;
}

/**
 * La mejor pasada (menor tiempo en movimiento) de la salida por la ruta: del punto más cercano al inicio
 * al más cercano al final, con al menos el 90 % de las celdas de 200 m de la ruta, en su sentido y con
 * una media de 60 km/h como mucho. `null` si ninguna pasada vale.
 */
export function matchRouteRide(route: LatLng[], ride: TrackPoint[]): RouteMatch | null {
  if (route.length < 2) return null;
  const routeCells = lineCells(route);
  const routeM = lineLength(route);
  const checkpoints = Array.from({ length: CHECKPOINTS }, (_, k) => along(route, routeM * (k + 1) / (CHECKPOINTS + 1)).point);
  const starts = passes(ride, route[0]), ends = passes(ride, route[route.length - 1]);
  let best: RouteMatch | null = null;
  for (const s of starts) {
    for (const e of ends) {
      if (e <= s) continue;
      const window = ride.slice(s, e + 1);
      const visited = buildVisitedCells([window]);
      let shared = 0;
      for (const c of routeCells) if (visited.has(c)) shared++;
      const coverage = shared / routeCells.size;
      if (coverage < MIN_COVERAGE || !inOrder(window, checkpoints)) continue;
      const { movingTimeS, distanceM } = computeTotals(window);
      if (!(movingTimeS > 0) || distanceM / movingTimeS > MAX_ROUTE_SPEED_MS || movingTimeS < routeM / MAX_ROUTE_SPEED_MS) continue;
      if (!best || movingTimeS < best.movingTimeS) best = { movingTimeS, coverage, startedAt: ride[s].t, startIdx: s, endIdx: e };
    }
  }
  return best;
}

export type RouteResult = { movingTimeS: number; coverage: number; riddenAt: number; activityRef: string };
type TrackReader = (id: string) => Promise<TrackPoint[] | undefined>;
const ACTIVITY_REF = /^[A-Za-z0-9._:-]{1,80}$/;

/**
 * El mejor resultado de las salidas guardadas en este dispositivo dentro de la ventana del reto
 * (`from`: aceptación; `to`: cierre o ahora). Excluye datos de ejemplo y salidas claramente más cortas.
 */
export async function bestRouteResult(
  route: LatLng[], distanceM: number, activities: StoredActivity[], readTrack: TrackReader, window: { from: number; to: number },
): Promise<RouteResult | null> {
  let best: RouteResult | null = null;
  for (const a of activities) {
    if (a.id.startsWith('demo-') || a.sport !== 'cycling' || !a.hasTrack || !ACTIVITY_REF.test(a.id)
      || !(a.startTime >= window.from && a.startTime < window.to) || !(a.totals.distanceM >= distanceM * 0.8)) continue;
    const points = (await readTrack(a.id))?.filter(p => p.t >= window.from && p.t <= window.to);
    if (!points?.length) continue;
    const match = matchRouteRide(route, points);
    // El servidor mide el mínimo con la distancia guardada, anterior a la simplificación.
    if (match && match.movingTimeS >= distanceM / MAX_ROUTE_SPEED_MS && (!best || match.movingTimeS < best.movingTimeS)) {
      best = { movingTimeS: Math.ceil(match.movingTimeS), coverage: Math.floor(match.coverage * 1000) / 1000, riddenAt: match.startedAt, activityRef: a.id };
    }
  }
  return best;
}
