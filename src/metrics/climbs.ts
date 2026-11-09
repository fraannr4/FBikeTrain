import type { DetectedClimb, TrackPoint } from '../domain/types';
import { haversineM } from '../import/summary';

/** Una subida mide al menos esto (m)... */
export const CLIMB_MIN_LENGTH_M = 1000;
/** ...con una pendiente media de al menos esto (%). */
export const CLIMB_MIN_GRADE_PCT = 3;
/** Una bajada mayor que esto (m) desde la cima parte la subida en dos. */
export const CLIMB_SPLIT_DROP_M = 10;
/** Anchura de la ventana de suavizado de la altitud (m): la media de los puntos a ±la mitad. */
export const SMOOTH_WINDOW_M = 100;
/** Tramo con el que se recortan los extremos de una subida que aún no pica (m). */
export const TRIM_WINDOW_M = 50;

export type ProfilePoint = {
  /** Índice en el track. */
  i: number;
  distM: number;
  /** Altitud suavizada (m). */
  ele: number;
  t: number;
  lat: number;
  lng: number;
};

/** Perfil de los puntos con posición y altitud: distancia acumulada y altitud media a ±SMOOTH_WINDOW_M/2. */
export function buildProfile(points: TrackPoint[]): ProfilePoint[] {
  const raw: ProfilePoint[] = [];
  points.forEach((p, i) => {
    if (p.lat === undefined || p.lng === undefined || p.ele === undefined) return;
    const prev = raw[raw.length - 1];
    const distM = prev ? prev.distM + haversineM(prev.lat, prev.lng, p.lat, p.lng) : 0;
    raw.push({ i, distM, ele: p.ele, t: p.t, lat: p.lat, lng: p.lng });
  });

  const half = SMOOTH_WINDOW_M / 2;
  const prefix = [0];
  for (const p of raw) prefix.push(prefix[prefix.length - 1] + p.ele);
  let lo = 0;
  let hi = 0;
  return raw.map((p) => {
    while (raw[lo].distM < p.distM - half) lo++;
    while (hi < raw.length && raw[hi].distM <= p.distM + half) hi++;
    return { ...p, ele: (prefix[hi] - prefix[lo]) / (hi - lo) };
  });
}

/** Pendiente (%) entre a y b del perfil. */
const grade = (p: ProfilePoint[], a: number, b: number) => ((p[b].ele - p[a].ele) / (p[b].distM - p[a].distM)) * 100;

/** Pendiente de los TRIM_WINDOW_M siguientes a `s` sin pasar de `k`; null si no caben. */
function gradeAhead(p: ProfilePoint[], s: number, k: number): number | null {
  let m = s + 1;
  while (m <= k && p[m].distM - p[s].distM < TRIM_WINDOW_M) m++;
  return m <= k ? grade(p, s, m) : null;
}

/** Pendiente de los TRIM_WINDOW_M anteriores a `k` sin bajar de `s`; null si no caben. */
function gradeBehind(p: ProfilePoint[], s: number, k: number): number | null {
  let m = k - 1;
  while (m >= s && p[k].distM - p[m].distM < TRIM_WINDOW_M) m--;
  return m >= s ? grade(p, m, k) : null;
}

/** Subidas del track (≥ CLIMB_MIN_LENGTH_M al ≥ CLIMB_MIN_GRADE_PCT), ordenadas por distancia de inicio. */
export function detectClimbs(points: TrackPoint[]): DetectedClimb[] {
  const p = buildProfile(points);
  if (p.length < 2) return [];

  // Tramos valle → cima: una bajada de más de CLIMB_SPLIT_DROP_M cierra el tramo.
  const candidates: [number, number][] = [];
  let s = 0;
  let k = 0;
  for (let j = 1; j < p.length; j++) {
    if (p[j].ele < p[s].ele && p[k].ele - p[s].ele < CLIMB_SPLIT_DROP_M) s = k = j;
    else if (p[j].ele > p[k].ele) k = j;
    else if (p[k].ele - p[j].ele > CLIMB_SPLIT_DROP_M) {
      candidates.push([s, k]);
      s = k = j;
    }
  }
  candidates.push([s, k]);

  const climbs: DetectedClimb[] = [];
  for (let [a, b] of candidates) {
    // Recorta los extremos que aún no pican, para que el inicio no dependa de cómo se llega.
    for (let g = gradeAhead(p, a, b); g !== null && g < CLIMB_MIN_GRADE_PCT; g = gradeAhead(p, a, b)) a++;
    for (let g = gradeBehind(p, a, b); g !== null && g < CLIMB_MIN_GRADE_PCT; g = gradeBehind(p, a, b)) b--;

    const lengthM = p[b].distM - p[a].distM;
    if (lengthM < CLIMB_MIN_LENGTH_M) continue;
    const gainM = p[b].ele - p[a].ele;
    const avgGradePct = (gainM / lengthM) * 100;
    if (avgGradePct < CLIMB_MIN_GRADE_PCT) continue;
    const timeS = (p[b].t - p[a].t) / 1000;
    climbs.push({
      startIdx: p[a].i,
      endIdx: p[b].i,
      start: { lat: p[a].lat, lng: p[a].lng },
      end: { lat: p[b].lat, lng: p[b].lng },
      startDistM: p[a].distM,
      lengthM,
      gainM,
      avgGradePct,
      timeS,
      avgSpeedMs: lengthM / timeS,
      vamMh: gainM / (timeS / 3600),
    });
  }
  return climbs;
}
