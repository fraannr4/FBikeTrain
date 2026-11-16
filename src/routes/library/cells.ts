import { EARTH_RADIUS_M, haversineM } from '../../import/summary.ts';
import { MAX_TRACK_GAP_M } from '../../metrics/grid.ts';
import { cellKey } from '../../metrics/routes.ts';

/** Punto de una línea de referencia: `[lng, lat]` o `[lng, lat, ele]`, como GeoJSON. */
export type LinePoint = [lng: number, lat: number] | [lng: number, lat: number, ele: number];

/** Dos vueltas se solapan demasiado si comparten esta fracción de las celdas de la más corta. */
export const OVERLAP_LIMIT = 0.7;

type LatLng = { lat: number; lng: number };

/**
 * Intercala puntos en línea recta para que ningún tramo supere `stepM`. Los vértices originales
 * se conservan; la altitud se interpola solo si la tienen los dos extremos del tramo.
 */
export function densify(line: LinePoint[], stepM = MAX_TRACK_GAP_M): LinePoint[] {
  if (line.length === 0) return [];
  const out: LinePoint[] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const [aLng, aLat, aEle] = line[i - 1];
    const [bLng, bLat, bEle] = line[i];
    const steps = Math.ceil(haversineM(aLat, aLng, bLat, bLng) / stepM);
    for (let k = 1; k < steps; k++) {
      const f = k / steps;
      const lng = aLng + (bLng - aLng) * f;
      const lat = aLat + (bLat - aLat) * f;
      out.push(aEle !== undefined && bEle !== undefined ? [lng, lat, aEle + (bEle - aEle) * f] : [lng, lat]);
    }
    out.push(line[i]);
  }
  return out;
}

/** Celdas de la rejilla de 200 m por las que pasa la línea densificada. */
export function lineCells(line: LatLng[]): Set<string> {
  return new Set(densify(line.map((p): LinePoint => [p.lng, p.lat])).map(([lng, lat]) => cellKey(lat, lng)));
}

/** Celdas compartidas entre las del conjunto menor: |A∩B| / min(|A|, |B|). Vacío, 0. */
export function cellSetOverlap(a: Set<string>, b: Set<string>): number {
  const smaller = Math.min(a.size, b.size);
  if (smaller === 0) return 0;
  let shared = 0;
  for (const c of a) if (b.has(c)) shared++;
  return shared / smaller;
}

/** `cellSetOverlap` de las celdas de las dos líneas: la proporción respecto a la más corta. */
export function cellOverlap(a: LatLng[], b: LatLng[]): number {
  return cellSetOverlap(lineCells(a), lineCells(b));
}

/** Distancia mínima en metros del punto a la polilínea, proyectada en plano local. */
export function passDistanceM(lat: number, lng: number, line: LinePoint[]): number {
  const k = (Math.PI / 180) * EARTH_RADIUS_M;
  const cos = Math.cos(lat * (Math.PI / 180));
  const xy = line.map(([x, y]) => [(x - lng) * k * cos, (y - lat) * k] as const);
  let best = Infinity;
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1];
    const [bx, by] = xy[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
