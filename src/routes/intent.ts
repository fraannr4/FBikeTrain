import type { Coord3, LatLng } from '../domain/types';
import { haversineM } from '../import/summary';
import type { RoutePoint } from './library';

const distance = (a: LatLng, b: LatLng) => haversineM(a.lat, a.lng, b.lat, b.lng);

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

/** Verifica el resultado del motor antes de atribuirle una referencia o exportarlo. */
export function visitsWaypoints(coords: Coord3[], waypoints: LatLng[]): boolean {
  if (coords.length < 2 || coords.some(c => c.length !== 3 || !c.every(Number.isFinite))) return false;
  if (coords.some((c, i) => i > 0 && haversineM(c[1], c[0], coords[i - 1][1], coords[i - 1][0]) > 5000)) return false;
  return waypoints.every(p => coords.some(c => haversineM(p.lat, p.lng, c[1], c[0]) <= 50));
}
