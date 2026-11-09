import { TZDate } from '@date-fns/tz';
import {
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  endOfDay,
  format,
  startOfDay,
  startOfISOWeek,
  startOfMonth,
  subWeeks,
} from 'date-fns';
import type {
  EventGoal,
  LocalDate,
  PlannedWorkout,
  StoredActivity,
  VolumeGoal,
} from '../domain/types';
import { aggregate, TZ } from './aggregate';

/** Periodos de un objetivo de volumen: `Period` sin `'day'`. */
type GoalPeriod = VolumeGoal['period'];

/** Semanas hacia atrás, desde hoy o la fecha del objetivo, en las que se busca la mejor salida. */
export const GOAL_WINDOW_WEEKS = 8;

const LOCAL_DATE_FORMAT = 'yyyy-MM-dd';

/** Medianoche de Madrid del día `d` (`yyyy-MM-dd`). */
function parseLocal(d: LocalDate): TZDate {
  const [y, m, day] = d.split('-').map(Number);
  return new TZDate(y, m - 1, day, TZ);
}

const toLocal = (d: TZDate): LocalDate => format(d, LOCAL_DATE_FORMAT);

/** Día local de Madrid al que pertenece el instante `t` (epoch ms). */
export function localDay(t: number): LocalDate {
  return toLocal(new TZDate(t, TZ));
}

/** Día `d` en Madrid, de 00:00:00.000 a 23:59:59.999 (epoch ms). Dura 23 o 25 h con cambio de hora. */
export function dayRange(d: LocalDate): { from: number; to: number } {
  const day = parseLocal(d);
  return { from: startOfDay(day).getTime(), to: endOfDay(day).getTime() };
}

/** Días de calendario de Madrid desde hoy hasta `d`; negativo si `d` ya pasó. */
export function daysUntil(d: LocalDate, now: number): number {
  return differenceInCalendarDays(parseLocal(d), new TZDate(now, TZ));
}

/**
 * Entrenos pendientes (`!done && !manual`) emparejados con la primera salida de su día local.
 * Los entrenos sin salida ese día no aparecen.
 */
export function matchWorkouts(
  workouts: PlannedWorkout[],
  acts: StoredActivity[],
): { id: string; activityId: string }[] {
  const firstByDay = new Map<LocalDate, StoredActivity>();
  for (const a of acts) {
    const day = localDay(a.startTime);
    const prev = firstByDay.get(day);
    if (!prev || a.startTime < prev.startTime) firstByDay.set(day, a);
  }

  const matches: { id: string; activityId: string }[] = [];
  for (const w of workouts) {
    if (w.done || w.manual) continue;
    const a = firstByDay.get(w.date);
    if (a) matches.push({ id: w.id, activityId: a.id });
  }
  return matches;
}

export type GoalProgress = {
  daysLeft: number;
  longest?: { activityId: string; distanceM: number; pct: number };
  mostClimb?: { activityId: string; elevGainM: number; pct: number };
  pct: number;
};

/** La salida con mayor `key`; con empate, la más temprana. */
function best(acts: StoredActivity[], key: 'distanceM' | 'elevGainM'): StoredActivity | undefined {
  let top: StoredActivity | undefined;
  for (const a of acts) {
    if (
      !top ||
      a.totals[key] > top.totals[key] ||
      (a.totals[key] === top.totals[key] && a.startTime < top.startTime)
    ) {
      top = a;
    }
  }
  return top;
}

/**
 * Progreso hacia un objetivo de evento: la salida más larga y la de más desnivel de las últimas
 * `GOAL_WINDOW_WEEKS` semanas, sin pasar de la fecha del objetivo. `pct` sin tope; el total es el
 * menor de los definidos, o 0 si no hay salidas en la ventana.
 */
export function goalProgress(goal: EventGoal, acts: StoredActivity[], now: number): GoalProgress {
  const end = Math.min(now, dayRange(goal.date).to);
  const start = subWeeks(new TZDate(end, TZ), GOAL_WINDOW_WEEKS).getTime();
  const inWindow = acts.filter((a) => a.startTime >= start && a.startTime <= end);

  const progress: GoalProgress = { daysLeft: daysUntil(goal.date, now), pct: 0 };
  const pcts: number[] = [];

  const long = best(inWindow, 'distanceM');
  if (goal.distanceM && long) {
    const pct = (long.totals.distanceM / goal.distanceM) * 100;
    progress.longest = { activityId: long.id, distanceM: long.totals.distanceM, pct };
    pcts.push(pct);
  }

  const climb = best(inWindow, 'elevGainM');
  if (goal.elevGainM && climb) {
    const pct = (climb.totals.elevGainM / goal.elevGainM) * 100;
    progress.mostClimb = { activityId: climb.id, elevGainM: climb.totals.elevGainM, pct };
    pcts.push(pct);
  }

  if (pcts.length > 0) progress.pct = Math.min(...pcts);
  return progress;
}

/** Primer día del periodo que contiene `d`: el lunes de su semana ISO o el día 1 de su mes. */
export function periodStartOf(period: GoalPeriod, d: LocalDate): LocalDate {
  const day = parseLocal(d);
  return toLocal(period === 'week' ? startOfISOWeek(day) : startOfMonth(day));
}

/**
 * Periodo que empieza en `start`: de 00:00 de Madrid de `start` a 00:00 del siguiente periodo − 1 ms.
 * `days` son los días de calendario (7, o de 28 a 31).
 */
export function periodRange(
  period: GoalPeriod,
  start: LocalDate,
): { from: number; to: number; days: number } {
  const from = parseLocal(start);
  const next = period === 'week' ? addWeeks(from, 1) : addMonths(from, 1);
  return {
    from: from.getTime(),
    to: next.getTime() - 1,
    days: differenceInCalendarDays(next, from),
  };
}

export type VolumeKey = 'distanceM' | 'elevGainM' | 'movingTimeS';

export type VolumeTarget = {
  key: VolumeKey;
  target: number;
  value: number;
  pct: number;
  expected: number;
  aheadPct: number;
};

export type VolumeProgress = {
  status: 'future' | 'current' | 'past';
  daysTotal: number;
  daysLeft: number;
  rides: number;
  targets: VolumeTarget[];
  pct: number;
  expectedPct: number;
  aheadPct: number;
};

const VOLUME_KEYS: VolumeKey[] = ['distanceM', 'elevGainM', 'movingTimeS'];

/**
 * Progreso de un objetivo de volumen: suma de las salidas del periodo en Madrid frente a cada meta,
 * y ritmo esperado lineal sobre el tiempo real del periodo (un mes con cambio de hora dura 743 o 745 h).
 * `aheadPct` > 0 es ir por delante, en puntos porcentuales.
 */
export function volumeProgress(goal: VolumeGoal, acts: StoredActivity[], now: number): VolumeProgress {
  const { from, to, days } = periodRange(goal.period, goal.start);
  const [totals] = aggregate(acts, goal.period, from, from);

  const end = to + 1;
  const expectedPct = ((Math.min(Math.max(now, from), end) - from) / (end - from)) * 100;

  const targets: VolumeTarget[] = [];
  for (const key of VOLUME_KEYS) {
    const target = goal[key];
    if (!target) continue;
    const value = totals[key];
    const pct = (value / target) * 100;
    targets.push({
      key,
      target,
      value,
      pct,
      expected: (target * expectedPct) / 100,
      aheadPct: pct - expectedPct,
    });
  }
  const pct = targets.length > 0 ? Math.min(...targets.map((t) => t.pct)) : 0;

  const status = now < from ? 'future' : now > to ? 'past' : 'current';
  const lastDay = toLocal(new TZDate(to, TZ));
  const daysLeft =
    status === 'future' ? days : status === 'past' ? 0 : daysUntil(lastDay, now) + 1;

  return {
    status,
    daysTotal: days,
    daysLeft,
    rides: totals.rides,
    targets,
    pct,
    expectedPct,
    aheadPct: pct - expectedPct,
  };
}
