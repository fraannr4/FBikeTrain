import { getTrack, listActivities } from '../db/repo';
import type { StoredActivity, TrackPoint } from '../domain/types';
import { estimateFtp, estimateMaxHr } from '../metrics/thresholds';

/** Días hacia atrás desde hoy cuyas salidas se leen para estimar: lo reciente describe el nivel actual. */
export const ESTIMATE_WINDOW_DAYS = 180;
const DAY_MS = 86_400_000;

export type ThresholdEstimate = {
  ftp: { ftpW: number; best20W: number } | null;
  maxHr: { maxHr: number } | null;
  /** Salidas de la ventana que traen potencia / pulso en sus totales. */
  ridesWithPower: number;
  ridesWithHr: number;
};

/**
 * Estima FTP y pulso máximo con los tracks de las últimas `ESTIMATE_WINDOW_DAYS`. Solo se leen los tracks
 * de salidas cuyos totales traen potencia o pulso. Devuelve `null` en cada cifra si no hay datos para
 * calcularla: nunca se rellena con un valor inventado.
 */
export async function estimateFromHistory(now: number): Promise<ThresholdEstimate> {
  const acts = await listActivities({ from: now - ESTIMATE_WINDOW_DAYS * DAY_MS, to: now });
  const power = acts.filter((a) => (a.totals.avgPower ?? 0) > 0);
  const hr = acts.filter((a) => (a.totals.avgHr ?? 0) > 0);
  const tracks = new Map<string, TrackPoint[]>();
  const wanted = new Set<StoredActivity>([...power, ...hr].filter((a) => a.hasTrack));
  for (const a of wanted) {
    const points = await getTrack(a.id);
    if (points) tracks.set(a.id, points);
  }
  const tracksOf = (list: StoredActivity[]) => list.flatMap((a) => (tracks.has(a.id) ? [tracks.get(a.id)!] : []));
  return {
    ftp: estimateFtp(tracksOf(power)),
    maxHr: estimateMaxHr(tracksOf(hr)),
    ridesWithPower: power.length,
    ridesWithHr: hr.length,
  };
}
