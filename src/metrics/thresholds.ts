import type { RiderThresholds, TrackPoint } from '../domain/types';
import { bestWindowAverage, sensorSeries } from './sensors';

/** Ventana de la mejor media de potencia para estimar el FTP (s): 20 min. */
export const FTP_WINDOW_S = 1200;
/** FTP ≈ 95 % de la mejor media de 20 min (Allen y Coggan). */
export const FTP_FACTOR_20MIN = 0.95;
/** Segundos seguidos que debe aguantar un pulso para contar como máximo visto (descarta picos sueltos). */
export const HR_SUSTAIN_S = 5;

/** Rangos admitidos (valores enteros). */
export const FTP_MIN_W = 50;
export const FTP_MAX_W = 600;
export const MAX_HR_MIN = 120;
export const MAX_HR_MAX = 230;
export const THRESHOLD_HR_MIN = 100;
export const THRESHOLD_HR_MAX = 220;

/**
 * FTP estimado con la mejor media de 20 min de potencia de entre todos los tracks. `null` si ninguno
 * tiene 20 min de potencia o si el resultado cae fuera de [`FTP_MIN_W`, `FTP_MAX_W`].
 * La media de cada track cuenta solo los tramos con lectura (las paradas largas no suman tiempo).
 */
export function estimateFtp(tracks: TrackPoint[][]): { ftpW: number; best20W: number } | null {
  let best20W: number | null = null;
  for (const track of tracks) {
    const b = bestWindowAverage(sensorSeries(track, 'power'), FTP_WINDOW_S);
    if (b !== null && (best20W === null || b > best20W)) best20W = b;
  }
  if (best20W === null) return null;
  const ftpW = Math.round(best20W * FTP_FACTOR_20MIN);
  return ftpW >= FTP_MIN_W && ftpW <= FTP_MAX_W ? { ftpW, best20W } : null;
}

/** Pulso máximo visto: la mayor media de `HR_SUSTAIN_S` segundos seguidos; `null` sin pulso o por debajo de `MAX_HR_MIN`. */
export function estimateMaxHr(tracks: TrackPoint[][]): { maxHr: number } | null {
  let best: number | null = null;
  for (const track of tracks) {
    const b = bestWindowAverage(sensorSeries(track, 'hr'), HR_SUSTAIN_S);
    if (b !== null && (best === null || b > best)) best = b;
  }
  if (best === null) return null;
  const maxHr = Math.round(best);
  return maxHr >= MAX_HR_MIN && maxHr <= MAX_HR_MAX ? { maxHr } : null;
}

export type ThresholdField = 'ftpW' | 'maxHr' | 'thresholdHr';
export type ThresholdValidation = { ok: true } | { ok: false; errors: Partial<Record<ThresholdField, string>> };

function checkInt(v: number | null, min: number, max: number, unit: string): string | undefined {
  if (v === null) return undefined;
  if (!Number.isInteger(v)) return `Escribe un número entero de ${unit}.`;
  if (v < min || v > max) return `Debe estar entre ${min} y ${max} ${unit}.`;
  return undefined;
}

/** Valida los umbrales; los vacíos (`null`) valen. Cada error dice qué pasa y el rango admitido. */
export function validateThresholds(t: Pick<RiderThresholds, ThresholdField>): ThresholdValidation {
  const errors: Partial<Record<ThresholdField, string>> = {};
  const ftp = checkInt(t.ftpW, FTP_MIN_W, FTP_MAX_W, 'W');
  const max = checkInt(t.maxHr, MAX_HR_MIN, MAX_HR_MAX, 'lpm');
  let th = checkInt(t.thresholdHr, THRESHOLD_HR_MIN, THRESHOLD_HR_MAX, 'lpm');
  if (!th && t.thresholdHr !== null && t.maxHr !== null && !max && t.thresholdHr >= t.maxHr) {
    th = 'El pulso de umbral tiene que ser menor que tu pulso máximo.';
  }
  if (ftp) errors.ftpW = ftp;
  if (max) errors.maxHr = max;
  if (th) errors.thresholdHr = th;
  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors };
}
