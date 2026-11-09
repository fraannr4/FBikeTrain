import { createContext, useContext } from 'react';
import type { FolderFile, ImportPhase, ImportReport } from '../import/importService';
import type { ImportRequest, ImportWorkerMessage } from '../import/import.worker';

/** La fase es opcional para que los importadores simulados de las pruebas sigan valiendo. */
export type Importer = (
  files: (File | FolderFile)[],
  onProgress: (done: number, total: number, phase?: ImportPhase) => void,
  signal?: AbortSignal,
) => Promise<ImportReport>;

const aborted = () => new DOMException('Importación cancelada', 'AbortError');

/**
 * Importa en un Web Worker para no congelar la pantalla. Un Worker por importación.
 * Cancelar termina el Worker; lo ya guardado se queda y la deduplicación evita duplicarlo al repetir.
 */
export const workerImporter: Importer = (files, onProgress, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const worker = new Worker(new URL('../import/import.worker.ts', import.meta.url), { type: 'module' });
    const onAbort = () => {
      worker.terminate();
      reject(aborted());
    };
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (e: MessageEvent<ImportWorkerMessage>) => {
      if (e.data.type === 'progress') {
        onProgress(e.data.done, e.data.total, e.data.phase);
        return;
      }
      finish();
      if (e.data.type === 'error') reject(new Error(e.data.message));
      else resolve(e.data.report);
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message));
    };
    worker.onmessageerror = () => {
      finish();
      reject(new Error('mensaje del Worker ilegible'));
    };
    worker.postMessage({ files } satisfies ImportRequest);
  });

// Las pruebas sustituyen el Worker con un Provider.
export const ImporterContext = createContext<Importer>(workerImporter);

export function useImporter(): Importer {
  return useContext(ImporterContext);
}
