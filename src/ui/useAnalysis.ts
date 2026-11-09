import { useEffect, useSyncExternalStore } from 'react';
import { ensureAnalysis } from '../analysis/analysis';

export type AnalysisState =
  | { status: 'running'; done: number; total: number }
  | { status: 'ready' }
  | { status: 'error' };

// Una sola pasada por carga de la app: la promesa y el estado viven en el módulo.
let state: AnalysisState = { status: 'running', done: 0, total: 0 };
let started: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: AnalysisState) {
  state = next;
  listeners.forEach((l) => l());
}

function start() {
  started ??= ensureAnalysis((done, total) => set({ status: 'running', done, total })).then(
    () => set({ status: 'ready' }),
    () => set({ status: 'error' }),
  );
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const read = () => state;

/** Estado del análisis de las salidas pendientes. La primera pantalla que lo pide lo arranca. */
export function useAnalysis(): AnalysisState {
  useEffect(start, []);
  return useSyncExternalStore(subscribe, read, read);
}
