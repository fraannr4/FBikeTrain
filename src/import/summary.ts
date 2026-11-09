import type { ActivityTotals, TrackPoint } from '../domain/types';

/** Por debajo de esta velocidad un tramo cuenta como parada (m/s). */
export const MOVING_SPEED_THRESHOLD_MS = 1.0;
/** Una subida o bajada menor que esto se considera ruido del altímetro (m). */
export const ELEVATION_HYSTERESIS_M = 3;
/** Radio medio de la Tierra para haversine (m). */
export const EARTH_RADIUS_M = 6_371_000;
/** Por encima de esta velocidad (90 km/h) un tramo es un pico del GPS si sus vecinos no lo respaldan (m/s). */
export const GPS_SPIKE_SPEED_MS = 25;
/** Tramos de la ventana con la que se comprueba un pico: ~5 s con un punto por segundo. */
export const SPEED_SPIKE_WINDOW = 5;
/** Una salida más corta que esto (m) o con menos tiempo en movimiento (s) es basura y se descarta. */
export const MIN_RIDE_DISTANCE_M = 200;
export const MIN_RIDE_MOVING_TIME_S = 60;

/** Sin distancia (rodillo, sin GPS), una sesión cuenta si dura al menos esto en movimiento (s). */
export const INDOOR_MIN_MOVING_TIME_S = 600;

/**
 * Salida demasiado corta para contar: menos de 60 s en movimiento, o menos de 200 m
 * y menos de 10 min. Así se descartan los arranques por error y se conservan las
 * sesiones de rodillo, que no tienen distancia pero sí tiempo de entreno.
 */
export function isTooShort(t: Pick<ActivityTotals, 'distanceM' | 'movingTimeS'>): boolean {
  if (t.movingTimeS < MIN_RIDE_MOVING_TIME_S) return true;
  return t.distanceM < MIN_RIDE_DISTANCE_M && t.movingTimeS < INDOOR_MIN_MOVING_TIME_S;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Distancia del tramo a→b: la `dist` acumulada si ambos puntos la traen; si no, haversine; si no, 0. */
function segmentDistanceM(a: TrackPoint, b: TrackPoint): number {
  if (a.dist !== undefined && b.dist !== undefined) return Math.max(0, b.dist - a.dist);
  if (a.lat !== undefined && a.lng !== undefined && b.lat !== undefined && b.lng !== undefined) {
    return haversineM(a.lat, a.lng, b.lat, b.lng);
  }
  return 0;
}

function average(values: (number | undefined)[]): number | undefined {
  const present = values.filter((v): v is number => v !== undefined);
  if (present.length === 0) return undefined;
  return present.reduce((sum, v) => sum + v, 0) / present.length;
}

/** Mediana baja de la ventana centrada en `i` (recortada en los extremos). */
function windowMedian(values: number[], i: number): number {
  const half = Math.floor(SPEED_SPIKE_WINDOW / 2);
  const window = values.slice(Math.max(0, i - half), i + half + 1).sort((a, b) => a - b);
  return window[Math.floor((window.length - 1) / 2)];
}

/**
 * Velocidad máxima sin picos del GPS. Un tramo de más de 25 m/s solo cuenta si la mediana de su
 * ventana de 5 tramos también la supera: un salto aislado del GPS (ida, o ida y vuelta) ocupa uno o
 * dos tramos y la mediana lo ignora; un descenso real dura varios tramos y la mediana lo respalda.
 * Por debajo de 25 m/s el tramo cuenta tal cual, así que una salida normal no cambia.
 */
function maxPlausibleSpeed(speeds: number[]): number {
  let max = 0;
  speeds.forEach((v, i) => {
    max = Math.max(max, v <= GPS_SPIKE_SPEED_MS ? v : Math.min(v, windowMedian(speeds, i)));
  });
  return max;
}

function elevationGainM(points: TrackPoint[]): number {
  let gain = 0;
  let ref: number | undefined;
  for (const { ele } of points) {
    if (ele === undefined) continue;
    if (ref === undefined || ref - ele >= ELEVATION_HYSTERESIS_M) {
      ref = ele;
    } else if (ele - ref >= ELEVATION_HYSTERESIS_M) {
      gain += ele - ref;
      ref = ele;
    }
  }
  return gain;
}

/** Totales de una salida a partir de sus puntos, ordenados por tiempo. */
export function computeTotals(points: TrackPoint[]): ActivityTotals {
  let distanceM = 0;
  let movingTimeS = 0;
  const speeds: number[] = [];

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dtS = (b.t - a.t) / 1000;
    const d = segmentDistanceM(a, b);
    distanceM += d;
    if (dtS <= 0) continue;
    const speed = d / dtS;
    if (speed >= MOVING_SPEED_THRESHOLD_MS) movingTimeS += dtS;
    // La velocidad del dispositivo (FIT), si la hay, es más fiable que la calculada; pasa el mismo filtro.
    speeds.push(b.speed ?? speed);
  }

  const totals: ActivityTotals = {
    distanceM,
    movingTimeS,
    elapsedTimeS: points.length > 1 ? (points[points.length - 1].t - points[0].t) / 1000 : 0,
    elevGainM: elevationGainM(points),
    avgSpeedMs: movingTimeS > 0 ? distanceM / movingTimeS : 0,
    maxSpeedMs: maxPlausibleSpeed(speeds),
  };

  const avgCadence = average(points.map((p) => (p.cad ? p.cad : undefined)));
  const avgHr = average(points.map((p) => p.hr));
  const avgPower = average(points.map((p) => p.power));
  if (avgCadence !== undefined) totals.avgCadence = avgCadence;
  if (avgHr !== undefined) totals.avgHr = avgHr;
  if (avgPower !== undefined) totals.avgPower = avgPower;
  return totals;
}
