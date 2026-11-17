import { TZDate } from '@date-fns/tz';
import { differenceInCalendarWeeks, format, startOfISOWeek, subWeeks } from 'date-fns';
import type { ActivityTotals, LocalDate, RiderThresholds, TrackPoint } from '../domain/types';
import { TZ } from './aggregate';
import { localDay } from './calendar';
import { LONG_WINDOW_WEEKS, SHORT_WINDOW_WEEKS } from './reference';
import { sensorIntervals, sensorSeries } from './sensors';
import { HR_ZONE_COUNT, hrZoneIndex, type HrBasis } from './zones';

/**
 * Carga de entrenamiento. Qué hay guardado de cada salida: los totales (pulso y potencia medios, si el
 * fichero los traía) y, solo con GPS, el track simplificado (un punto cada 15 m o más) que conserva
 * el pulso y la potencia instantáneos de los puntos que quedaron. Una salida sin GPS (rodillo) solo
 * tiene las medias. Por eso cada carga dice de dónde sale (`LoadSource`).
 */

/** Media móvil de la potencia normalizada (s). Coggan y Allen, «Training and Racing with a Power Meter». */
export const NP_WINDOW_S = 30;
/** Segundos de potencia necesarios para calcular la normalizada (una ventana completa). */
export const MIN_NP_SAMPLES = NP_WINDOW_S;
/** Un track cuenta como «con sensor» si el sensor cubre al menos esta parte del tiempo en movimiento. */
export const MIN_SENSOR_COVERAGE = 0.5;

/** TSS de 1 h al ritmo de zona 4 de pulso: la escala que se da a la carga por pulso para igualarla a la de potencia. */
export const HR_ZONE4_HOUR_TSS = 100;
/** Peso de cada zona de pulso en la carga por pulso (TRIMP de Edwards: 1 a 5). */
export const HR_ZONE_WEIGHTS = [1, 2, 3, 4, 5] as const;
const HR_ZONE4_WEIGHT = HR_ZONE_WEIGHTS[3];

/**
 * Sin pulso ni potencia: carga estimada solo con duración y desnivel. Cifras de partida no calibradas
 * (≈ rodar a IF 0,67 más un extra por subir); por eso la salida va rotulada como estimación.
 */
export const EST_TSS_PER_HOUR = 45;
export const EST_TSS_PER_100M_CLIMB = 4;

/** Constantes de tiempo de Coggan: fitness (CTL) a 42 días, fatiga (ATL) a 7 días. */
export const CTL_DAYS = 42;
export const ATL_DAYS = 7;
/** Semanas con carga necesarias en la ventana para dar una carga «habitual». */
export const MIN_WEEKS_WITH_LOAD = 3;

export type LoadSource = 'power' | 'power-avg' | 'hr' | 'hr-avg' | 'estimate';
export type RideLoad = {
  tss: number;
  source: LoadSource;
  /** Solo con potencia. */
  intensityFactor: number | null;
  normalizedPowerW: number | null;
};

const SECONDS_PER_HOUR = 3600;
const isSet = (n: number | null | undefined): n is number => n !== null && n !== undefined && Number.isFinite(n) && n > 0;

function npOf(series: number[]): number | null {
  if (series.length < MIN_NP_SAMPLES) return null;
  const prefix = [0];
  for (const x of series) prefix.push(prefix[prefix.length - 1] + x);
  let sum4 = 0;
  let n = 0;
  for (let i = NP_WINDOW_S; i <= series.length; i++) {
    sum4 += ((prefix[i] - prefix[i - NP_WINDOW_S]) / NP_WINDOW_S) ** 4;
    n += 1;
  }
  return (sum4 / n) ** 0.25;
}

/**
 * Potencia normalizada (Coggan y Allen): media móvil de 30 s, cuarta potencia, media y raíz cuarta.
 * Con un track simplificado es una aproximación: los puntos no están a 1 Hz y se repite cada valor hasta
 * el siguiente. `null` con menos de `MIN_NP_SAMPLES` segundos de potencia.
 */
export function normalizedPower(points: TrackPoint[]): number | null {
  return npOf(sensorSeries(points, 'power'));
}

function powerLoad(totals: ActivityTotals, track: TrackPoint[] | undefined, ftpW: number): RideLoad | null {
  let np: number | null = null;
  let source: LoadSource = 'power';
  if (track) {
    const series = sensorSeries(track, 'power');
    if (series.length >= MIN_SENSOR_COVERAGE * totals.movingTimeS) np = npOf(series);
  }
  if (np === null && isSet(totals.avgPower)) {
    np = totals.avgPower;
    source = 'power-avg';
  }
  if (np === null || totals.movingTimeS <= 0) return null;
  const intensityFactor = np / ftpW;
  // TSS = (s × NP × IF) / (FTP × 3600) × 100 (Coggan).
  const tss = ((totals.movingTimeS * np * intensityFactor) / (ftpW * SECONDS_PER_HOUR)) * 100;
  return { tss, source, intensityFactor, normalizedPowerW: np };
}

/** Segundos × peso de zona → TSS: una hora entera en zona 4 vale `HR_ZONE4_HOUR_TSS`. */
const hrScore = (weightedSeconds: number) =>
  (weightedSeconds / (SECONDS_PER_HOUR * HR_ZONE4_WEIGHT)) * HR_ZONE4_HOUR_TSS;

function hrLoad(totals: ActivityTotals, track: TrackPoint[] | undefined, basis: HrBasis): RideLoad | null {
  if (totals.movingTimeS <= 0) return null;
  if (track) {
    let covered = 0;
    let weighted = 0;
    for (const { value, dtS } of sensorIntervals(track, 'hr')) {
      const z = hrZoneIndex(value, basis);
      if (z === null) return null;
      covered += dtS;
      weighted += dtS * HR_ZONE_WEIGHTS[Math.min(z, HR_ZONE_COUNT - 1)];
    }
    if (covered >= MIN_SENSOR_COVERAGE * totals.movingTimeS) {
      return { tss: hrScore(weighted), source: 'hr', intensityFactor: null, normalizedPowerW: null };
    }
  }
  if (isSet(totals.avgHr)) {
    const z = hrZoneIndex(totals.avgHr, basis);
    if (z !== null) {
      return { tss: hrScore(totals.movingTimeS * HR_ZONE_WEIGHTS[z]), source: 'hr-avg', intensityFactor: null, normalizedPowerW: null };
    }
  }
  return null;
}

/**
 * Carga de una salida, con lo mejor que haya y se pueda: potencia (TSS de Coggan, con FTP), pulso (TRIMP de
 * Edwards escalado a TSS, con pulso máximo o de umbral) o, sin ninguno de los dos, una estimación por
 * duración y desnivel. `source` dice cuál; las medias (`*-avg`) subestiman las salidas irregulares.
 */
export function rideLoad(totals: ActivityTotals, track: TrackPoint[] | undefined, thresholds: RiderThresholds): RideLoad {
  if (isSet(thresholds.ftpW)) {
    const p = powerLoad(totals, track, thresholds.ftpW);
    if (p) return p;
  }
  if (isSet(thresholds.maxHr) || isSet(thresholds.thresholdHr)) {
    const h = hrLoad(totals, track, thresholds);
    if (h) return h;
  }
  const tss =
    (Math.max(0, totals.movingTimeS) / SECONDS_PER_HOUR) * EST_TSS_PER_HOUR +
    (Math.max(0, totals.elevGainM) / 100) * EST_TSS_PER_100M_CLIMB;
  return { tss, source: 'estimate', intensityFactor: null, normalizedPowerW: null };
}

export type LoadEntry = { startTime: number; tss: number };
export type LoadDay = { day: LocalDate; load: number; fitness: number; fatigue: number; form: number };

const dayKey = (y: number, m: number, d: number): LocalDate => format(new TZDate(y, m, d, 12, TZ), 'yyyy-MM-dd');
function nextDay(d: LocalDate): LocalDate {
  const [y, m, day] = d.split('-').map(Number);
  return dayKey(y, m - 1, day + 1);
}

/**
 * Serie diaria (días de Madrid) desde la primera salida hasta `to`: carga del día, fitness (CTL, media
 * exponencial de 42 días), fatiga (ATL, 7 días) y forma (TSB = fitness − fatiga del día anterior, como
 * TrainingPeaks). Parte de 0: con menos de unas 6 semanas de historial la fitness aún sube y no es fiable.
 * Los días sin salida valen 0. Vacía si no hay salidas hasta `to`.
 */
export function loadSeries(entries: LoadEntry[], to: number): LoadDay[] {
  const byDay = new Map<LocalDate, number>();
  for (const e of entries) {
    if (e.startTime > to || !Number.isFinite(e.tss)) continue;
    const d = localDay(e.startTime);
    byDay.set(d, (byDay.get(d) ?? 0) + e.tss);
  }
  if (byDay.size === 0) return [];
  const first = [...byDay.keys()].sort()[0];
  const last = localDay(to);
  const out: LoadDay[] = [];
  let fitness = 0;
  let fatigue = 0;
  for (let day = first; day <= last; day = nextDay(day)) {
    const load = byDay.get(day) ?? 0;
    const form = fitness - fatigue;
    fitness += (load - fitness) / CTL_DAYS;
    fatigue += (load - fatigue) / ATL_DAYS;
    out.push({ day, load, fitness, fatigue, form });
  }
  return out;
}

export type WeekLoad = {
  /** Carga de la semana ISO en curso hasta `now`. */
  current: number;
  /** Carga semanal media de las semanas anteriores de la ventana; `null` si no hay suficiente histórico. */
  usual: number | null;
  /** Semanas completas promediadas (0 sin habitual). */
  weeksUsed: number;
  /** `current` como % de `usual`; `null` sin habitual. */
  pctOfUsual: number | null;
};

/**
 * Carga de la semana en curso frente a la habitual del ciclista: la media semanal de sus 8 semanas
 * completas anteriores (12 si en esas 8 hay menos de `MIN_WEEKS_WITH_LOAD` con carga), contando las
 * vacías y sin pasar de su primera semana de historial.
 */
export function weekLoadVsUsual(entries: LoadEntry[], now: number): WeekLoad {
  const valid = entries.filter((e) => e.startTime <= now && Number.isFinite(e.tss));
  const weekStart = startOfISOWeek(new TZDate(now, TZ));
  const from = weekStart.getTime();
  const current = valid.filter((e) => e.startTime >= from).reduce((s, e) => s + e.tss, 0);
  const none: WeekLoad = { current, usual: null, weeksUsed: 0, pctOfUsual: null };
  if (valid.length === 0) return none;

  const firstWeek = startOfISOWeek(new TZDate(Math.min(...valid.map((e) => e.startTime)), TZ));
  for (const windowWeeks of [SHORT_WINDOW_WEEKS, LONG_WINDOW_WEEKS]) {
    const back = subWeeks(weekStart, windowWeeks);
    const start = back.getTime() > firstWeek.getTime() ? back : firstWeek;
    const weeksUsed = differenceInCalendarWeeks(weekStart, start, { weekStartsOn: 1 });
    if (weeksUsed <= 0) continue;
    const inWindow = valid.filter((e) => e.startTime >= start.getTime() && e.startTime < from);
    const weeksWithLoad = new Set(inWindow.map((e) => startOfISOWeek(new TZDate(e.startTime, TZ)).getTime()));
    if (weeksWithLoad.size < MIN_WEEKS_WITH_LOAD) continue;
    const usual = inWindow.reduce((s, e) => s + e.tss, 0) / weeksUsed;
    return { current, usual, weeksUsed, pctOfUsual: usual > 0 ? (current / usual) * 100 : null };
  }
  return none;
}
