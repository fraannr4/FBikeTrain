import { useSyncExternalStore } from 'react';

/**
 * Estado visible de la sincronización entre dispositivos, compartido entre el proceso de fondo y
 * Ajustes. `revision` sube cada vez que llegan datos de otro dispositivo: las pantallas la usan para
 * volver a leer.
 */
export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error' | 'full';
export type SyncStatus = {
  phase: SyncPhase;
  /** Última pasada completa en esta sesión (epoch ms). */
  lastAt: number | null;
  /** Datos de este dispositivo que aún no están en la cuenta. */
  pending: number;
  /** Tracks que esperan wifi. */
  waitingTracks: number;
  revision: number;
};

let status: SyncStatus = { phase: 'idle', lastAt: null, pending: 0, waitingTracks: 0, revision: 0 };
const listeners = new Set<() => void>();

export function setSyncStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}
export const getSyncStatus = () => status;
export const bumpSyncRevision = () => setSyncStatus({ revision: status.revision + 1 });

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const useSyncStatus = () => useSyncExternalStore(subscribe, getSyncStatus);
export const useSyncRevision = () => useSyncExternalStore(subscribe, () => status.revision);

/** Petición de «sincronizar ahora» desde la interfaz; el proceso de fondo la atiende. */
export const SYNC_REQUEST_EVENT = 'fbt:sync-now';
export const requestSync = () => window.dispatchEvent(new Event(SYNC_REQUEST_EVENT));
