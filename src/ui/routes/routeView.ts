import { TZDate } from '@date-fns/tz';
import { isSameDay, subWeeks } from 'date-fns';
import type { Coord3, LatLng } from '../../domain/types';
import { TZ } from '../../metrics/aggregate';
import { difficulty, LONG_WINDOW_WEEKS, type Difficulty, type UserReference } from '../../metrics/reference';
import type { Target } from '../../metrics/score';
import type { RejectReason } from '../../routes/analyze';
import type { GenerateResult, GeneratedRoute } from '../../routes/generator';
import { routeSide } from '../../routes/side';
import type { RouteCardData } from './RouteCard';
import { TriangleAlert } from '../icons';

/** Lo que la pantalla Rutas saca de una búsqueda: nombres, tarjetas, valores por defecto y avisos. */

export const DISTANCE_KM = { min: 10, max: 200, step: 5 } as const;
export const ELEVATION_M = { min: 0, max: 4000, step: 100 } as const;
const DEFAULT_KM_WITHOUT_REFERENCE = 50;
const DAY_MS = 24 * 3600_000;

/** Sin referencia, el nivel lo decide el desnivel por km, como en el prototipo: Suave < 11 m/km, Dura > 18. */
const GENERIC_EASY_BELOW_MPK = 11;
const GENERIC_HARD_ABOVE_MPK = 18;
const GENERIC_MPK: Record<Difficulty, number> = { Suave: 8, Media: 14.5, Dura: 21 };
/** Con referencia, el desnivel de cada nivel en proporción a tu desnivel medio (cortes en 0,85 y 1,10). */
const LEVEL_RATIO: Record<Difficulty, number> = { Suave: 0.7, Media: 0.975, Dura: 1.25 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

const SIDES = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
/**
 * Nombre de una vuelta por el lado del inicio hacia el que va: «Vuelta por el norte». Sin
 * topónimos (no hay geocodificador) y sin decir dónde está el inicio.
 */
export function routeName(coords: Coord3[], start: LatLng): string {
  const side = routeSide(coords, start);
  return side < 0 ? 'Vuelta alrededor del inicio' : `Vuelta por el ${SIDES[side]}`;
}

/** Nombres de las rutas de una búsqueda; la segunda hacia el mismo lado lleva un 2, y así. */
export function nameRoutes(routes: Pick<GeneratedRoute, 'coords'>[], start: LatLng): string[] {
  const seen = new Map<string, number>();
  return routes.map((r) => {
    const base = routeName(r.coords, start);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} ${n}`;
  });
}

export function toCardData(route: GeneratedRoute, name: string): RouteCardData {
  return {
    id: route.id,
    name,
    distanceM: route.distanceM,
    elevGainM: route.elevGainM,
    estTimeS: route.estTimeS,
    difficulty: route.difficulty,
    newPct: route.newPct,
    shape: route.coords.map(([lng, lat]) => ({ lat, lng })),
    profile: route.profile,
    steep: route.steep,
    kind: 'circular',
    ...(route.warning ? { notes: [{ icon: TriangleAlert, text: route.warning }] } : {}),
  };
}

const REASON_TEXT: Record<RejectReason, string> = {
  'sin asfaltar': 'sin asfaltar',
  'carretera principal': 'carretera principal',
  pistas: 'con pistas',
  longitud: 'de otra longitud',
  autopista: 'con autopista',
};
const REASON_ORDER = Object.keys(REASON_TEXT) as RejectReason[];

/** Por qué una búsqueda no deja ninguna ruta. */
export function rejectSummary(rejected: GenerateResult['rejected']): string {
  if (rejected.length === 0) return 'ORS no encuentra carreteras desde ese punto. Mueve el inicio a una carretera.';
  const counts = new Map<RejectReason, number>();
  for (const { reason } of rejected) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const parts = [...counts]
    .sort((a, b) => b[1] - a[1] || REASON_ORDER.indexOf(a[0]) - REASON_ORDER.indexOf(b[0]))
    .map(([reason, n]) => `${n} ${REASON_TEXT[reason]}`);
  return `Ninguna candidata pasa el filtro de carretera: ${parts.join(', ')}. Prueba otra distancia u otro inicio.`;
}

/** Nivel de una petición: con referencia, el de las tarjetas; sin ella, por metros de desnivel por km. */
export function levelOf(t: { distanceM: number; elevGainM: number }, ref: UserReference | null): Difficulty {
  if (ref) return difficulty(t, ref);
  const mpk = t.distanceM > 0 ? t.elevGainM / (t.distanceM / 1000) : 0;
  if (mpk < GENERIC_EASY_BELOW_MPK) return 'Suave';
  if (mpk > GENERIC_HARD_ABOVE_MPK) return 'Dura';
  return 'Media';
}

/** Desnivel que corresponde a un nivel, en pasos de 100 m y entre 0 y 4.000 m. */
export function elevationFor(level: Difficulty, distanceM: number, ref: UserReference | null): number {
  const raw =
    ref && ref.avgElevGainM > 0 ? ref.avgElevGainM * LEVEL_RATIO[level] : (distanceM / 1000) * GENERIC_MPK[level];
  return clamp(roundTo(raw, ELEVATION_M.step), ELEVATION_M.min, ELEVATION_M.max);
}

/** Petición por defecto: tu distancia media más un 10 % y tu desnivel medio, prefiriendo carretera nueva. */
export function defaultTarget(ref: UserReference | null): Target {
  const km = ref ? roundTo((ref.avgDistanceM / 1000) * 1.1, DISTANCE_KM.step) : DEFAULT_KM_WITHOUT_REFERENCE;
  const distanceM = clamp(km, DISTANCE_KM.min, DISTANCE_KM.max) * 1000;
  const elevGainM =
    ref && ref.avgElevGainM > 0
      ? clamp(roundTo(ref.avgElevGainM, ELEVATION_M.step), ELEVATION_M.min, ELEVATION_M.max)
      : elevationFor('Media', distanceM, null);
  return { distanceM, elevGainM, preferNew: true };
}

const clock = new Intl.DateTimeFormat('es-ES', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

/** Hora en Madrid: «9:40». */
export function clockTime(t: number): string {
  return clock.format(t);
}

/**
 * Cuándo vuelve la cuota diaria de ORS (24 h después de la primera consulta): «a las 9:40», o
 * «mañana a las 8:47» si cae en otro día de Madrid que `now`.
 */
export function renewsAt(windowStart: number, now: number): string {
  const at = windowStart + DAY_MS;
  const text = clockTime(at);
  const time = text.startsWith('1:') ? `a la ${text}` : `a las ${text}`;
  return isSameDay(new TZDate(at, TZ), new TZDate(now, TZ)) ? time : `mañana ${time}`;
}

/**
 * Las salidas que necesita la referencia de nivel: las últimas 12 semanas de Madrid hasta `now`
 * (`computeReference` prueba 8 y, si no llegan, 12). Leer solo esas evita cargar miles de salidas.
 */
export function referenceRange(now: number): { from: number; to: number } {
  return { from: subWeeks(new TZDate(now, TZ), LONG_WINDOW_WEEKS).getTime(), to: now };
}
