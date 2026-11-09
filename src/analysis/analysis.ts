import type { ClimbEffort, StoredActivity, TrackPoint } from '../domain/types';
import { db, type RouteSigRow } from '../db/db';
import { getTrack, listActivities } from '../db/repo';
import { detectClimbs } from '../metrics/climbs';
import { routeCells } from '../metrics/routes';

export type { RouteSigRow };

/** Súbela cuando cambie cómo se detectan subidas o firmas: `ensureAnalysis` rehará las salidas. */
export const ANALYSIS_VERSION = 1;
/** Salidas por lote en `ensureAnalysis`; entre lote y lote se cede el hilo. */
const BATCH_SIZE = 50;

export type AnalysisResult = { efforts: ClimbEffort[]; sig: RouteSigRow };

/** Subidas y firma del trazado de una salida, a partir de su track guardado. */
export function analyzeActivity(a: StoredActivity, points: TrackPoint[]): AnalysisResult {
  return {
    efforts: detectClimbs(points).map((c, n) => ({ ...c, id: `${a.id}_${n}`, activityId: a.id, activityStart: a.startTime })),
    sig: {
      activityId: a.id,
      activityStart: a.startTime,
      distanceM: a.totals.distanceM,
      cells: routeCells(points),
      analysisVersion: ANALYSIS_VERSION,
    },
  };
}

/** Sustituye, en una transacción, las subidas y la firma de la salida por las nuevas. */
export async function saveAnalysis(r: AnalysisResult): Promise<void> {
  await db.transaction('rw', db.climbEfforts, db.routeSigs, async () => {
    await db.climbEfforts.where('activityId').equals(r.sig.activityId).delete();
    await db.climbEfforts.bulkPut(r.efforts);
    await db.routeSigs.put(r.sig);
  });
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Analiza las salidas con track que no tienen firma o la tienen de una versión anterior, en lotes
 * de 50, y cede el hilo entre lotes. Avisa del progreso al acabar cada lote. Devuelve cuántas analizó.
 * Supuesto: una salida con `hasTrack` pero sin fila de track se analiza con un track vacío, para no
 * reintentarla cada vez.
 */
export async function ensureAnalysis(onProgress?: (done: number, total: number) => void): Promise<number> {
  const versions = new Map((await db.routeSigs.toArray()).map((s) => [s.activityId, s.analysisVersion]));
  const pending = (await listActivities()).filter(
    (a) => a.hasTrack && (versions.get(a.id) ?? -1) < ANALYSIS_VERSION,
  );
  for (let from = 0; from < pending.length; from += BATCH_SIZE) {
    for (const a of pending.slice(from, from + BATCH_SIZE)) {
      await saveAnalysis(analyzeActivity(a, (await getTrack(a.id)) ?? []));
    }
    onProgress?.(Math.min(from + BATCH_SIZE, pending.length), pending.length);
    await yieldToUi();
  }
  return pending.length;
}
