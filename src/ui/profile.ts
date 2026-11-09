import type { TrackPoint } from '../domain/types';
import { haversineM } from '../import/summary';

/** Un punto del perfil: distancia acumulada (m) y altitud (m). La misma forma que `profile` en F4. */
export type ProfilePoint = { dM: number; ele: number };

/**
 * Reduce el perfil a `max` puntos como mucho, repartidos por índice. Conserva el primero,
 * el último y el más alto, porque la cima es el dato que se rotula.
 */
export function reduceProfile(points: ProfilePoint[], max = 240): ProfilePoint[] {
  if (points.length <= max || max < 3) return points;
  let top = 0;
  for (let i = 1; i < points.length; i++) if (points[i].ele > points[top].ele) top = i;

  const step = (points.length - 1) / (max - 1);
  const picks = new Set<number>();
  for (let k = 0; k < max; k++) picks.add(Math.round(k * step));
  if (!picks.has(top)) {
    // Cambia el índice más cercano a la cima por la cima misma (sin tocar los extremos).
    const near = Math.min(max - 2, Math.max(1, Math.round(top / step)));
    picks.delete(Math.round(near * step));
    picks.add(top);
  }
  return [...picks].sort((a, b) => a - b).map((i) => points[i]);
}

/**
 * Perfil de altitud de un track. Usa `dist` si todos los puntos con altitud la traen y,
 * si no, la distancia haversine acumulada. Descarta los puntos sin `ele`.
 * Con menos de 2 puntos con altitud devuelve `[]`.
 */
export function profileFromTrack(points: TrackPoint[], max = 240): ProfilePoint[] {
  const withEle = points.filter((p): p is TrackPoint & { ele: number } => p.ele !== undefined && Number.isFinite(p.ele));
  if (withEle.length < 2) return [];

  let out: ProfilePoint[];
  if (withEle.every((p) => p.dist !== undefined)) {
    out = withEle.map((p) => ({ dM: p.dist as number, ele: p.ele }));
  } else {
    // La distancia se acumula sobre todos los puntos con GPS, también los que no traen altitud.
    let d = 0;
    let prev: TrackPoint | undefined;
    out = [];
    for (const p of points) {
      if (p.lat !== undefined && p.lng !== undefined) {
        if (prev) d += haversineM(prev.lat as number, prev.lng as number, p.lat, p.lng);
        prev = p;
      }
      if (p.ele !== undefined && Number.isFinite(p.ele)) out.push({ dM: d, ele: p.ele });
    }
  }
  return reduceProfile(out, max);
}

/** Altitud mínima y máxima y la cima (el primer punto más alto). `null` si no hay puntos. */
export function profileExtent(p: ProfilePoint[]): { min: number; max: number; summit: ProfilePoint } | null {
  if (p.length === 0) return null;
  let min = p[0].ele;
  let summit = p[0];
  for (const q of p) {
    if (q.ele < min) min = q.ele;
    if (q.ele > summit.ele) summit = q;
  }
  return { min, max: summit.ele, summit };
}
