import { TZDate } from '@date-fns/tz';
import { subWeeks } from 'date-fns';
import type { StoredActivity } from '../domain/types';
import { TZ } from './aggregate';

/** Salidas mínimas en la ventana para que haya referencia. */
export const MIN_RIDES = 5;
/** Ventana preferida, en semanas. */
export const SHORT_WINDOW_WEEKS = 8;
/** Ventana de respaldo, en semanas, si la corta no llega a `MIN_RIDES`. */
export const LONG_WINDOW_WEEKS = 12;
/** Por debajo de este cociente con la media, la ruta es Suave. */
export const EASY_BELOW_RATIO = 0.85;
/** Por encima de este cociente con la media, la ruta es Dura. */
export const HARD_ABOVE_RATIO = 1.1;

export type UserReference = {
  source: 'history' | 'declared';
  weeks: 8 | 12 | null;
  rides: number;
  ridesPerWeek: number;
  avgDistanceM: number;
  avgElevGainM: number;
  avgMovingTimeS: number;
  avgSpeedMs: number;
  longestDistanceM: number;
  maxElevGainM: number;
};

export type Difficulty = 'Suave' | 'Media' | 'Dura';

type Effort = { distanceM: number; elevGainM: number };

/**
 * Referencia del usuario con sus salidas de las últimas 8 semanas o, si no llegan a
 * `MIN_RIDES`, de las últimas 12. Sin suficientes salidas, `null`.
 * La ventana va hacia atrás desde `now` en semanas de calendario de Madrid, así que
 * empieza a la misma hora local aunque haya un cambio de hora por medio.
 */
export function computeReference(acts: StoredActivity[], now: number): UserReference | null {
  for (const weeks of [SHORT_WINDOW_WEEKS, LONG_WINDOW_WEEKS] as const) {
    const from = subWeeks(new TZDate(now, TZ), weeks).getTime();
    const inWindow = acts.filter((a) => a.startTime >= from && a.startTime <= now);
    if (inWindow.length >= MIN_RIDES) return summarize(inWindow, weeks);
  }
  return null;
}

function summarize(acts: StoredActivity[], weeks: 8 | 12): UserReference {
  const n = acts.length;
  let distanceM = 0;
  let elevGainM = 0;
  let movingTimeS = 0;
  let longestDistanceM = 0;
  let maxElevGainM = 0;
  for (const { totals: t } of acts) {
    distanceM += t.distanceM;
    elevGainM += t.elevGainM;
    movingTimeS += t.movingTimeS;
    longestDistanceM = Math.max(longestDistanceM, t.distanceM);
    maxElevGainM = Math.max(maxElevGainM, t.elevGainM);
  }
  return {
    source: 'history',
    weeks,
    rides: n,
    ridesPerWeek: n / weeks,
    avgDistanceM: distanceM / n,
    avgElevGainM: elevGainM / n,
    avgMovingTimeS: movingTimeS / n,
    avgSpeedMs: movingTimeS > 0 ? distanceM / movingTimeS : 0,
    longestDistanceM,
    maxElevGainM,
  };
}

/**
 * Suave, Media o Dura según `max(distancia / media, desnivel / media)`.
 * Una dimensión con media 0 no cuenta; si no cuenta ninguna, la ruta es Media.
 */
export function difficulty(x: Effort, ref: UserReference): Difficulty {
  const ratios = [
    ref.avgDistanceM > 0 ? x.distanceM / ref.avgDistanceM : null,
    ref.avgElevGainM > 0 ? x.elevGainM / ref.avgElevGainM : null,
  ].filter((r): r is number => r !== null);
  if (ratios.length === 0) return 'Media';
  const ratio = Math.max(...ratios);
  if (ratio < EASY_BELOW_RATIO) return 'Suave';
  if (ratio > HARD_ABOVE_RATIO) return 'Dura';
  return 'Media';
}

/** Valor de `upliftPct` cuando la media de la dimensión es 0 y no hay base para el porcentaje. */
export const UPLIFT_WITHOUT_AVERAGE = 0;

/**
 * Porcentaje sobre la media de la referencia (positivo si está por encima).
 * Si la media de la dimensión es 0, devuelve `UPLIFT_WITHOUT_AVERAGE` (0) para que el
 * resultado sea siempre un número finito, como fija el bloque Interfaces del plan F4.
 */
export function upliftPct(x: Effort, ref: UserReference, dim: 'distance' | 'elevation'): number {
  const [value, avg] =
    dim === 'distance' ? [x.distanceM, ref.avgDistanceM] : [x.elevGainM, ref.avgElevGainM];
  return avg > 0 ? ((value - avg) / avg) * 100 : UPLIFT_WITHOUT_AVERAGE;
}
