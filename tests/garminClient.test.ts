import { courseFromRoute, createGarminClient, garminEnabled } from '../src/connections/garminClient';
import type { ReferenceRoute } from '../src/routes/library';

const signal = () => new AbortController().signal;
const route = { id: 'r1', name: 'Vuelta sintética', format: 'gpx', sourceFileName: 'x.gpx', originalXml: '', originalPoints: [],
  points: [{ lat: 41, lng: 2.5, ele: 4 }, { lat: 41.01, lng: 2.5 }],
  summary: { distanceM: 1112, elevGainM: null, elevLossM: null, closed: false, pointCount: 2 }, createdAt: 0, updatedAt: 0 } satisfies ReferenceRoute;

it('builds the course request from a saved route without inventing elevation', () => {
  expect(courseFromRoute(route)).toEqual({ name: 'Vuelta sintética', distanceM: 1112, elevationGainM: 0, elevationLossM: 0,
    points: [{ lat: 41, lng: 2.5, ele: 4 }, { lat: 41.01, lng: 2.5 }] });
});

it('sends a course to its own Edge Function with the FBikeTrain session, never a Garmin token', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ courseId: 42 }));
  const api = createGarminClient(async () => 'synthetic-session', fetcher);
  expect(await api.sendCourse(courseFromRoute(route), signal())).toEqual({ courseId: 42 });
  const [url, init] = fetcher.mock.calls[0];
  expect(String(url)).toMatch(/\/functions\/v1\/garmin\/course$/);
  expect(init?.method).toBe('POST');
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-session');
  expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  expect(JSON.parse(String(init?.body))).toMatchObject({ name: 'Vuelta sintética', points: expect.any(Array) });
});

it('explains a missing course permission', async () => {
  const api = createGarminClient(async () => 'synthetic-session', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'x' }, { status: 403 })));
  await expect(api.sendCourse(courseFromRoute(route), signal())).rejects.toThrow(/permiso/);
});

it('reads course availability from status', async () => {
  const api = createGarminClient(async () => 'synthetic-session', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ available: true, connected: true, backfillAvailable: false, courseAvailable: true })));
  expect(await api.status(signal())).toMatchObject({ courseAvailable: true });
});

it('only follows the official Garmin consent page', async () => {
  const api = createGarminClient(async () => 'synthetic-session', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ authorizationUrl: 'https://evil.example/oauth2Confirm' })));
  await expect(api.connect(signal())).rejects.toThrow(/oficial/);
});

it('is off unless VITE_GARMIN_ENABLED is true', () => {
  vi.stubEnv('VITE_GARMIN_ENABLED', 'false');
  expect(garminEnabled()).toBe(false);
  vi.stubEnv('VITE_GARMIN_ENABLED', 'true');
  expect(garminEnabled()).toBe(true);
  vi.unstubAllEnvs();
});
