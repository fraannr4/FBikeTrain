import type { CyclingDb } from '../db/db';
import type { ImportReport } from '../import/importService';
import type { Importer } from '../ui/importer';
import { localDay } from '../metrics/calendar';
import { createIntervalsClient, IntervalsError, validateCredentials, type IntervalsCredentials, type IntervalsFetch } from './intervalsClient';

export const CONNECTION_KEY = 'intervals:connection';
export const SYNC_KEY = 'intervals:sync';
export const SIX_HOURS = 6 * 60 * 60 * 1000;
const DAY = 86_400_000;
export type IntervalsConnection = IntervalsCredentials & { autoSync: boolean };
export type SyncResult = { report: ImportReport; excluded: number; pending: number; at: number };
export type SyncState = {
  oldest?: string;
  completed?: Record<string, string>;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  retryAt?: number;
  result?: SyncResult;
  error?: string;
};
export const emptyReport = (): ImportReport => ({ added: 0, duplicates: 0, notCycling: 0, tooShort: 0, skipped: [], noGps: [], withCadence: 0 });
export async function loadConnection(database: CyclingDb): Promise<IntervalsConnection | undefined> {
  return (await database.meta.get(CONNECTION_KEY))?.value as IntervalsConnection | undefined;
}
export async function loadSyncState(database: CyclingDb): Promise<SyncState> {
  return (await database.meta.get(SYNC_KEY))?.value as SyncState | undefined ?? {};
}
export async function saveConnection(database: CyclingDb, input?: IntervalsConnection): Promise<void> {
  const connection = input ? { ...validateCredentials(input), autoSync: input.autoSync } : undefined;
  await database.transaction('rw', database.meta, async () => {
    const previous = await loadConnection(database);
    if (!connection) await database.meta.delete(CONNECTION_KEY);
    else await database.meta.put({ key: CONNECTION_KEY, value: connection });
    if (!connection || previous?.athleteId !== connection.athleteId || previous?.apiKey !== connection.apiKey) await database.meta.delete(SYNC_KEY);
  });
}

function mergeReport(total: ImportReport, part: ImportReport) {
  total.added += part.added; total.duplicates += part.duplicates;
  total.notCycling += part.notCycling; total.tooShort += part.tooShort; total.withCadence += part.withCadence;
  total.skipped.push(...part.skipped); total.noGps.push(...part.noGps);
}
const active = new Set<string>();

/** Una reserva persistida evita repetir el intento automático incluso si falla o se recarga. */
export async function syncIntervals(database: CyclingDb, importer: Importer, automatic: boolean, signal: AbortSignal, fetcher: IntervalsFetch = fetch): Promise<SyncResult | undefined> {
  if (active.has(database.name)) return;
  active.add(database.name);
  const run = async (): Promise<SyncResult | undefined> => {
    signal.throwIfAborted();
    const connection = await loadConnection(database);
    if (!connection || (automatic && !connection.autoSync)) return;
    let state = await loadSyncState(database);
    const now = Date.now();
    if (state.retryAt && state.retryAt > now) {
      if (automatic) return;
      throw new IntervalsError('La cuota de Intervals.icu aún no se ha restablecido. Prueba más tarde.', state.retryAt);
    }
    if (automatic && state.lastAttemptAt && now - state.lastAttemptAt < SIX_HOURS) return;
    signal.throwIfAborted();
    const persist = async () => {
      signal.throwIfAborted();
      await database.meta.put({ key: SYNC_KEY, value: state });
    };
    state = { ...state, lastAttemptAt: now, error: undefined };
    await persist();
    const report = emptyReport();
    let excluded = 0;
    let pending = 0;
    try {
      const client = createIntervalsClient(connection, signal, fetcher);
      const latest = await database.activities.orderBy('startTime').reverse().filter(a => !a.id.startsWith('demo-') && a.startTime <= now).first();
      // API con días locales: solape para zonas horarias y cargas retrasadas. Nunca se usa importedAt.
      const initial = localDay(latest ? latest.startTime - 2 * DAY : now - 30 * DAY);
      let oldest = state.oldest ?? initial;
      state.oldest = oldest;
      await persist();
      const today = localDay(now);
      const completed = { ...state.completed };
      let retryOldest: string | undefined;
      // Ventanas pequeñas sin `limit`: no truncar una lista descendente y saltarse las antiguas.
      for (let window = 0; oldest <= today; window++) {
        if (window >= 60) throw new IntervalsError('Queda historial pendiente. Pulsa de nuevo para continuar.');
        const end = new Date(`${oldest}T12:00:00Z`);
        end.setUTCDate(end.getUTCDate() + 29);
        const newest = [end.toISOString().slice(0, 10), today].sort()[0];
        const activities = await client.activities(oldest, newest);
        if (activities.length >= 10_000) throw new IntervalsError('Hay demasiadas actividades en este periodo. Importa el histórico manualmente.');
        let windowFailed = false;
        for (const activity of activities.sort((a, b) => (a.start_date_local ?? '').localeCompare(b.start_date_local ?? ''))) {
          signal.throwIfAborted();
          if (activity.source === 'STRAVA' || activity.source === 'GARMIN_CONNECT' || /garmin/i.test(activity.device_name ?? '') || !activity.start_date_local) { excluded++; continue; }
          if (completed[activity.id]) continue;
          const day = activity.start_date_local.slice(0, 10);
          // No saltar metadatos inválidos avanzando el cursor.
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < oldest || day > newest) throw new IntervalsError('Intervals.icu devolvió una fecha fuera del periodo solicitado.');
          if (activity.source === 'MANUAL' && !activity.file_type) { excluded++; completed[activity.id] = day; continue; }
          if (activity.type && !/ride|cycling|bike/i.test(activity.type)) { report.notCycling++; completed[activity.id] = day; continue; }
          try {
            const file = await client.file(activity);
            signal.throwIfAborted();
            const part = await importer([file], () => {}, signal);
            mergeReport(report, part);
            if (part.skipped.length) { pending++; windowFailed = true; }
            else completed[activity.id] = day;
          } catch (error) {
            signal.throwIfAborted();
            // Cuota, permisos y red detienen el lote sin una cascada de peticiones.
            if (!(error instanceof IntervalsError) || error.stopBatch) {
              throw error instanceof IntervalsError ? error : new IntervalsError('No se pudo guardar una salida. Reintenta; lo ya importado no se duplica.');
            }
            report.skipped.push({ file: `intervals-${activity.id}`, reason: error.message });
            pending++; windowFailed = true;
          }
          state = { ...state, completed, oldest: retryOldest ?? oldest };
          await persist();
        }
        // Un original defectuoso no bloquea las ventanas con salidas más recientes.
        if (windowFailed) retryOldest ??= oldest;
        if (newest === today) {
          const overlap = localDay(now - 7 * DAY);
          state.oldest = retryOldest ?? (oldest > overlap ? oldest : overlap);
          break;
        }
        const next = new Date(`${newest}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
        oldest = next.toISOString().slice(0, 10);
        state = { ...state, oldest: retryOldest ?? oldest, completed };
        await persist();
      }
      // Solo se olvidan ids fuera de la ventana que no se volverá a consultar.
      state.completed = Object.fromEntries(Object.entries(completed).filter(([, day]) => day >= (state.oldest ?? initial)));
      const result = { report, excluded, pending, at: Date.now() };
      state = { ...state, result, retryAt: undefined, error: undefined, ...(pending ? {} : { lastSuccessAt: result.at }) };
      await persist();
      return result;
    } catch (error) {
      signal.throwIfAborted();
      const safe = error instanceof IntervalsError ? error : new IntervalsError('No se pudo completar la sincronización. Reintenta; lo ya importado se conserva.');
      state = { ...state, error: safe.message, retryAt: safe.retryAt, result: { report, excluded, pending: pending + 1, at: Date.now() } };
      await persist();
      throw safe;
    }
  };
  try {
    // Entre pestañas; el Set cubre los navegadores sin Web Locks y el mismo documento.
    return await (typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request(`fbiketrain-intervals-${database.name}`, { ifAvailable: true }, lock => lock ? run() : undefined)
      : run());
  } finally { active.delete(database.name); }
}
