import type { RiderThresholds, TrackPoint } from '../domain/types';
import { sensorIntervals } from './sensors';

export { MAX_GAP_S } from './sensors';

/**
 * Límites superiores de las 7 zonas de potencia de Coggan, como fracción del FTP:
 * Z1 recuperación (<55 %), Z2 resistencia (56-75 %), Z3 tempo (76-90 %), Z4 umbral (91-105 %),
 * Z5 VO2max (106-120 %), Z6 anaeróbica (121-150 %), Z7 neuromuscular (>150 %).
 */
export const POWER_ZONE_UPPER_PCT_FTP = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5] as const;
/** Zonas de pulso por % del pulso máximo (Edwards): <60, 60-70, 70-80, 80-90, ≥90 %. */
export const HR_ZONE_UPPER_PCT_MAX = [0.6, 0.7, 0.8, 0.9] as const;
/** Zonas de pulso por % del pulso de umbral (Friel, ciclismo): <81, 81-89, 89-94, 94-100, ≥100 %. */
export const HR_ZONE_UPPER_PCT_THRESHOLD = [0.81, 0.89, 0.94, 1.0] as const;

export const POWER_ZONE_COUNT = POWER_ZONE_UPPER_PCT_FTP.length + 1;
export const HR_ZONE_COUNT = HR_ZONE_UPPER_PCT_MAX.length + 1;

export type ZoneTime = { seconds: number[]; totalS: number };
export type HrBasis = Pick<RiderThresholds, 'maxHr' | 'thresholdHr'>;

/** Índice de zona (0 = Z1): el primer límite que el valor no alcanza; un límite pertenece a la zona de arriba. */
function zoneOf(ratio: number, upper: readonly number[]): number {
  const i = upper.findIndex((u) => ratio < u);
  return i === -1 ? upper.length : i;
}

const positive = (n: number | null | undefined): n is number => n !== null && n !== undefined && Number.isFinite(n) && n > 0;

export function powerZoneIndex(watts: number, ftpW: number): number {
  return zoneOf(watts / ftpW, POWER_ZONE_UPPER_PCT_FTP);
}

/** Zona de pulso con el umbral si lo hay y, si no, con el máximo; `null` sin ninguno. */
export function hrZoneIndex(hr: number, basis: HrBasis): number | null {
  if (positive(basis.thresholdHr)) return zoneOf(hr / basis.thresholdHr, HR_ZONE_UPPER_PCT_THRESHOLD);
  if (positive(basis.maxHr)) return zoneOf(hr / basis.maxHr, HR_ZONE_UPPER_PCT_MAX);
  return null;
}

function accumulate(
  points: TrackPoint[],
  key: 'power' | 'hr',
  zones: number,
  zoneFor: (value: number) => number | null,
): ZoneTime | null {
  const seconds = new Array<number>(zones).fill(0);
  let totalS = 0;
  for (const { value, dtS } of sensorIntervals(points, key)) {
    const z = zoneFor(value);
    if (z === null) continue;
    seconds[z] += dtS;
    totalS += dtS;
  }
  return totalS > 0 ? { seconds, totalS } : null;
}

/** Segundos en cada zona de potencia; `null` sin FTP válido o sin potencia en el track. */
export function timeInPowerZones(points: TrackPoint[], ftpW: number | null): ZoneTime | null {
  if (!positive(ftpW)) return null;
  return accumulate(points, 'power', POWER_ZONE_COUNT, (w) => powerZoneIndex(w, ftpW));
}

/** Segundos en cada zona de pulso; `null` sin máximo ni umbral o sin pulso en el track. */
export function timeInHrZones(points: TrackPoint[], basis: HrBasis): ZoneTime | null {
  return accumulate(points, 'hr', HR_ZONE_COUNT, (hr) => hrZoneIndex(hr, basis));
}
