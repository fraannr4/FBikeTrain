import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { accountClient } from '../auth/client';
import { db } from '../db/db';
import { useImporter } from '../ui/importer';
import { withConnectionLock } from './connectionLock';
import type { ReferenceRoute } from '../routes/library';
import { courseFromRoute, createGarminClient, garminEnabled, type GarminClient, type GarminStatus } from './garminClient';
import { GARMIN_SYNC_KEY, loadGarminSyncState, syncGarmin, type GarminSyncResult } from './garminSync';

export type GarminConnections = GarminStatus & {
  ready: boolean; busy: boolean; error?: string; result?: GarminSyncResult; revision: number;
  connect: () => Promise<void>; sync: () => Promise<void>; disconnect: () => Promise<void>;
  stop: () => Promise<void>; refresh: () => Promise<void>;
  /** Publica el recorrido como «course» en Garmin Connect. Lanza un error legible si falla. */
  sendCourse: (route: ReferenceRoute) => Promise<void>;
};
const Context = createContext<GarminConnections | null>(null);
export const useGarminConnections = () => useContext(Context);
const inactive: GarminStatus = { available: false, connected: false, backfillAvailable: false };

/** Garmin llama al servidor con la app cerrada; el navegador recoge las entregas al abrir/reanudar. */
export function GarminProvider({ children, api: supplied }: { children: ReactNode; api?: GarminClient }) {
  const api = useMemo(() => supplied ?? createGarminClient(async () => (await accountClient.auth.getSession()).data.session?.access_token ?? null), [supplied]);
  const importer = useImporter();
  const [status, setStatus] = useState<GarminStatus>(inactive);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<GarminSyncResult>();
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const paused = useRef(false);
  const controller = useRef<AbortController>();
  const settled = useRef<Promise<void>>(Promise.resolve());
  const knownConnected = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout>>();

  const execute = useCallback(async (operation: 'sync' | 'connect' | 'disconnect' | 'refresh', automatic = false) => {
    if (controller.current || (automatic && paused.current)) return;
    // Sin aprobación de Garmin no hay nada que consultar: pendiente, sin llamadas al servidor.
    if (!garminEnabled()) { if (mounted.current) { setStatus(inactive); setReady(true); } return; }
    if (!automatic && operation !== 'refresh') paused.current = false;
    const ctrl = new AbortController(); controller.current = ctrl;
    let finish!: () => void;
    settled.current = new Promise<void>(resolve => { finish = resolve; });
    if (mounted.current) { setBusy(true); setError(undefined); }
    let importing = false;
    let retryLater = false;
    try {
      if (operation === 'connect') {
        const redirect = await withConnectionLock(db, () => api.connect(ctrl.signal));
        if (!redirect) throw new Error('Hay otra sincronización en curso. Espera a que termine.');
        ctrl.signal.throwIfAborted();
        window.location.assign(redirect);
        return;
      }
      if (operation === 'disconnect') {
        const removed = await withConnectionLock(db, async () => {
          await api.disconnect(ctrl.signal);
          ctrl.signal.throwIfAborted();
          await db.meta.delete(GARMIN_SYNC_KEY);
          return true;
        });
        if (!removed) throw new Error('Hay otra sincronización en curso. Espera a que termine.');
        knownConnected.current = false;
        if (mounted.current) { setStatus(previous => ({ ...previous, connected: false, lastSyncAt: undefined })); setResult(undefined); }
        return;
      }
      const remote = await api.status(ctrl.signal);
      ctrl.signal.throwIfAborted();
      knownConnected.current = remote.connected;
      let local = await loadGarminSyncState(db);
      if (mounted.current) { setStatus({ ...remote, lastSyncAt: local.lastSyncAt ?? remote.lastSyncAt }); setResult(local.result); }
      if (operation === 'refresh' || !remote.available || !remote.connected || remote.permissionRequired) return;
      importing = true;
      const imported = await syncGarmin(db, importer, api, ctrl.signal);
      // Otra conexión (Intervals) tenía el candado compartido: reintentar enseguida, no esperar al minuto.
      if (!imported) retryLater = true;
      local = await loadGarminSyncState(db);
      if (mounted.current && imported) { setResult(imported); setStatus({ ...remote, lastSyncAt: local.lastSyncAt ?? remote.lastSyncAt }); }
    } catch (err) {
      // Antes de desplegar/aprobar el servicio, la conexión permanece deshabilitada.
      if (mounted.current && !ctrl.signal.aborted && (!automatic || knownConnected.current)) {
        setError(err instanceof Error ? err.message : 'No se pudo completar la conexión Garmin.');
      }
    } finally {
      if (controller.current === ctrl) controller.current = undefined;
      if (mounted.current) { setBusy(false); setReady(true); if (importing) setRevision(v => v + 1); }
      if (retryLater && mounted.current) retry.current = setTimeout(() => { if (mounted.current) void execute('sync', true); }, 1500);
      finish();
    }
  }, [api, importer]);

  useEffect(() => {
    mounted.current = true;
    // StrictMode desmonta/remonta los efectos antes de esta microtarea: no dejar un intento abortado como único arranque.
    queueMicrotask(() => { if (mounted.current) void execute('sync', true); });
    const resume = () => { if (document.visibilityState === 'visible') void execute('sync', true); };
    const timer = setInterval(() => { if (knownConnected.current) resume(); }, 60_000);
    document.addEventListener('visibilitychange', resume); window.addEventListener('pageshow', resume);
    return () => {
      mounted.current = false; controller.current?.abort(); clearInterval(timer); clearTimeout(retry.current);
      document.removeEventListener('visibilitychange', resume); window.removeEventListener('pageshow', resume);
    };
  }, [execute]);
  const stop = async () => { paused.current = true; controller.current?.abort(); await settled.current; };
  const sendCourse = useCallback(async (route: ReferenceRoute) => {
    await api.sendCourse(courseFromRoute(route), AbortSignal.timeout(60_000));
  }, [api]);
  return <Context.Provider value={{ ...status, ready, busy, error, result, revision,
    connect: () => execute('connect'), sync: () => execute('sync'), disconnect: () => execute('disconnect'),
    stop, refresh: () => execute('refresh'), sendCourse,
  }}>{children}</Context.Provider>;
}
