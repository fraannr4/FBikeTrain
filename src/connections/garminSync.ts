import type { CyclingDb } from '../db/db';
import type { ImportReport } from '../import/importService';
import type { Importer } from '../ui/importer';
import type { GarminClient } from './garminClient';
import { withConnectionLock } from './connectionLock';
import { emptyReport } from './intervalsSync';

export const GARMIN_SYNC_KEY = 'garmin:sync';
export type GarminSyncResult = { report: ImportReport; at: number };
export type GarminSyncState = { completed?: Record<string, number>; lastSyncAt?: number; result?: GarminSyncResult };
export async function loadGarminSyncState(database: CyclingDb): Promise<GarminSyncState> {
  return (await database.meta.get(GARMIN_SYNC_KEY))?.value as GarminSyncState | undefined ?? {};
}
/** Comparte lock con Intervals: nunca dos Workers ni cambios de conexión concurrentes por cuenta. */
export async function syncGarmin(database: CyclingDb, importer: Importer, api: GarminClient, signal: AbortSignal): Promise<GarminSyncResult | undefined> {
  return withConnectionLock(database, async () => {
    signal.throwIfAborted();
    const state = await loadGarminSyncState(database);
    const completed: Record<string, number> = Object.assign(Object.create(null), state.completed);
    const report: ImportReport = emptyReport();
    const { activities } = await api.list(signal);
    for (const activity of activities) {
      signal.throwIfAborted();
      if (Object.prototype.hasOwnProperty.call(completed, activity.id)) continue;
      const file = await api.file(activity.id, signal);
      signal.throwIfAborted();
      const part = await importer([file], () => {}, signal, { origin: 'garmin-connect', ...(activity.deviceName ? { sourceDevice: activity.deviceName } : {}) });
      signal.throwIfAborted();
      for (const key of ['added', 'duplicates', 'notCycling', 'tooShort', 'withCadence'] as const) report[key] += part[key];
      report.skipped.push(...part.skipped); report.noGps.push(...part.noGps);
      if (!part.skipped.length) completed[activity.id] = activity.createdAt;
      await database.meta.put({ key: GARMIN_SYNC_KEY, value: { ...state, completed } });
    }
    const at = Date.now();
    const result = { report, at };
    const cutoff = at - 30 * 86_400_000;
    await database.meta.put({ key: GARMIN_SYNC_KEY, value: {
      completed: Object.fromEntries(Object.entries(completed).filter(([, time]) => time >= cutoff)),
      lastSyncAt: report.skipped.length ? state.lastSyncAt : at, result,
    } satisfies GarminSyncState });
    return result;
  });
}
