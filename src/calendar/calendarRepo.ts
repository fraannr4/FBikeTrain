import { db } from '../db/db';
import type { Goal, LocalDate, PlannedWorkout } from '../domain/types';

const CHANGED_KEY = 'calendarChangedAt';
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function newId(): string {
  return crypto.randomUUID();
}

/** Fecha por la que se ordena un objetivo: `date` en un evento, `start` en uno de volumen. */
export function goalSortDate(g: Goal): LocalDate {
  return g.kind === 'event' ? g.date : g.start;
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isPositive = (v: unknown): boolean => typeof v === 'number' && v > 0;
const isLocalDate = (v: unknown): v is string => typeof v === 'string' && LOCAL_DATE_RE.test(v);
/** Día de la semana de una fecha de calendario (0 domingo, 1 lunes). No depende de la zona. */
const weekday = (d: string): number => new Date(`${d}T00:00:00Z`).getUTCDay();

export function isValidGoal(x: unknown): x is Goal {
  if (typeof x !== 'object' || x === null) return false;
  const g = x as Record<string, unknown>;
  if (!isText(g.id) || !isText(g.title) || typeof g.createdAt !== 'number') return false;
  if (g.kind === 'event') {
    return isLocalDate(g.date) && (isPositive(g.distanceM) || isPositive(g.elevGainM));
  }
  if (g.kind === 'volume') {
    if (!isLocalDate(g.start)) return false;
    const aligned =
      g.period === 'week' ? weekday(g.start) === 1 : g.period === 'month' ? g.start.endsWith('-01') : false;
    return aligned && (isPositive(g.distanceM) || isPositive(g.elevGainM) || isPositive(g.movingTimeS));
  }
  return false;
}

/** Evento de `window` tras cada escritura en el calendario o los objetivos (el contador de Plan lo escucha). */
export const CALENDAR_CHANGED_EVENT = 'fbt:calendar';

/** Ejecuta una escritura, anota `calendarChangedAt` en la misma transacción y avisa con `CALENDAR_CHANGED_EVENT`. */
async function write(fn: () => Promise<unknown>): Promise<void> {
  await db.transaction('rw', db.calendar, db.goals, db.meta, async () => {
    await fn();
    await db.meta.put({ key: CHANGED_KEY, value: Date.now() });
  });
  window.dispatchEvent(new Event(CALENDAR_CHANGED_EVENT));
}

export function saveWorkout(w: PlannedWorkout): Promise<void> {
  return write(() => db.calendar.put(w));
}

export function deleteWorkout(id: string): Promise<void> {
  return write(() => db.calendar.delete(id));
}

/** Entrenos ordenados por fecha. `range` con los dos extremos incluidos. */
export function listWorkouts(range?: { from: LocalDate; to: LocalDate }): Promise<PlannedWorkout[]> {
  return range
    ? db.calendar.where('date').between(range.from, range.to, true, true).toArray()
    : db.calendar.orderBy('date').toArray();
}

/** Marca o desmarca a mano: pone `manual` y, al desmarcar, quita el enlace a la salida. */
export function setWorkoutDone(id: string, done: boolean): Promise<void> {
  return write(() =>
    db.calendar
      .where('id')
      .equals(id)
      .modify((w) => {
        w.done = done;
        w.manual = true;
        if (!done) delete w.activityId;
      }),
  );
}

export function saveGoal(g: Goal): Promise<void> {
  if (!isValidGoal(g)) return Promise.reject(new Error('invalid goal'));
  return write(() => db.goals.put(g));
}

export function deleteGoal(id: string): Promise<void> {
  return write(() => db.goals.delete(id));
}

/** Todos los objetivos, por `goalSortDate` y, si empatan, por `createdAt`. */
export async function listGoals(): Promise<Goal[]> {
  const goals = await db.goals.toArray();
  return goals.sort((a, b) => goalSortDate(a).localeCompare(goalSortDate(b)) || a.createdAt - b.createdAt);
}
