import { newRoadPct } from '../metrics/grid';
import { difficulty, type Difficulty, type UserReference } from '../metrics/reference';
import { scoreCandidate, type Target } from '../metrics/score';
import type { RouteCandidate } from './analyze';
import { geometryQuality } from './quality';

/**
 * Constantes y puntuación comunes del adaptador de rutas (`adapt.ts`) y del generador de la
 * biblioteca (`library/generate.ts`).
 */

/** Puntos de paso de cada vuelta circular. */
export const ROUND_TRIP_POINTS = 4;

/**
 * La distancia pedida es un techo blando: se apunta algo por debajo (50 km dan unos 47) y lo que
 * se pasa cuenta más que lo que se queda corto (ver `analyze.ts` y `score.ts`).
 */
export const AIM_FRACTION = 0.94;
/** Cuánto se pasa ORS de la longitud pedida en la primera vuelta; las siguientes lo miden. */
export const INITIAL_ROAD_FACTOR = 1.15;
/** Fracción máxima de retroceso admitida en una vuelta dirigida por un puerto o una referencia. */
export const MAX_INTENT_BACKTRACK = 0.15;

export type GeneratedRoute = RouteCandidate & {
  /** Referencia efectivamente recorrida; no basta con que se haya pedido. */
  intentId?: string;
  newPct: number;
  score: number;
  difficulty: Difficulty | null;
  estTimeS: number | null;
  /** Qué incumple o qué conviene revisar de la vuelta. */
  warning?: string;
};

/** Puntuación, carretera nueva, dificultad y tiempo de una candidata; aviso si tiene retrocesos o lazos. */
export function rateCandidate(c: RouteCandidate, target: Target, deps: { reference: UserReference | null; visited: ReadonlySet<string> }): GeneratedRoute {
  const newPct = newRoadPct(c.coords, deps.visited);
  const ref = deps.reference;
  const quality = geometryQuality(c.coords);
  return {
    ...c,
    newPct,
    score: Math.max(0, scoreCandidate({ distanceM: c.distanceM, elevGainM: c.elevGainM, newPct }, target) - quality.penalty - Math.min(0.3, c.mainRoadPct / 100)),
    ...(quality.penalty > 0 ? { warning: 'Posibles tramos de ida y vuelta o pequeños bucles locales. Revisa el recorrido antes de salir.' } : {}),
    difficulty: ref ? difficulty(c, ref) : null,
    estTimeS: ref && ref.avgSpeedMs > 0 ? c.distanceM / ref.avgSpeedMs : null,
  };
}
