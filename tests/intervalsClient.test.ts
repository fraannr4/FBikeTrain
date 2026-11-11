import { createIntervalsClient } from '../src/connections/intervalsClient';

const credentials = { athleteId: '0', apiKey: 'synthetic-api-key' };
const signal = () => new AbortController().signal;
const ok = () => new Response('[]');
const list = (fetcher: typeof fetch) => createIntervalsClient(credentials, signal(), fetcher).activities('2026-11-01', '2026-11-11');

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('uses an asynchronous credential provider without knowledge of API keys', async () => {
  const authorization = vi.fn().mockResolvedValue('Bearer synthetic-token');
  const fetcher = vi.fn().mockResolvedValue(ok());
  await createIntervalsClient({ athleteId: '0', authorization }, signal(), fetcher).activities('2026-11-01', '2026-11-11');
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-token');
  expect(authorization).toHaveBeenCalledWith(expect.any(AbortSignal));
});

it.each([401, 403])('never retries HTTP %s', async status => {
  const fetcher = vi.fn().mockResolvedValue(new Response('private provider body', { status }));
  await expect(list(fetcher)).rejects.toThrow(status === 401 ? 'clave' : 'permisos');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('backs off exponentially on 5xx and recovers', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 500 })).mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(ok());
  const request = list(fetcher);
  await vi.advanceTimersByTimeAsync(999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  await expect(request).resolves.toEqual([]);
});

it('respects short Retry-After on 429 before retrying', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } })).mockResolvedValueOnce(ok());
  const request = list(fetcher);
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(request).resolves.toEqual([]);
});

it.each([429, 503])('persists long Retry-After HTTP dates on %s without an in-page wait', async status => {
  const retryAt = Math.ceil((Date.now() + 3_600_000) / 1000) * 1000;
  const fetcher = vi.fn().mockResolvedValue(new Response('', { status, headers: { 'Retry-After': new Date(retryAt).toUTCString() } }));
  await expect(list(fetcher)).rejects.toMatchObject({ retryAt, stopBatch: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('stops a repeated 5xx batch with a cooldown instead of fetching more files', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response('', { status: 502 })));
  const request = list(fetcher);
  const rejection = expect(request).rejects.toMatchObject({ stopBatch: true, retryAt: expect.any(Number) });
  await vi.runAllTimersAsync();
  await rejection;
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('cancels during backoff without another request', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
  const request = createIntervalsClient(credentials, controller.signal, fetcher).activities('2026-11-01', '2026-11-11');
  const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(100);
  controller.abort();
  await rejection;
  await vi.runAllTimersAsync();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
