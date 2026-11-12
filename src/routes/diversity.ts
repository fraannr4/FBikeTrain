import type { LatLng } from '../domain/types';
import { haversineM } from '../import/summary';
import { overlap, OVERLAP_LIMIT } from './catalog/recommend';

/** Separación mínima entre los rumbos de dos propuestas de la lista final. */
export const MIN_HEADING_GAP_DEG = 45;

/** Rumbo de `from` a `to`, en grados: 0 norte, 90 este. */
export function bearingDeg(from: LatLng, to: LatLng): number {
  const rad = Math.PI / 180;
  const y = Math.sin((to.lng - from.lng) * rad) * Math.cos(to.lat * rad);
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lng - from.lng) * rad);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

/** Hacia dónde va una ruta: el rumbo desde el inicio a su punto más lejano. */
export function routeBearing(line: LatLng[], start: LatLng): number {
  // Una línea vacía no tiene rumbo: se toma el norte para no romper la selección.
  if (line.length === 0) return 0;
  let far = line[0];
  let farM = -1;
  for (const p of line) {
    const d = haversineM(start.lat, start.lng, p.lat, p.lng);
    if (d > farM) { farM = d; far = p; }
  }
  return bearingDeg(start, far);
}

export const angleGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** Repite recorrido: una pasa por la otra más de `OVERLAP_LIMIT`, en cualquier sentido. */
export const sameRoute = (a: LatLng[], b: LatLng[]) => Math.max(overlap(a, b), overlap(b, a)) > OVERLAP_LIMIT;

/** Cabe en la lista si su rumbo dista `minGapDeg` de cada elegida y no repite el recorrido de ninguna. */
export function fitsDiversity(line: LatLng[], start: LatLng, chosen: LatLng[][], minGapDeg: number = MIN_HEADING_GAP_DEG): boolean {
  const heading = routeBearing(line, start);
  return chosen.every((c) => angleGap(heading, routeBearing(c, start)) >= minGapDeg && !sameRoute(line, c));
}
