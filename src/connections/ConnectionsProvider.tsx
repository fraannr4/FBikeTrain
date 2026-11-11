import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { db } from '../db/db';
import { useImporter } from '../ui/importer';
import { useToast } from '../ui/components/Toast';
import { IntervalsError } from './intervalsClient';
import { loadConnection, loadSyncState, saveConnection, syncIntervals, type IntervalsConnection, type SyncState } from './intervalsSync';

type Connections = {
  connection?: IntervalsConnection;
  state: SyncState;
  busy: boolean;
  ready: boolean;
  storageError: boolean;
  revision: number;
  save: (connection?: IntervalsConnection) => Promise<void>;
  sync: () => Promise<void>;
  cancel: () => void;
  stop: () => Promise<void>;
  refresh: () => Promise<void>;
};
const Context = createContext<Connections | null>(null);
export const useConnections = () => useContext(Context);
export const useConnectionRevision = () => useConnections()?.revision ?? 0;

export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const importer = useImporter();
  const toast = useToast();
  const [connection, setConnection] = useState<IntervalsConnection>();
  const [state, setState] = useState<SyncState>({});
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [revision, setRevision] = useState(0);
  const controller = useRef<AbortController>();
  const settled = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    const [config, status] = await Promise.all([loadConnection(db), loadSyncState(db)]);
    if (!mounted.current) return;
    setConnection(config); setState(status); setReady(true); setStorageError(false);
  }, []);
  const run = useCallback(async (automatic: boolean) => {
    if (controller.current) return;
    const ctrl = new AbortController();
    controller.current = ctrl;
    let finish!: () => void;
    settled.current = new Promise<void>(resolve => { finish = resolve; });
    setBusy(true);
    let changed = false;
    try {
      const result = await syncIntervals(db, async (...args) => {
        const report = await importer(...args);
        changed ||= report.added > 0;
        return report;
      }, automatic, ctrl.signal);
      if (!ctrl.signal.aborted && result) {
        if (result.pending) toast('Hay salidas pendientes de importar. Revisa Conexiones.', { tone: 'error' });
        else if (result.report.added) toast(`${result.report.added} ${result.report.added === 1 ? 'salida nueva' : 'salidas nuevas'} de Intervals.icu`, { tone: 'good' });
      }
    } catch (error) {
      if (!ctrl.signal.aborted) toast(error instanceof IntervalsError ? error.message : 'No se pudo completar la conexión. Revisa Ajustes > Conexiones.', { tone: 'error' });
    } finally {
      try {
        if (mounted.current) await refresh().catch(() => setStorageError(true));
      } finally {
        if (controller.current === ctrl) controller.current = undefined;
        if (mounted.current) {
          setBusy(false);
          // Un Worker cancelado puede haber guardado parte del lote.
          if (changed || ctrl.signal.aborted) setRevision(v => v + 1);
        }
        finish();
      }
    }
  }, [importer, refresh, toast]);
  useEffect(() => {
    mounted.current = true;
    void refresh().then(() => { if (mounted.current) void run(true); }).catch(() => setStorageError(true));
    const resume = () => { if (document.visibilityState === 'visible') void run(true); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      mounted.current = false;
      controller.current?.abort();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, [refresh, run]);
  const save = async (config?: IntervalsConnection) => {
    if (controller.current) throw new Error('Espera a que termine la sincronización.');
    // Reservar antes de WebCrypto: reanudar, guardar o borrar todo debe esperar también al guardado.
    const ctrl = new AbortController();
    controller.current = ctrl;
    let finish!: () => void;
    settled.current = new Promise<void>(resolve => { finish = resolve; });
    setBusy(true);
    try {
      await saveConnection(db, config);
      await refresh();
    } finally {
      if (controller.current === ctrl) controller.current = undefined;
      if (mounted.current) setBusy(false);
      finish();
    }
  };
  const stop = async () => { controller.current?.abort(); await settled.current; };
  return <Context.Provider value={{ connection, state, busy, ready, storageError, revision, save, sync: () => run(false), cancel: () => controller.current?.abort(), stop, refresh }}>{children}</Context.Provider>;
}
