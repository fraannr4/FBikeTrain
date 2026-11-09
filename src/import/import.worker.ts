// Envoltorio del servicio de importación en un Web Worker, para no congelar la pantalla.
// Sin lógica propia: reenvía el progreso y el informe final.
import { importFiles, type FolderFile, type ImportPhase, type ImportReport } from './importService';

export type ImportRequest = { files: (File | FolderFile)[] };
export type ImportWorkerMessage =
  | { type: 'progress'; done: number; total: number; phase: ImportPhase }
  | { type: 'done'; report: ImportReport }
  | { type: 'error'; message: string };

// tsconfig usa la lib DOM; en el Worker, `postMessage` no lleva `targetOrigin`.
const post = (msg: ImportWorkerMessage) => (self.postMessage as (m: ImportWorkerMessage) => void)(msg);

self.addEventListener('message', async (e: MessageEvent<ImportRequest>) => {
  // Un rechazo sin capturar acabaría en 'unhandledrejection' y el hilo principal esperaría para siempre.
  try {
    const report = await importFiles(e.data.files, (done, total, phase) => post({ type: 'progress', done, total, phase }));
    post({ type: 'done', report });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});
