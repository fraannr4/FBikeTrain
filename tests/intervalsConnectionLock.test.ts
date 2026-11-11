import { CyclingDb } from '../src/db/db';
import { loadConnection, saveConnection } from '../src/connections/intervalsCredentials';
import { emptyReport, syncIntervals } from '../src/connections/intervalsSync';

const connection = { athleteId: '0', apiKey: 'synthetic-api-key', autoSync: true };
let database: CyclingDb;
beforeEach(async () => {
  database = new CyclingDb(`connection-lock-${Math.random()}`);
  await saveConnection(database, connection);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await database.delete(); });

it('rejects key changes and disconnects while synchronization holds the connection lock', async () => {
  let release!: () => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => {
    release = () => resolve(new Response('[]'));
  })).mockImplementation(() => Promise.resolve(new Response('[]')));
  const syncing = syncIntervals(database, async () => emptyReport(), false, new AbortController().signal, fetcher);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  try {
    await expect(saveConnection(database, { ...connection, apiKey: 'other-synthetic-key' })).rejects.toThrow('sincronización');
    await expect(saveConnection(database)).rejects.toThrow('sincronización');
    expect(await loadConnection(database)).toEqual(connection);
  } finally { release(); await syncing; }
});

it('does not begin synchronization while saving a connection', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  const encryption = vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => {
    await pending;
    return encrypt(...args);
  });
  const saving = saveConnection(database, { ...connection, apiKey: 'other-synthetic-key' });
  await vi.waitFor(() => expect(encryption).toHaveBeenCalled());
  const fetcher = vi.fn();
  try {
    expect(await syncIntervals(database, async () => emptyReport(), false, new AbortController().signal, fetcher)).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  } finally { release(); await saving; }
});

it('uses the same nonblocking Web Lock for saves and synchronization across tabs', async () => {
  const request = vi.fn(async (_name: string, _options: unknown, callback: (lock: null) => unknown) => callback(null));
  vi.stubGlobal('navigator', { locks: { request } });
  const fetcher = vi.fn();
  expect(await syncIntervals(database, async () => emptyReport(), false, new AbortController().signal, fetcher)).toBeUndefined();
  await expect(saveConnection(database)).rejects.toThrow('otra ventana');
  expect(fetcher).not.toHaveBeenCalled();
  expect(await loadConnection(database)).toEqual(connection);
  expect(request).toHaveBeenCalledTimes(2);
  for (const [name, options] of request.mock.calls) {
    expect(name).toBe(`fbiketrain-intervals-${database.name}`);
    expect(options).toEqual({ ifAvailable: true });
  }
});
