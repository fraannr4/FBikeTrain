import { TZDate } from '@date-fns/tz';
import { subWeeks } from 'date-fns';
import { db } from '../db/db';
import type { ClimbEffort, StoredActivity } from '../domain/types';
import { TZ } from '../metrics/aggregate';
import { computeReference, LONG_WINDOW_WEEKS, type UserReference } from '../metrics/reference';
import type { LevelSummary } from './contracts';
export type { LevelSummary } from './contracts';

/**
 * Resumen del nivel que se envía a la IA: solo cifras, nunca coordenadas.
 * Km y km/h con 1 decimal; metros, minutos y VAM en enteros.
 */

/** Respuestas a las 3 preguntas iniciales, cuando no hay historial suficiente. */
export type InitialAnswers = { kmPorSalida: number; desnivelPorSalidaM: number; velocidadMediaKmh: number };

/** Clave de `db.meta` donde se guardan las respuestas iniciales. */
export const DECLARED_REFERENCE_KEY = 'declaredReference';

const MS_PER_KMH = 1 / 3.6;
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Resumen del nivel a partir de la referencia y de los esfuerzos en subidas.
 * `climbs` deben ser los de la ventana de la referencia (ver `climbsInWindow`); sin esfuerzos,
 * la VAM y la subida más larga van en `null`. La pendiente se da con 1 decimal.
 */
export function buildLevelSummary(ref: UserReference, climbs: ClimbEffort[]): LevelSummary {
  let longest: ClimbEffort | null = null;
  let vamSum = 0;
  for (const c of climbs) {
    vamSum += c.vamMh;
    if (!longest || c.lengthM > longest.lengthM) longest = c;
  }
  return {
    fuente: ref.source === 'history' ? 'historial' : 'declarado',
    semanas: ref.weeks,
    salidas: ref.rides,
    salidasPorSemana: round1(ref.ridesPerWeek),
    distanciaMediaKm: round1(ref.avgDistanceM / 1000),
    desnivelMedioM: Math.round(ref.avgElevGainM),
    tiempoMedioMin: Math.round(ref.avgMovingTimeS / 60),
    velocidadMediaKmh: round1(ref.avgSpeedMs / MS_PER_KMH),
    distanciaMaxKm: round1(ref.longestDistanceM / 1000),
    desnivelMaxM: Math.round(ref.maxElevGainM),
    vamMediaMh: climbs.length > 0 ? Math.round(vamSum / climbs.length) : null,
    subidaMasLarga: longest
      ? { km: round1(longest.lengthM / 1000), pendienteMediaPct: round1(longest.avgGradePct) }
      : null,
  };
}

/**
 * Esfuerzos cuya salida empezó dentro de la ventana de la referencia: `ref.weeks` semanas de
 * calendario de Madrid hacia atrás desde `now`, ambos extremos incluidos, como `computeReference`.
 * La referencia declarada no tiene ventana y usa la larga (`LONG_WINDOW_WEEKS`).
 */
export function climbsInWindow(climbs: ClimbEffort[], ref: UserReference, now: number): ClimbEffort[] {
  const from = subWeeks(new TZDate(now, TZ), ref.weeks ?? LONG_WINDOW_WEEKS).getTime();
  return climbs.filter((c) => c.activityStart >= from && c.activityStart <= now);
}

/** Referencia declarada: los máximos igualan a las medias. Velocidad 0 da tiempo 0, no `Infinity`. */
export function referenceFromAnswers(a: InitialAnswers): UserReference {
  const avgDistanceM = a.kmPorSalida * 1000;
  const avgSpeedMs = a.velocidadMediaKmh * MS_PER_KMH;
  return {
    source: 'declared',
    weeks: null,
    rides: 0,
    ridesPerWeek: 0,
    avgDistanceM,
    avgElevGainM: a.desnivelPorSalidaM,
    avgMovingTimeS: avgSpeedMs > 0 ? avgDistanceM / avgSpeedMs : 0,
    avgSpeedMs,
    longestDistanceM: avgDistanceM,
    maxElevGainM: a.desnivelPorSalidaM,
  };
}

/** Guarda las respuestas; la referencia se recalcula al leerlas. */
export async function saveDeclaredReference(a: InitialAnswers): Promise<void> {
  await db.meta.put({ key: DECLARED_REFERENCE_KEY, value: a });
}

export async function loadDeclaredReference(): Promise<UserReference | null> {
  const row = await db.meta.get(DECLARED_REFERENCE_KEY);
  return row ? referenceFromAnswers(row.value as InitialAnswers) : null;
}

/** La referencia del historial si existe; si no, la declarada; si no, `null`. */
export async function resolveReference(acts: StoredActivity[], now: number): Promise<UserReference | null> {
  return computeReference(acts, now) ?? (await loadDeclaredReference());
}
