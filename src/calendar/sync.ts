import { listActivities } from '../db/repo';
import { dayRange, localDay, matchWorkouts } from '../metrics/calendar';
import { listWorkouts, saveWorkout } from './calendarRepo';

/** Menor `LocalDate` posible: `listWorkouts` necesita los dos extremos del rango. */
const FIRST_DAY = '0000-01-01';

/**
 * Marca como hechos los entrenos pendientes (`!done && !manual`) hasta hoy que tienen una salida
 * ese día, enlazando la primera. Los marcados o desmarcados a mano no se tocan. Devuelve cuántos marcó.
 */
export async function syncCalendar(): Promise<number> {
  const now = Date.now();
  const pending = (await listWorkouts({ from: FIRST_DAY, to: localDay(now) })).filter((w) => !w.done && !w.manual);
  if (pending.length === 0) return 0;

  // `listWorkouts` los devuelve por fecha: el primero marca desde dónde leer las salidas.
  const acts = await listActivities({ from: dayRange(pending[0].date).from, to: now });
  const byId = new Map(pending.map((w) => [w.id, w]));
  const matches = matchWorkouts(pending, acts);
  for (const { id, activityId } of matches) {
    await saveWorkout({ ...byId.get(id)!, done: true, activityId, manual: false });
  }
  return matches.length;
}
