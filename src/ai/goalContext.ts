import type { Goal, LocalDate, StoredActivity, VolumeGoal } from '../domain/types';
import { periodStartOf, volumeProgress } from '../metrics/calendar';
import type { AiGoal } from './contracts';
import { nextGoal } from './workoutPlanner';

/**
 * El objetivo del usuario tal como lo recibe la IA en rutas y empalmes. Módulo puro: quien lo llama
 * lee los objetivos y las salidas.
 */

/** Más lejos, el evento no orienta la ruta de hoy; además, el servicio común no admite más días. */
const MAX_EVENT_DAYS = 730;

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Prioridad al evento futuro más próximo; si no hay, el objetivo de volumen cuyo periodo contiene
 * `today` con menos días restantes. Lo restante es objetivo − hecho, nunca negativo; km con un
 * decimal, m enteros. `null` si no hay ninguno vigente. Nunca lleva el nombre ni el lugar.
 */
export function aiGoal(goals: Goal[], acts: StoredActivity[], now: number, today: LocalDate): AiGoal | null {
  const event = nextGoal(goals, today);
  if (event && event.diasHasta <= MAX_EVENT_DAYS) return { tipo: 'evento', ...event };

  const current = goals
    .filter((g): g is VolumeGoal => g.kind === 'volume' && periodStartOf(g.period, today) === g.start)
    .map((g) => volumeProgress(g, acts, now))
    .sort((a, b) => a.daysLeft - b.daysLeft)[0];
  if (!current) return null;
  const left = (key: 'distanceM' | 'elevGainM') => {
    const t = current.targets.find((x) => x.key === key);
    return t ? Math.max(0, t.target - t.value) : null;
  };
  const distanceM = left('distanceM');
  const elevGainM = left('elevGainM');
  return {
    tipo: 'volumen',
    diasRestantes: current.daysLeft,
    distanciaRestanteKm: distanceM === null ? null : round1(distanceM / 1000),
    desnivelRestanteM: elevGainM === null ? null : Math.round(elevGainM),
  };
}
