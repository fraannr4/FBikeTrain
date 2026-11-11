import { readFileSync } from 'node:fs';
import { gzipSync } from 'fflate';
import { db, CyclingDb } from '../src/db/db';
import { exportBackup } from '../src/backup/backup';
import { importFiles } from '../src/import/importService';
import { createIntervalsClient, validateCredentials } from '../src/connections/intervalsClient';
import { CONNECTION_KEY, SYNC_KEY, SIX_HOURS, emptyReport, loadConnection, loadSyncState, saveConnection, syncIntervals } from '../src/connections/intervalsSync';

const credentials = { athleteId: 'i42', apiKey: 'synthetic-api-key' };
const connection = { ...credentials, autoSync: true };
const ride = readFileSync('tests/fixtures/ride.gpx', 'utf8');
const row = (id = 'i1', date = '2026-01-04') => ({ id, source: 'UPLOAD', file_type: 'gpx', type: 'Ride', start_date_local: `${date}T09:00:00`, start_date: `${date}T08:00:00Z` });
const signal = () => new AbortController().signal;
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const listResponse = (rows: ReturnType<typeof row>[], url: string) => {
  const query = new URL(url).searchParams;
  return json(rows.filter(a => a.start_date_local.slice(0, 10) >= query.get('oldest')! && a.start_date_local.slice(0, 10) <= query.get('newest')!));
};
const importer = async (files: Parameters<typeof importFiles>[0]) => importFiles(files);

if (!Blob.prototype.arrayBuffer) Blob.prototype.arrayBuffer = function () {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(this);
  });
};

let now: number;
beforeEach(async () => {
  now = Date.parse('2026-01-10T12:00:00Z');
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  await db.transaction('rw', db.tables, () => Promise.all(db.tables.map(t => t.clear())));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('accepts modern ids including i and rejects path/header injection', () => {
  expect(validateCredentials(credentials)).toEqual(credentials);
  expect(validateCredentials({ ...credentials, athleteId: '0' }).athleteId).toBe('0');
  expect(validateCredentials({ ...credentials, athleteId: '123' }).athleteId).toBe('123');
  expect(() => validateCredentials({ ...credentials, athleteId: '../42' })).toThrow();
  expect(() => validateCredentials({ ...credentials, apiKey: 'key\nheader' })).toThrow();
});

it('uses only the official HTTPS API and Basic header, with no cookies or redirects', async () => {
  const fetcher = vi.fn().mockResolvedValue(json([row()]));
  expect(await createIntervalsClient(credentials, signal(), fetcher).activities('2026-01-01', '2026-01-10')).toHaveLength(1);
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toContain('https://intervals.icu/api/v1/athlete/i42/activities?oldest=2026-01-01&newest=2026-01-10');
  expect(url).not.toContain(credentials.apiKey);
  expect(url).not.toContain('limit=');
  expect(options).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { Authorization: `Basic ${btoa(`API_KEY:${credentials.apiKey}`)}` } });
});

it.each([401, 403, 500])('sanitizes HTTP %s without exposing a provider body or credential', async status => {
  const client = createIntervalsClient(credentials, signal(), vi.fn().mockResolvedValue(new Response(credentials.apiKey, { status })));
  await expect(client.activities('2026-01-01', '2026-01-10')).rejects.not.toThrow(credentials.apiKey);
});

it('rejects invalid JSON, unsafe activity ids, network errors and HTML challenges', async () => {
  for (const body of ['<html>challenge</html>', JSON.stringify([{ ...row(), id: '../file' }])]) {
    await expect(createIntervalsClient(credentials, signal(), vi.fn().mockResolvedValue(new Response(body))).activities('2026-01-01', '2026-01-10')).rejects.toThrow('formato esperado');
  }
  await expect(createIntervalsClient(credentials, signal(), vi.fn().mockRejectedValue(new Error(credentials.apiKey))).activities('2026-01-01', '2026-01-10')).rejects.toThrow('CORS');
});

it('recognizes gzipped original files without relying on Content-Disposition exposure', async () => {
  const bytes = gzipSync(new TextEncoder().encode(ride));
  const client = createIntervalsClient(credentials, signal(), vi.fn().mockResolvedValue(new Response(bytes)));
  const file = await client.file({ ...row(), file_type: 'GPX' });
  expect(file.name).toBe('intervals-i1.gpx.gz');
  expect(file.size).toBe(bytes.length);
});

it('rejects large files before consuming them', async () => {
  const client = createIntervalsClient(credentials, signal(), vi.fn().mockResolvedValue(new Response('x', { headers: { 'content-length': '22000000' } })));
  await expect(client.file(row())).rejects.toThrow('tamaño permitido');
});

it('cancels streaming fetches without turning cancellation into a stored credential error', async () => {
  const ctrl = new AbortController();
  const fetcher = vi.fn((_url, options) => new Promise<Response>((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  const pending = createIntervalsClient(credentials, ctrl.signal, fetcher).activities('2026-01-01', '2026-01-10');
  ctrl.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});

it('downloads originals through the real importer and preserves the manual duplicate report', async () => {
  await importFiles([new File([ride], 'manual.gpx')]);
  await saveConnection(db, connection);
  const fresh = ride.replaceAll('2026-01-04', '2026-01-05');
  const fetcher = vi.fn(async (url: string) => url.includes('/activities?') ? json([row('i2', '2026-01-05'), row()]) : new Response(url.includes('/i2/') ? fresh : ride));
  const result = await syncIntervals(db, importer, false, signal(), fetcher);
  expect(result?.report).toMatchObject({ added: 1, duplicates: 1, skipped: [] });
  expect(await db.activities.count()).toBe(2);
  expect(await db.tracks.count()).toBe(2);
  expect(fetcher.mock.calls[0][0]).toContain('oldest=2026-01-02');
  expect((await loadSyncState(db)).lastSuccessAt).toBe(now);
});

it('retains failed earlier files while continuing later imports and retries only pending originals', async () => {
  await saveConnection(db, connection);
  let invalid = true;
  const fetcher = vi.fn(async (url: string) => url.includes('/activities?') ? listResponse([row('i2', '2026-01-05'), row()], url) : new Response(url.includes('/i1/') && invalid ? '<gpx/>' : url.includes('/i2/') ? ride.replaceAll('2026-01-04', '2026-01-05') : ride));
  const first = await syncIntervals(db, importer, false, signal(), fetcher);
  expect(first).toMatchObject({ pending: 1, report: { added: 1, skipped: [{ file: 'intervals-i1.gpx' }] } });
  const oldest = (await loadSyncState(db)).oldest;
  invalid = false; fetcher.mockClear();
  const second = await syncIntervals(db, importer, false, signal(), fetcher);
  expect(second).toMatchObject({ pending: 0, report: { added: 1, skipped: [] } });
  expect(fetcher.mock.calls[0][0]).toContain(`oldest=${oldest}`);
  expect(fetcher.mock.calls.filter(([url]) => url.includes('/file'))).toHaveLength(1);
  expect(await db.activities.count()).toBe(2);
});

it('continues into newer date windows even when an older original stays unavailable', async () => {
  await saveConnection(db, connection);
  await db.meta.put({ key: SYNC_KEY, value: { oldest: '2025-12-01' } });
  const fetcher = vi.fn(async (url: string) => {
    if (!url.includes('/activities?')) return new Response(ride.replaceAll('2026-01-04', '2026-01-10'));
    const query = new URL(url).searchParams;
    return json([{ ...row('i1', '2025-12-02'), file_type: null }, row('i2', '2026-01-10'), { ...row('i3', '2025-12-03'), source: 'MANUAL', file_type: null }].filter(a => a.start_date_local.slice(0, 10) >= query.get('oldest')! && a.start_date_local.slice(0, 10) <= query.get('newest')!));
  });
  const result = await syncIntervals(db, importer, false, signal(), fetcher);
  expect(result).toMatchObject({ pending: 1, excluded: 1, report: { added: 1 } });
  expect((await loadSyncState(db)).oldest).toBe('2025-12-01');
  expect(await db.activities.count()).toBe(1);
});

it('does not lose the starting cursor on network failure followed by a newer manual import', async () => {
  await saveConnection(db, connection);
  const offline = vi.fn().mockRejectedValue(new TypeError('offline'));
  await expect(syncIntervals(db, importer, false, signal(), offline)).rejects.toThrow('CORS');
  const oldest = (await loadSyncState(db)).oldest;
  await importFiles([new File([ride], 'manual.gpx')]);
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(json([])));
  await syncIntervals(db, importer, false, signal(), fetcher);
  expect(fetcher.mock.calls[0][0]).toContain(`oldest=${oldest}`);
});

it('enforces six hours across reloads, including failed attempts, and honors manual requests', async () => {
  await saveConnection(db, connection);
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(json([])));
  await syncIntervals(db, importer, true, signal(), fetcher);
  const count = fetcher.mock.calls.length;
  now += SIX_HOURS - 1;
  expect(await syncIntervals(db, importer, true, signal(), fetcher)).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(count);
  now++;
  await syncIntervals(db, importer, true, signal(), fetcher);
  expect(fetcher).toHaveBeenCalledTimes(count + 1);
  await syncIntervals(db, importer, false, signal(), fetcher);
  expect(fetcher).toHaveBeenCalledTimes(count + 2);
  now += SIX_HOURS;
  fetcher.mockRejectedValueOnce(new TypeError('offline'));
  await expect(syncIntervals(db, importer, true, signal(), fetcher)).rejects.toThrow();
  const failedCount = fetcher.mock.calls.length;
  await syncIntervals(db, importer, true, signal(), fetcher);
  expect(fetcher).toHaveBeenCalledTimes(failedCount);
});

it('stores Retry-After and blocks repeated requests without retry storms', async () => {
  await saveConnection(db, connection);
  const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '7200' } }));
  await expect(syncIntervals(db, importer, false, signal(), fetcher)).rejects.toThrow('limitado');
  expect((await loadSyncState(db)).retryAt).toBe(now + 7_200_000);
  await expect(syncIntervals(db, importer, false, signal(), fetcher)).rejects.toThrow('cuota');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('does not fetch Strava stubs, Garmin sources or Garmin files received through another source', async () => {
  await saveConnection(db, connection);
  await db.meta.put({ key: SYNC_KEY, value: { oldest: '2026-01-01' } });
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(json([{ id: '123' }, { ...row(), source: 'GARMIN_CONNECT' }, { ...row('i2'), device_name: 'Garmin Edge' }])));
  const result = await syncIntervals(db, importer, false, signal(), fetcher);
  expect(result).toMatchObject({ excluded: 3, report: { added: 0 } });
  // Primera consulta puede abarcar dos ventanas; nunca descarga un original.
  expect(fetcher.mock.calls.every(([url]) => url.includes('/activities?'))).toBe(true);
});

it('keeps unsupported originals pending without preventing the rest of the batch', async () => {
  await saveConnection(db, connection);
  const fetcher = vi.fn(async (url: string) => url.includes('/activities?') ? listResponse([{ ...row(), file_type: '' }, row('i2', '2026-01-05')], url) : new Response(ride));
  const result = await syncIntervals(db, importer, false, signal(), fetcher);
  expect(result).toMatchObject({ pending: 1, report: { added: 1, skipped: [{ file: 'intervals-i1' }] } });
});

it('isolates connections by FBikeTrain database and never exports the key in backups', async () => {
  const other = new CyclingDb('intervals-other-test');
  try {
    await saveConnection(db, connection);
    expect(await loadConnection(other)).toBeUndefined();
    const backup = await exportBackup({ includeKeys: true });
    expect(await backup.text()).not.toContain(credentials.apiKey);
    await saveConnection(other, { ...connection, apiKey: 'other-synthetic-key' });
    expect((await loadConnection(db))?.apiKey).toBe(credentials.apiKey);
    await saveConnection(db);
    expect(await loadConnection(db)).toBeUndefined();
    expect((await loadConnection(other))?.apiKey).toBe('other-synthetic-key');
  } finally { await other.delete(); }
});

it('resets progress on key or athlete changes, preserves rides on disconnect and honors auto off', async () => {
  await saveConnection(db, connection);
  await db.meta.put({ key: SYNC_KEY, value: { oldest: '2025-01-01' } });
  await saveConnection(db, { ...connection, apiKey: 'rotated-synthetic-key' });
  expect(await loadSyncState(db)).toEqual({});
  await saveConnection(db, { ...connection, autoSync: false });
  const fetcher = vi.fn();
  await syncIntervals(db, importer, true, signal(), fetcher);
  expect(fetcher).not.toHaveBeenCalled();
  await importFiles([new File([ride], 'manual.gpx')]);
  await saveConnection(db);
  expect(await db.activities.count()).toBe(1);
  expect(await db.meta.get(CONNECTION_KEY)).toBeUndefined();
});

it('does not run concurrent synchronizations and uses a nonblocking cross-tab lock', async () => {
  await saveConnection(db, connection);
  let release!: () => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { release = () => resolve(json([])); })).mockImplementation(() => Promise.resolve(json([])));
  const first = syncIntervals(db, async () => emptyReport(), false, signal(), fetcher);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(await syncIntervals(db, importer, false, signal(), fetcher)).toBeUndefined();
  release(); await first;
});

it('imports the verified iGPSPORT OAUTH_CLIENT payload as an uncompressed original FIT', async () => {
  await saveConnection(db, { ...connection, athleteId: '0' });
  const payload = { ...row(), source: 'OAUTH_CLIENT', device_name: 'IGPSPORT 202', file_type: 'fit', type: 'Ride' };
  const bytes = readFileSync('tests/fixtures/ride.fit');
  const fetcher = vi.fn(async (url: string) => url.includes('/activities?')
    ? json([payload]) : new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*' } }));
  const result = await syncIntervals(db, importer, false, signal(), fetcher);
  expect(result).toMatchObject({ excluded: 0, pending: 0, report: { added: 1, skipped: [] } });
  expect(fetcher.mock.calls[0][0]).toContain('/athlete/0/activities?');
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/activity/i1/file'))).toBe(true);
  expect(await db.activities.count()).toBe(1);
  fetcher.mockClear();
  await syncIntervals(db, importer, false, signal(), fetcher);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/file'))).toHaveLength(0);
});

it('uses only own completed ids, including ids that match Object prototype properties', async () => {
  await saveConnection(db, connection);
  const fetcher = vi.fn(async (url: string) => url.includes('/activities?') ? json([row('constructor')]) : new Response(ride));
  expect(await syncIntervals(db, importer, false, signal(), fetcher)).toMatchObject({ report: { added: 1 } });
  expect((await loadSyncState(db)).completed?.constructor).toBe('2026-01-04');
});

it('starts at 30 days without real history and catches late uploads within the seven-day overlap', async () => {
  await saveConnection(db, connection);
  const fetcher = vi.fn(async (url: string) => url.includes('/activities?') ? json([]) : new Response(ride));
  await syncIntervals(db, importer, false, signal(), fetcher);
  expect(fetcher.mock.calls[0][0]).toContain('oldest=2025-12-11');
  expect((await loadSyncState(db)).oldest).toBe('2026-01-03');
  now += 2 * 86_400_000;
  fetcher.mockImplementation(async (url: string) => url.includes('/activities?') ? json([row()]) : new Response(ride));
  const result = await syncIntervals(db, importer, false, signal(), fetcher);
  expect(result).toMatchObject({ report: { added: 1 } });
  expect((await loadSyncState(db)).oldest).toBe('2026-01-05');
});
