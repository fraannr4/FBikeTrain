import type { Coord3, LatLng } from '../domain/types';
import { haversineM } from '../import/summary';
import type { RoutePoint } from './library';

/** Intención local: sus coordenadas solo viajan al motor de carreteras. */
export type RouteIntent = { id: string; kind: 'library' | 'pass'; waypoints: LatLng[] };
const distance = (a: LatLng, b: LatLng) => haversineM(a.lat, a.lng, b.lat, b.lng);
const point = (p: LatLng): LatLng => ({ lat: p.lat, lng: p.lng });

/** Muestreo por distancia acumulada; el resultado son anclas, nunca un track exportable. */
function anchors(points: RoutePoint[], lengthM: number, count: number): LatLng[] {
  if (points.length < 2 || lengthM <= 0) return [];
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + distance(points[i - 1], points[i]));
  const wanted = Math.min(lengthM, cumulative.at(-1)!);
  const out: LatLng[] = [];
  for (let n = 1; n <= count; n++) {
    const at = wanted * n / count;
    const i = cumulative.findIndex(d => d >= at);
    if (i <= 0) continue;
    const t = (at - cumulative[i - 1]) / (cumulative[i] - cumulative[i - 1] || 1);
    out.push({ lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * t,
      lng: points[i - 1].lng + (points[i].lng - points[i - 1].lng) * t });
  }
  return out;
}

/**
 * Acerca el comienzo al inicio en circuitos (final a menos de `closeM` del comienzo); no invierte
 * una ruta con posibles sentidos únicos.
 */
export function orient(points: RoutePoint[], start: LatLng, closeM = 100): RoutePoint[] {
  if (points.length < 3 || distance(points[0], points.at(-1)!) > closeM) return points;
  const ring = points.slice(0, -1);
  let nearest = 0;
  ring.forEach((p, i) => { if (distance(start, p) < distance(start, ring[nearest])) nearest = i; });
  return [...ring.slice(nearest), ...ring.slice(0, nearest), ring[nearest]];
}

export function libraryIntent(id: string, start: LatLng, targetM: number, points: RoutePoint[], extension?: RoutePoint[]): RouteIntent | null {
  if (points.length < 2 || points.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng))) return null;
  const route = orient(points, start);
  const length = route.reduce((n, p, i) => n + (i ? distance(route[i - 1], p) : 0), 0);
  const available = Math.max(0, targetM * 0.94 - distance(start, route[0]) - distance(start, route.at(-1)!));
  let via: LatLng[];
  if (extension && extension.length > 1 && length < available * 0.8) {
    const extra = orient(extension, route.at(-1)!);
    via = [...anchors(route, length, 3), ...anchors(extra, available - length, 3)];
  } else {
    // Una ruta larga se recorta; el regreso será una carretera calculada por ORS.
    via = anchors(route, Math.min(length, available), 6);
  }
  const waypoints = [point(start), ...via, point(start)].filter((p, i, all) => i === 0 || distance(p, all[i - 1]) > 30);
  if (waypoints.length < 3) return null;
  if (distance(waypoints.at(-1)!, start) > 0) waypoints.push(point(start));
  return { id, kind: 'library', waypoints: waypoints.slice(0, 7).concat(point(start)).filter((p, i, all) => i === 0 || distance(p, all[i - 1]) > 0) };
}

export function passIntent(id: string, start: LatLng, pass: LatLng & { approach?: LatLng; departure?: LatLng }): RouteIntent | null {
  if (!pass.approach || !pass.departure || distance(pass.approach, pass.departure) < 60) return null;
  return { id, kind: 'pass', waypoints: [start, pass.approach, pass, pass.departure, start].map(point) };
}

/** Verifica el resultado del motor antes de atribuirle una referencia o exportarlo. */
export function visitsWaypoints(coords: Coord3[], waypoints: LatLng[]): boolean {
  if (coords.length < 2 || coords.some(c => c.length !== 3 || !c.every(Number.isFinite))) return false;
  if (coords.some((c, i) => i > 0 && haversineM(c[1], c[0], coords[i - 1][1], coords[i - 1][0]) > 5000)) return false;
  return waypoints.every(p => coords.some(c => haversineM(p.lat, p.lng, c[1], c[0]) <= 50));
}
