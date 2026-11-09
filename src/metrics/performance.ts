import { TZDate } from '@date-fns/tz';
import { subDays } from 'date-fns';
import type { StoredActivity } from '../domain/types';
import { isTooShort } from '../import/summary';
import { TZ } from './aggregate';

/** Ventana de «Tu rendimiento»: los últimos 30 días hasta `now`, en días de calendario de Madrid. */
export const RECENT_WINDOW_DAYS = 30;
/** Ventana de la referencia (media y rango): los últimos 365 días hasta `now`. */
export const RANGE_WINDOW_DAYS = 365;

/** Cifra de los últimos 30 días frente a la media y el rango de salidas sueltas de 12 meses. */
export type RangeStat = {
  value: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  deltaPct: number | null;
};

export type PerformanceSummary = {
  rides30: number;
  speed: RangeStat;
  elevPerRide: RangeStat;
  cadence: (RangeStat & { ridesWith30: number }) | null;
  longest: RangeStat & { startTime: number | null };
};

/** Salidas válidas en `(now − days, now]`; los días se cuentan a la misma hora local de Madrid. */
function inWindow(acts: StoredActivity[], now: number, days: number): StoredActivity[] {
  const from = subDays(new TZDate(now, TZ), days).getTime();
  return acts.filter((a) => a.startTime > from && a.startTime <= now);
}

const sum = (acts: StoredActivity[], f: (a: StoredActivity) => number): number =>
  acts.reduce((acc, a) => acc + f(a), 0);

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/** Σ distancia / Σ tiempo en movimiento. */
const totalSpeed = (acts: StoredActivity[]) =>
  ratio(sum(acts, (a) => a.totals.distanceM), sum(acts, (a) => a.totals.movingTimeS));

const meanElev = (acts: StoredActivity[]) =>
  ratio(sum(acts, (a) => a.totals.elevGainM), acts.length);

const meanDistance = (acts: StoredActivity[]) =>
  ratio(sum(acts, (a) => a.totals.distanceM), acts.length);

/** Cadencia media ponderada por tiempo en movimiento; solo recibe salidas con cadencia. */
const weightedCadence = (acts: StoredActivity[]) =>
  ratio(
    sum(acts, (a) => a.totals.avgCadence! * a.totals.movingTimeS),
    sum(acts, (a) => a.totals.movingTimeS),
  );

function rangeStat(value: number | null, mean: number | null, perRide: number[]): RangeStat {
  return {
    value,
    mean,
    min: perRide.length > 0 ? Math.min(...perRide) : null,
    max: perRide.length > 0 ? Math.max(...perRide) : null,
    deltaPct: value === null || mean === null || mean === 0 ? null : ((value - mean) / mean) * 100,
  };
}

/**
 * «Tu rendimiento»: cifras de los últimos 30 días frente a la media de los últimos 12 meses
 * y el rango (mínimo y máximo) de las salidas sueltas de esos 12 meses.
 * Se ignoran las salidas demasiado cortas. Sin datos con los que calcular, `null`.
 */
export function performanceSummary(acts: StoredActivity[], now: number): PerformanceSummary {
  const valid = acts.filter((a) => !isTooShort(a.totals));
  const year = inWindow(valid, now, RANGE_WINDOW_DAYS);
  const recent = inWindow(year, now, RECENT_WINDOW_DAYS);

  const longestRecent = recent.reduce<StoredActivity | null>(
    (best, a) => (best === null || a.totals.distanceM > best.totals.distanceM ? a : best),
    null,
  );

  const hasCadence = (a: StoredActivity) => a.totals.avgCadence !== undefined;
  const yearCad = year.filter(hasCadence);
  const recentCad = recent.filter(hasCadence);

  return {
    rides30: recent.length,
    speed: rangeStat(
      totalSpeed(recent),
      totalSpeed(year),
      year.map((a) => a.totals.distanceM / a.totals.movingTimeS),
    ),
    elevPerRide: rangeStat(
      meanElev(recent),
      meanElev(year),
      year.map((a) => a.totals.elevGainM),
    ),
    cadence:
      yearCad.length === 0
        ? null
        : {
            ...rangeStat(
              weightedCadence(recentCad),
              weightedCadence(yearCad),
              yearCad.map((a) => a.totals.avgCadence!),
            ),
            ridesWith30: recentCad.length,
          },
    longest: {
      ...rangeStat(
        longestRecent?.totals.distanceM ?? null,
        meanDistance(year),
        year.map((a) => a.totals.distanceM),
      ),
      startTime: longestRecent?.startTime ?? null,
    },
  };
}
