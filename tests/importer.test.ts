import { workerImporter } from '../src/ui/importer';
import type { ImportReport } from '../src/import/importService';

/** Worker falso: guarda la última instancia para poder contestarle desde la prueba. */
class FakeWorker {
  static last: FakeWorker;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

const report: ImportReport = { added: 1, duplicates: 0, notCycling: 0, tooShort: 0, skipped: [], noGps: [], withCadence: 0 };
const file = () => new File(['x'], 'ride.gpx');

describe('workerImporter', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('workerImporter forwards phase', async () => {
    const calls: unknown[][] = [];
    const result = workerImporter([file()], (...args) => calls.push(args));
    FakeWorker.last.reply({ type: 'progress', done: 0, total: 1, phase: 'open' });
    FakeWorker.last.reply({ type: 'progress', done: 1, total: 1, phase: 'activities' });
    FakeWorker.last.reply({ type: 'done', report });

    await expect(result).resolves.toEqual(report);
    expect(calls).toEqual([
      [0, 1, 'open'],
      [1, 1, 'activities'],
    ]);
  });

  it('abort terminates the worker and rejects with AbortError', async () => {
    const controller = new AbortController();
    const result = workerImporter([file()], () => {}, controller.signal);
    const worker = FakeWorker.last;

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError', message: 'Importación cancelada' });
    await expect(result).rejects.toBeInstanceOf(DOMException);
    expect(worker.terminated).toBe(true);
  });

  it('already aborted signal rejects with AbortError', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(workerImporter([file()], () => {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
