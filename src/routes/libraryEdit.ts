import type { LatLng } from '../domain/types';
import { haversineM } from '../import/summary';
import { replaceReferenceRoutePoints, type ReferenceRoute, type RoutePoint } from './library';
import { fetchRoadPath } from './roadPath';

export type RoadEdit = { kind: 'extend' | 'prepend' | 'detour'; point: LatLng; from?: number; to?: number };
const gap = (a: RoutePoint, b: RoutePoint) => haversineM(a.lat, a.lng, b.lat, b.lng);
function join(a: RoutePoint[], b: RoutePoint[]): RoutePoint[] {
  const last = a[a.length - 1]; const first = b[0];
  // Un metro cubre redondeo de exportación; no aceptar la tolerancia de snapping de 30m como unión.
  if (!last || !first || gap(last, first) > 1) throw new Error('La conexión no coincide con el trazado original sobre la carretera. No hemos unido los puntos con una recta. Selecciona otro punto del track.');
  return [...a, ...b.slice(1)];
}
/** Añade o cambia geometría usando el motor de carreteras, nunca mediante la respuesta textual de IA. */
export async function applyRoadEdit(route: ReferenceRoute, edit: RoadEdit, key: string, signal?: AbortSignal, road = fetchRoadPath): Promise<ReferenceRoute> {
  const p = route.points;
  let next: RoutePoint[];
  if (edit.kind === 'extend') next = join(p, await road(key, [p[p.length - 1], edit.point], signal));
  else if (edit.kind === 'prepend') next = join(await road(key, [edit.point, p[0]], signal), p);
  else {
    const from = edit.from; const to = edit.to;
    if (from === undefined || to === undefined || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to >= p.length || from >= to) throw new Error('Selecciona un tramo válido para modificar.');
    const connection = await road(key, [p[from], edit.point, p[to]], signal);
    next = join(join(p.slice(0, from + 1), connection), p.slice(to));
  }
  if (signal?.aborted) throw new DOMException('Cambio cancelado', 'AbortError');
  return replaceReferenceRoutePoints(route, next);
}
