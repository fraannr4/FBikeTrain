import type { TrackPoint } from '../domain/types';

/**
 * Lectura de pulso y potencia de un track. El track guardado va simplificado (solo puntos con GPS, a
 * 15 m o más unos de otros), así que los puntos no están a 1 Hz: cada valor vale hasta el siguiente punto
 * («escalón») y un hueco largo (parada, túnel) cuenta como mucho `MAX_GAP_S`.
 */

/** Un tramo entre dos puntos cuenta como mucho esto (s): lo que pase de ahí fue una parada o un corte. */
export const MAX_GAP_S = 30;
/** Potencia por encima de esto (W) es una lectura imposible del medidor. */
export const MAX_VALID_POWER_W = 2500;
/** Pulso fuera de [MIN, MAX] (lpm) es un sensor suelto o un pico imposible. */
export const MIN_VALID_HR = 30;
export const MAX_VALID_HR = 250;

export type SensorKey = 'power' | 'hr';

/** El valor si es una lectura creíble; `null` si falta o es imposible. Potencia 0 W es válida (sin pedalear). */
export function validReading(key: SensorKey, v: number | undefined): number | null {
  if (v === undefined || !Number.isFinite(v)) return null;
  if (key === 'power') return v >= 0 && v <= MAX_VALID_POWER_W ? v : null;
  return v >= MIN_VALID_HR && v <= MAX_VALID_HR ? v : null;
}

/** Tramos con lectura válida: `value` del punto de salida y `dtS` hasta el siguiente (con tope). */
export function sensorIntervals(points: TrackPoint[], key: SensorKey): { value: number; dtS: number }[] {
  const out: { value: number; dtS: number }[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const dtS = Math.min((points[i + 1].t - points[i].t) / 1000, MAX_GAP_S);
    const value = validReading(key, points[i][key]);
    if (dtS > 0 && value !== null) out.push({ value, dtS });
  }
  return out;
}

/** Serie a 1 Hz de los tramos válidos (el resto de segundos no existe: sin lectura no se inventa). */
export function sensorSeries(points: TrackPoint[], key: SensorKey): number[] {
  const out: number[] = [];
  let carry = 0;
  for (const { value, dtS } of sensorIntervals(points, key)) {
    carry += dtS;
    const n = Math.floor(carry);
    carry -= n;
    for (let i = 0; i < n; i++) out.push(value);
  }
  return out;
}

/** Mayor media de `windowS` muestras consecutivas de la serie; `null` si la serie es más corta. */
export function bestWindowAverage(series: number[], windowS: number): number | null {
  if (series.length < windowS) return null;
  let sum = 0;
  let best = -Infinity;
  for (let i = 0; i < series.length; i++) {
    sum += series[i];
    if (i >= windowS) sum -= series[i - windowS];
    if (i >= windowS - 1) best = Math.max(best, sum / windowS);
  }
  return best;
}
