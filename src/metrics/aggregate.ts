import { TZDate } from '@date-fns/tz';
import {
  addDays,
  addMonths,
  addWeeks,
  format,
  startOfDay,
  startOfISOWeek,
  startOfMonth,
  subWeeks,
} from 'date-fns';
import { es } from 'date-fns/locale';
import type { StoredActivity } from '../domain/types';

/** Zona horaria de agregación: los días, las semanas y los meses se cortan a medianoche de Madrid. */
export const TZ = 'Europe/Madrid';
/** Semanas anteriores con las que se compara la semana actual en Inicio. */
export const DEFAULT_COMPARE_WEEKS = 4;

export type Period = 'day' | 'week' | 'month';

export type PeriodTotals = {
  /** Inicio del periodo en epoch ms (medianoche local en Madrid). */
  start: number;
  label: string;
  distanceM: number;
  elevGainM: number;
  movingTimeS: number;
  rides: number;
  avgSpeedMs: number;
};

const LABEL_FORMAT: Record<Period, string> = { day: 'd MMM', week: 'd MMM', month: 'MMM yyyy' };

const START_OF: Record<Period, (d: TZDate) => TZDate> = {
  day: startOfDay,
  week: startOfISOWeek,
  month: startOfMonth,
};

const NEXT: Record<Period, (d: TZDate) => TZDate> = {
  day: (d) => addDays(d, 1),
  week: (d) => addWeeks(d, 1),
  month: (d) => addMonths(d, 1),
};

const startOfPeriod = (period: Period, d: TZDate): TZDate => START_OF[period](d);

const nextPeriod = (period: Period, d: TZDate): TZDate => NEXT[period](d);

const speed = (distanceM: number, movingTimeS: number): number =>
  movingTimeS > 0 ? distanceM / movingTimeS : 0;

/** Variación en %, o `null` si no hay referencia con la que comparar. */
const pct = (current: number, reference: number): number | null =>
  reference === 0 ? null : ((current - reference) / reference) * 100;

/**
 * Totales por periodo entre `from` y `to` (epoch ms), ambos incluidos.
 * Devuelve todos los periodos del rango, también los vacíos con 0.
 */
export function aggregate(
  acts: StoredActivity[],
  period: Period,
  from: number,
  to: number,
): PeriodTotals[] {
  const periods: PeriodTotals[] = [];
  let d = startOfPeriod(period, new TZDate(from, TZ));
  for (; d.getTime() <= to; d = nextPeriod(period, d)) {
    periods.push({
      start: d.getTime(),
      label: format(d, LABEL_FORMAT[period], { locale: es }),
      distanceM: 0,
      elevGainM: 0,
      movingTimeS: 0,
      rides: 0,
      avgSpeedMs: 0,
    });
  }

  // Los periodos son contiguos y ordenados: cada salida se ubica comparando epoch ms, sin crear un
  // TZDate por salida (con miles de salidas, eso bloqueaba la pantalla varios segundos).
  const end = d.getTime();
  for (const a of acts) {
    const t = a.startTime;
    if (periods.length === 0 || t < periods[0].start || t >= end) continue;
    let lo = 0;
    let hi = periods.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (periods[mid].start <= t) lo = mid;
      else hi = mid - 1;
    }
    const p = periods[lo];
    p.distanceM += a.totals.distanceM;
    p.elevGainM += a.totals.elevGainM;
    p.movingTimeS += a.totals.movingTimeS;
    p.rides += 1;
  }

  for (const p of periods) p.avgSpeedMs = speed(p.distanceM, p.movingTimeS);
  return periods;
}

/**
 * Semana actual frente a la media de las `weeks` semanas anteriores completas.
 * Las semanas sin salidas cuentan en la media.
 */
export function currentWeekVsAverage(
  acts: StoredActivity[],
  now: number,
  weeks = DEFAULT_COMPARE_WEEKS,
): {
  current: PeriodTotals;
  avg: PeriodTotals;
  deltaPct: {
    distance: number | null;
    elev: number | null;
    time: number | null;
    /** `null` si esta semana no hay salidas o la velocidad media de referencia es 0. */
    speed: number | null;
    rides: number | null;
  };
} {
  const weekStart = startOfISOWeek(new TZDate(now, TZ));
  const [current] = aggregate(acts, 'week', now, now);
  const history = aggregate(
    acts,
    'week',
    subWeeks(weekStart, weeks).getTime(),
    subWeeks(weekStart, 1).getTime(),
  );

  const sum = (key: 'distanceM' | 'elevGainM' | 'movingTimeS' | 'rides') =>
    history.reduce((acc, p) => acc + p[key], 0);
  const distanceM = sum('distanceM');
  const movingTimeS = sum('movingTimeS');
  const avg: PeriodTotals = {
    start: history[0].start,
    label: history[0].label,
    distanceM: distanceM / weeks,
    elevGainM: sum('elevGainM') / weeks,
    movingTimeS: movingTimeS / weeks,
    rides: sum('rides') / weeks,
    avgSpeedMs: speed(distanceM, movingTimeS),
  };

  return {
    current,
    avg,
    deltaPct: {
      distance: pct(current.distanceM, avg.distanceM),
      elev: pct(current.elevGainM, avg.elevGainM),
      time: pct(current.movingTimeS, avg.movingTimeS),
      speed: current.rides === 0 ? null : pct(current.avgSpeedMs, avg.avgSpeedMs),
      rides: pct(current.rides, avg.rides),
    },
  };
}
