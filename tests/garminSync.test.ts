import { readFileSync } from 'node:fs';
import { db, CyclingDb } from '../src/db/db';
import { importFiles } from '../src/import/importService';
import { withConnectionLock } from '../src/connections/connectionLock';
import { syncGarmin, loadGarminSyncState } from '../src/connections/garminSync';
import { createGarminClient, type GarminClient } from '../src/connections/garminClient';
import type { Importer } from '../src/ui/importer';

const bytes = new Uint8Array(readFileSync('tests/fixtures/ride.fit'));
const entry = { id: 'synthetic-garmin', deviceName: 'Garmin Edge Synthetic', createdAt: Date.now() };
const importer: Importer = (files, _progress, _signal, provenance) => importFiles(files, undefined, provenance);
const signal = () => new AbortController().signal;
const json = (data: unknown) => new Response(JSON.stringify(data));
function client(): GarminClient {
  return { status: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), sendCourse: vi.fn(),
    list: vi.fn().mockResolvedValue({ activities: [entry], backfillAvailable: false }),
    file: vi.fn().mockImplementation(async () => new File([bytes], 'synthetic.fit')) };
}
beforeEach(async () => {
  await db.transaction('rw', db.tables, () => Promise.all(db.tables.map(t => t.clear())));
});
if (!Blob.prototype.arrayBuffer) Blob.prototype.arrayBuffer = function () {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(this);
  });
};

it('imports a synthetic official Garmin FIT with provenance and skips its completed id next time', async () => {
  const api = client();
  expect(await syncGarmin(db, importer, api, signal())).toMatchObject({ report: { added: 1, skipped: [] } });
  expect(await db.activities.toArray()).toMatchObject([{ origin: 'garmin-connect', sourceDevice: entry.deviceName, source: 'fit' }]);
  expect(await syncGarmin(db, importer, api, signal())).toMatchObject({ report: { added: 0 } });
  expect(api.file).toHaveBeenCalledTimes(1);
  expect((await loadGarminSyncState(db)).lastSyncAt).toBeGreaterThan(0);
});

it.each(['strava-archive', 'gpx'] as const)('deduplicates Garmin against %s with the same start and duration even if distance differs', async source => {
  await importFiles([new File([bytes], 'previous.fit')]);
  const previous = (await db.activities.toArray())[0];
  await db.activities.clear();
  await db.activities.put({ ...previous, id: 'synthetic-existing', source, totals: { ...previous.totals, distanceM: previous.totals.distanceM * 2 } });
  const result = await syncGarmin(db, importer, client(), signal());
  expect(result?.report).toMatchObject({ added: 0, duplicates: 1 });
  expect(await db.activities.count()).toBe(1);
});

it('shares the account lock with Intervals and isolates its completed ids per database', async () => {
  const api = client();
  let release!: () => void;
  const locked = withConnectionLock(db, () => new Promise<void>(resolve => { release = resolve; }));
  expect(await syncGarmin(db, importer, api, signal())).toBeUndefined();
  expect(api.list).not.toHaveBeenCalled();
  release(); await locked;
  const other = new CyclingDb(`garmin-other-${Math.random()}`);
  try {
    await syncGarmin(db, importer, api, signal());
    expect(await loadGarminSyncState(other)).toEqual({});
  } finally { await other.delete(); }
});

it('keeps failed imports retryable without marking them completed', async () => {
  const api = client();
  api.file = vi.fn().mockRejectedValue(new Error('synthetic failure'));
  await expect(syncGarmin(db, importer, api, signal())).rejects.toThrow();
  expect((await loadGarminSyncState(db)).completed?.[entry.id]).toBeUndefined();
});

it('calls only the authenticated Edge Function, handles missing credentials and rejects unsafe OAuth redirects', async () => {
  const fetcher = vi.fn().mockResolvedValue(json({ available: false, connected: false, backfillAvailable: false }));
  const api = createGarminClient(async () => 'synthetic-account-jwt', fetcher);
  expect(await api.status(signal())).toMatchObject({ available: false, connected: false });
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toContain('/functions/v1/garmin/status');
  expect(options.headers.Authorization).toBe('Bearer synthetic-account-jwt');
  expect(options.credentials).toBe('omit');
  fetcher.mockResolvedValueOnce(json({ authorizationUrl: 'https://malicious.invalid/authorize' }));
  await expect(api.connect(signal())).rejects.toThrow();
});

it('does not fetch when the app session has expired and sanitizes provider errors', async () => {
  const fetcher = vi.fn();
  await expect(createGarminClient(async () => null, fetcher).status(signal())).rejects.toThrow('sesión');
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValue(new Response('private-provider-body', { status: 500 }));
  await expect(createGarminClient(async () => 'synthetic', fetcher).status(signal())).rejects.not.toThrow('private-provider-body');
});
