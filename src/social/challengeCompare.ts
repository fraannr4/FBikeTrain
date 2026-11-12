import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import type { StoredActivity } from '../domain/types';
import { TZ } from '../metrics/aggregate';
import { formatClock, formatKm, formatMeters, formatSpeed, formatVam, NO_FIGURE } from '../ui/format';
import type { ChallengeResult } from './challenges';

type Side = 'mine' | 'theirs';
export type CompareRow = { label: string; mine: string; theirs: string; better: Side | null };

/** Cifras de una salida para el reto. Nada del track: ni puntos ni horas de paso. */
export function resultFromActivity(a: StoredActivity): ChallengeResult {
  const { movingTimeS, distanceM, avgSpeedMs, elevGainM } = a.totals;
  const hasElev = Number.isFinite(elevGainM) && elevGainM >= 0;
  return {
    activity_date: format(new TZDate(a.startTime, TZ), 'yyyy-MM-dd'),
    moving_time_s: Math.round(movingTimeS),
    distance_m: Math.round(distanceM),
    avg_speed_ms: Math.round(avgSpeedMs * 100) / 100,
    elev_gain_m: hasElev ? Math.round(elevGainM) : null,
    vam_mh: hasElev && movingTimeS > 0 ? Math.round(elevGainM / (movingTimeS / 3600)) : null,
  };
}

/** Qué lado tiene la mejor cifra; `null` si son iguales o falta alguna. */
function best(mine: number | null, theirs: number | null, lowerWins: boolean): Side | null {
  if (mine === null || theirs === null || mine === theirs) return null;
  return mine < theirs === lowerWins ? 'mine' : 'theirs';
}

const orDash = (n: number | null, fmt: (n: number) => string) => (n === null ? NO_FIGURE : fmt(n));

/** Comparativa de los dos resultados. Gana el menor tiempo en movimiento. */
export function compare(mine: ChallengeResult, theirs: ChallengeResult): { winner: Side | 'tie'; rows: CompareRow[] } {
  const winner = best(mine.moving_time_s, theirs.moving_time_s, true) ?? 'tie';
  const row = (label: string, a: string, b: string, better: Side | null): CompareRow => ({ label, mine: a, theirs: b, better });
  return {
    winner,
    rows: [
      row('Tiempo en movimiento', formatClock(mine.moving_time_s), formatClock(theirs.moving_time_s), best(mine.moving_time_s, theirs.moving_time_s, true)),
      row('Velocidad media', formatSpeed(mine.avg_speed_ms), formatSpeed(theirs.avg_speed_ms), best(mine.avg_speed_ms, theirs.avg_speed_ms, false)),
      row('Distancia', formatKm(mine.distance_m, 1), formatKm(theirs.distance_m, 1), null),
      row('Desnivel', orDash(mine.elev_gain_m, formatMeters), orDash(theirs.elev_gain_m, formatMeters), null),
      row('VAM', orDash(mine.vam_mh, formatVam), orDash(theirs.vam_mh, formatVam), best(mine.vam_mh, theirs.vam_mh, false)),
    ],
  };
}

/** Salida bastante más corta que la ruta del reto (menos del 75 %): se avisa, pero se puede elegir. */
export function shortRideWarning(ride: StoredActivity, routeDistanceM: number): boolean {
  return ride.totals.distanceM < routeDistanceM * 0.75;
}
