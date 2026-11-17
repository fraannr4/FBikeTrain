import { useEffect } from 'react';
import Dexie from 'dexie';
import { ensureAnalysis } from '../analysis/analysis';
import { useAccount } from '../auth/AccountBoundary';
import { CALENDAR_CHANGED_EVENT } from '../calendar/calendarRepo';
import { syncCalendar } from '../calendar/sync';
import { db } from '../db/db';
import { pendingCount, scan, syncOnce } from './engine';
import { supabaseRemote, SyncQuotaError } from './remote';
import { bumpSyncRevision, setSyncStatus, SYNC_REQUEST_EVENT } from './status';

const SYNCED_TABLES = ['activities', 'tracks', 'calendar', 'goals', 'settings', 'referenceRoutes'];
/** Espera tras el último cambio: una importación entera acaba en una sola pasada. */
const DEBOUNCE_MS = 2500;
const RETRY_MS = 5 * 60_000;

type Connection = { saveData?: boolean; type?: string };
/** Datos móviles o ahorro de datos: los tracks esperan. Si el navegador no lo dice, no se retienen. */
export function onMeteredConnection(): boolean {
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  return connection?.saveData === true || connection?.type === 'cellular';
}

/**
 * Sincroniza los datos de la cuenta entre dispositivos, en segundo plano: al abrir, al volver a la
 * app, al recuperar la red y poco después de cada cambio (importar, guardar, borrar).
 */
export function DeviceSync() {
  const account = useAccount();
  useEffect(() => {
    if (!account || account.user.is_anonymous) return;
    const remote = supabaseRemote(account.client);
    const databaseName = db.name;
    const controller = new AbortController();
    let live = true, running = false, again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function run() {
      if (!live || db.name !== databaseName) return;
      if (running) { again = true; return; }
      running = true;
      try {
        // Una sola pasada a la vez por base, también entre pestañas.
        if (navigator.locks) await navigator.locks.request(`device-sync:${databaseName}`, { ifAvailable: true }, (lock) => (lock ? pass() : undefined));
        else await pass();
      } finally {
        running = false;
        if (again && live) { again = false; schedule(); }
      }
    }
    async function pass() {
      try {
        if (!navigator.onLine) {
          // Sin red se anota igualmente qué cambió y cuándo: es lo que decide quién gana después.
          await scan(Date.now());
          setSyncStatus({ phase: 'offline', pending: await pendingCount() });
          return;
        }
        setSyncStatus({ phase: 'syncing' });
        const report = await syncOnce(remote, { deferTracks: onMeteredConnection(), signal: controller.signal });
        if (!live || db.name !== databaseName) return;
        if (report.pulled > 0) {
          await ensureAnalysis();
          await syncCalendar();
          window.dispatchEvent(new Event(CALENDAR_CHANGED_EVENT));
          bumpSyncRevision();
        }
        setSyncStatus({ phase: 'idle', lastAt: Date.now(), pending: await pendingCount(), waitingTracks: report.waitingTracks });
      } catch (cause) {
        if (!live) return;
        setSyncStatus({ phase: cause instanceof SyncQuotaError ? 'full' : navigator.onLine ? 'error' : 'offline' });
        if (!(cause instanceof SyncQuotaError)) schedule(RETRY_MS);
      }
    }
    function schedule(delay = DEBOUNCE_MS) {
      clearTimeout(timer);
      timer = setTimeout(() => { void run(); }, delay);
    }
    const changed = (parts: unknown) => {
      const keys = Object.keys(parts as object);
      if (SYNCED_TABLES.some((table) => keys.some((key) => key.startsWith(`idb://${databaseName}/${table}/`)))) schedule();
    };
    const resume = () => { if (document.visibilityState !== 'hidden') schedule(); };
    const now = () => schedule(0);
    Dexie.on('storagemutated', changed);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener(SYNC_REQUEST_EVENT, now);
    schedule(1000);
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
      Dexie.on('storagemutated').unsubscribe(changed);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener(SYNC_REQUEST_EVENT, now);
    };
  }, [account]);
  return null;
}
