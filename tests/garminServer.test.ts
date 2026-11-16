import { createGarminService, guardedFetch, signedInAccount, type GarminStore, type GarminTokens } from '../src/connections/garminServer/service';
import { decryptSecret, digest, encryptSecret } from '../src/connections/garminServer/crypto';

const secret = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const user = 'synthetic-account';
function setup() {
  let pending: { userId: string; verifier: string; expiresAt: number } | undefined;
  let connection: GarminTokens | undefined;
  const store: GarminStore = {
    putState: vi.fn(async (_hash, value) => { pending = value; }),
    consumeState: vi.fn(async () => { const value = pending; pending = undefined; return value; }),
    loadConnection: vi.fn(async () => connection),
    saveConnection: vi.fn(async (_userId, value) => { connection = value; }),
    removeConnection: vi.fn(async () => { connection = undefined; }),
    withAccountLock: async (_userId, fn) => fn(),
    activities: vi.fn(async () => []), file: vi.fn(async () => null),
    userForGarmin: vi.fn(async () => user),
    claimEvent: vi.fn(async () => true), finishEvent: vi.fn(async () => {}),
    saveFile: vi.fn(async () => {}), updatePermissions: vi.fn(async () => {}),
  };
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes('/oauth/token')) return Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 86400, refresh_token_expires_in: 864000, token_type: 'bearer' });
    if (String(url).endsWith('/user/id')) return Response.json({ userId: 'synthetic-garmin-user' });
    if (String(url).endsWith('/user/permissions')) return Response.json(['ACTIVITY_EXPORT']);
    return new Response(null, { status: 204 });
  });
  const options = { clientId: 'synthetic-client', clientSecret: 'synthetic-client-secret', encryptionKey: secret,
    callbackUrl: 'https://project.example/functions/v1/garmin/callback', appUrl: 'https://app.example/FBikeTrain/',
    allowedOrigins: ['https://app.example'], authenticate: async (token: string) => token === 'synthetic-jwt' ? user : null,
    store, fetcher, now: () => 1_000_000,
  };
  const request = (path: string, method = 'GET', auth = true) => new Request(`https://project.example/functions/v1/garmin${path}`, { method, headers: auth ? { Authorization: 'Bearer synthetic-jwt', Origin: 'https://app.example' } : {} });
  return { store, options, request, fetcher, getConnection: () => connection, setConnection: (value: GarminTokens) => { connection = value; } };
}

it('encrypts tokens with account binding and never returns plaintext at rest', async () => {
  const cipher = await encryptSecret('synthetic-token', secret, user);
  expect(cipher).not.toContain('synthetic-token');
  expect(await decryptSecret(cipher, secret, user)).toBe('synthetic-token');
  await expect(decryptSecret(cipher, secret, 'other-account')).rejects.toThrow();
});

it('starts PKCE with encrypted verifier, binds state to account and consumes callback exactly once', async () => {
  const { options, request, store } = setup();
  const handle = createGarminService(options);
  const start = await handle(request('/connect', 'POST'));
  const { authorizationUrl } = await start.json();
  const url = new URL(authorizationUrl);
  expect(url.origin + url.pathname).toBe('https://connect.garmin.com/oauth2Confirm');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('code_challenge')).toHaveLength(43);
  expect(store.putState).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ userId: user }));
  const pending = vi.mocked(store.putState).mock.calls[0];
  expect(pending[0]).toBe(await digest(url.searchParams.get('state')!));
  const verifier = await decryptSecret(pending[1].verifier, secret, user);
  expect(pending[1].verifier).not.toContain(verifier);
  expect(await digest(verifier)).toBe(url.searchParams.get('code_challenge'));
  const state = url.searchParams.get('state');
  expect((await handle(request(`/callback?code=synthetic-code&state=${state}`, 'GET', false))).status).toBe(303);
  expect(store.saveConnection).toHaveBeenCalledWith(user, expect.objectContaining({ garminUserId: 'synthetic-garmin-user' }));
  expect((await handle(request(`/callback?code=synthetic-code&state=${state}`, 'GET', false))).status).toBe(400);
});

it('requires a valid session for account routes', async () => {
  const { options, request } = setup();
  const handle = createGarminService(options);
  expect((await handle(request('/connect', 'POST', false))).status).toBe(401);
  expect((await handle(request('/activities', 'GET', false))).status).toBe(401);
});

it('rejects expired state and denied activity permission without saving a connection', async () => {
  const { options, request, store, fetcher } = setup();
  const handle = createGarminService(options);
  await handle(request('/connect', 'POST'));
  vi.mocked(store.consumeState).mockResolvedValueOnce({ userId: user, verifier: 'cipher', expiresAt: 0 });
  expect((await handle(request('/callback?code=x&state=synthetic-state', 'GET', false))).status).toBe(400);
  const start = await (await handle(request('/connect', 'POST'))).json();
  fetcher.mockImplementation(async url => String(url).endsWith('/user/permissions') ? Response.json([]) : String(url).endsWith('/user/id') ? Response.json({ userId: 'synthetic-garmin-user' }) : Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 86400, refresh_token_expires_in: 864000, token_type: 'bearer' }));
  expect((await handle(request(`/callback?code=x&state=${new URL(start.authorizationUrl).searchParams.get('state')}`, 'GET', false))).status).toBe(403);
  expect(store.saveConnection).not.toHaveBeenCalled();
});

it('refreshes expired tokens under the account lock, rotates refresh token, then revokes remotely before clearing data', async () => {
  const { options, request, store, fetcher, setConnection } = setup();
  setConnection({ garminUserId: 'synthetic-garmin-user', ciphertext: await encryptSecret(JSON.stringify({ accessToken: 'old-access', refreshToken: 'old-refresh' }), secret, user), expiresAt: 0, refreshExpiresAt: 9_000_000, permissions: ['ACTIVITY_EXPORT'] });
  fetcher.mockImplementation(async url => String(url).includes('/oauth/token') ? Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 86400, refresh_token_expires_in: 864000 }) : new Response(null, { status: 204 }));
  const response = await createGarminService(options)(request('/disconnect', 'POST'));
  expect(response.status).toBe(200);
  expect(String(fetcher.mock.calls[0][0])).toBe('https://diauth.garmin.com/di-oauth2-service/oauth/token');
  const saved = vi.mocked(store.saveConnection).mock.calls[0][1];
  expect(JSON.parse(await decryptSecret(saved.ciphertext, secret, user))).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  expect(store.removeConnection).toHaveBeenCalledWith(user);
  expect(fetcher.mock.invocationCallOrder.at(-1)!).toBeLessThan(vi.mocked(store.removeConnection).mock.invocationCallOrder[0]);
});

it('preserves the connection when Garmin registration revocation fails', async () => {
  const { options, request, store, fetcher, setConnection } = setup();
  setConnection({ garminUserId: 'synthetic-garmin-user', ciphertext: await encryptSecret(JSON.stringify({ accessToken: 'current-access', refreshToken: 'current-refresh' }), secret, user), expiresAt: 9_000_000, refreshExpiresAt: 9_000_000, permissions: ['ACTIVITY_EXPORT'] });
  fetcher.mockResolvedValue(new Response('remote-sensitive-error', { status: 500 }));
  const response = await createGarminService(options)(request('/disconnect', 'POST'));
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('remote-sensitive-error');
  expect(store.removeConnection).not.toHaveBeenCalled();
});

it('denies file access after activity permission is revoked', async () => {
  const { options, request, setConnection, store } = setup();
  setConnection({ garminUserId: 'synthetic-garmin-user', ciphertext: 'encrypted', expiresAt: 9_000_000, refreshExpiresAt: 9_000_000, permissions: [] });
  const response = await createGarminService(options)(request('/activities/synthetic-activity/file'));
  expect(response.status).toBe(403);
  expect(store.file).not.toHaveBeenCalled();
});

it('propagates the total deadline and refuses to start another fetch after it expires', async () => {
  const controller = new AbortController();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response());
  const fetchBeforeDeadline = guardedFetch(fetcher, controller.signal);
  await fetchBeforeDeadline('https://synthetic.example');
  const signal = fetcher.mock.calls[0][1]!.signal!;
  controller.abort();
  expect(signal.aborted).toBe(true);
  expect(() => fetchBeforeDeadline('https://synthetic.example')).toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
});

// Push de Garmin (Starter solo push): cuerpo JSON con listas por tipo de resumen. Fixtures sintéticos.
const HOOK = 'synthetic-webhook-secret-0123456789';
const FILE_URL = 'https://apis.garmin.com/wellness-api/rest/activityFile?id=1001&token=synthetic-pull';
function fit() { const bytes = new Uint8Array(14); bytes[0] = 14; bytes.set(new TextEncoder().encode('.FIT'), 8); return bytes; }
async function connected(ctx: ReturnType<typeof setup>, permissions = ['ACTIVITY_EXPORT', 'COURSE_IMPORT']) {
  ctx.setConnection({ garminUserId: 'synthetic-garmin-user', ciphertext: await encryptSecret(JSON.stringify({ accessToken: 'current-access', refreshToken: 'current-refresh' }), secret, user), expiresAt: 9_000_000, refreshExpiresAt: 9_000_000, permissions });
}
function push(body: unknown, { path = `/notifications/${HOOK}`, clientId = 'synthetic-client' } = {}) {
  return new Request(`https://project.example/functions/v1/garmin${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(clientId ? { 'garmin-client-id': clientId } : {}) }, body: JSON.stringify(body) });
}
const activityFile = (over: Record<string, unknown> = {}) => ({ userId: 'synthetic-garmin-user', summaryId: '1001-file', activityId: 1001, fileType: 'FIT', callbackURL: FILE_URL, startTimeInSeconds: 1_700_000_000, ...over });

describe('receptor push', () => {
  it('stays closed (503) while no webhook secret is configured', async () => {
    const ctx = setup();
    const response = await createGarminService(ctx.options)(push({ activityFiles: [activityFile()] }));
    expect(response.status).toBe(503);
    expect(ctx.fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong path secret', { path: '/notifications/forged-secret' }],
    ['missing path secret', { path: '/notifications' }],
    ['wrong garmin-client-id', { clientId: 'other-client' }],
    ['missing garmin-client-id', { clientId: '' }],
  ])('rejects %s without touching the store', async (_label, init) => {
    const ctx = setup();
    const response = await createGarminService({ ...ctx.options, webhookSecret: HOOK })(push({ activityFiles: [activityFile()] }, init));
    expect([401, 404]).toContain(response.status);
    expect(ctx.store.userForGarmin).not.toHaveBeenCalled();
    expect(ctx.fetcher).not.toHaveBeenCalled();
  });

  it('downloads the FIT from the callbackURL with the user bearer token and stages it once', async () => {
    const ctx = setup(); await connected(ctx);
    ctx.fetcher.mockImplementation(async () => new Response(fit()));
    vi.mocked(ctx.store.claimEvent).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const handle = createGarminService({ ...ctx.options, webhookSecret: HOOK });
    expect((await handle(push({ activityFiles: [activityFile()] }))).status).toBe(200);
    expect((await handle(push({ activityFiles: [activityFile()] }))).status).toBe(200);
    expect(ctx.fetcher).toHaveBeenCalledOnce();
    const [url, init] = ctx.fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(FILE_URL);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer current-access');
    expect(ctx.store.saveFile).toHaveBeenCalledWith(user, expect.objectContaining({ id: '1001' }), fit(), expect.any(Number));
    expect(ctx.store.claimEvent).toHaveBeenCalledWith(user, 'activityFile:1001-file', 'activity');
  });

  it.each([
    ['another host', { callbackURL: 'https://evil.example/wellness-api/rest/activityFile?id=1' }],
    ['plain http', { callbackURL: 'http://apis.garmin.com/wellness-api/rest/activityFile?id=1' }],
    ['another Garmin resource', { callbackURL: 'https://apis.garmin.com/wellness-api/rest/user/id' }],
    ['userinfo', { callbackURL: 'https://x@apis.garmin.com/wellness-api/rest/activityFile?id=1' }],
    ['a GPX file', { fileType: 'GPX' }],
  ])('acknowledges but never fetches %s', async (_label, over) => {
    const ctx = setup(); await connected(ctx);
    const response = await createGarminService({ ...ctx.options, webhookSecret: HOOK })(push({ activityFiles: [activityFile(over)] }));
    expect(response.status).toBe(200);
    expect(ctx.fetcher).not.toHaveBeenCalled();
    expect(ctx.store.saveFile).not.toHaveBeenCalled();
  });

  it('ignores users that are not connected to FBikeTrain', async () => {
    const ctx = setup();
    vi.mocked(ctx.store.userForGarmin).mockResolvedValue(undefined);
    const response = await createGarminService({ ...ctx.options, webhookSecret: HOOK })(push({ activityFiles: [activityFile()] }));
    expect(response.status).toBe(200);
    expect(ctx.fetcher).not.toHaveBeenCalled();
  });

  it('answers 503 on a transient download failure so Garmin retries, leaving the event pending', async () => {
    const ctx = setup(); await connected(ctx);
    ctx.fetcher.mockResolvedValue(new Response('remote-sensitive-error', { status: 500 }));
    const response = await createGarminService({ ...ctx.options, webhookSecret: HOOK })(push({ activityFiles: [activityFile()] }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('remote-sensitive-error');
    expect(ctx.store.finishEvent).toHaveBeenCalledWith(user, 'activityFile:1001-file', false);
  });

  it('marks a non-FIT delivery as done instead of retrying forever', async () => {
    const ctx = setup(); await connected(ctx);
    ctx.fetcher.mockResolvedValue(new Response('not a fit file'));
    const response = await createGarminService({ ...ctx.options, webhookSecret: HOOK })(push({ activityFiles: [activityFile()] }));
    expect(response.status).toBe(200);
    expect(ctx.store.saveFile).not.toHaveBeenCalled();
    expect(ctx.store.finishEvent).toHaveBeenCalledWith(user, 'activityFile:1001-file', true);
  });

  it('applies deregistrations and permission changes', async () => {
    const ctx = setup(); await connected(ctx);
    const handle = createGarminService({ ...ctx.options, webhookSecret: HOOK });
    expect((await handle(push({ userPermissionsChange: [{ userId: 'synthetic-garmin-user', permissions: ['ACTIVITY_EXPORT'] }] }))).status).toBe(200);
    expect(ctx.store.updatePermissions).toHaveBeenCalledWith(user, ['ACTIVITY_EXPORT']);
    expect((await handle(push({ deregistrations: [{ userId: 'synthetic-garmin-user' }] }))).status).toBe(200);
    expect(ctx.store.removeConnection).toHaveBeenCalledWith(user);
  });

  it('rejects malformed JSON with 400', async () => {
    const ctx = setup();
    const request = new Request(`https://project.example/functions/v1/garmin/notifications/${HOOK}`, { method: 'POST', headers: { 'garmin-client-id': 'synthetic-client' }, body: '{not json' });
    expect((await createGarminService({ ...ctx.options, webhookSecret: HOOK })(request)).status).toBe(400);
  });
});

describe('enviar recorrido (Courses API)', () => {
  const course = { name: 'Vuelta sintética', distanceM: 1500, elevationGainM: 12, elevationLossM: 12,
    points: [{ lat: 41, lng: 2.5, ele: 3 }, { lat: 41.009, lng: 2.5, ele: 5 }, { lat: 41.009, lng: 2.51 }] };
  const send = (body: unknown) => new Request('https://project.example/functions/v1/garmin/course', { method: 'POST', headers: { Authorization: 'Bearer synthetic-jwt', Origin: 'https://app.example', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('publishes a ROAD_CYCLING course with points at most 100 m apart', async () => {
    const ctx = setup(); await connected(ctx);
    ctx.fetcher.mockResolvedValue(Response.json({ courseId: 987654 }));
    const response = await createGarminService(ctx.options)(send(course));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ courseId: 987654 });
    const [url, init] = ctx.fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://apis.garmin.com/training-api/courses/v1/course');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer current-access');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ courseName: 'Vuelta sintética', distance: 1500, elevationGain: 12, elevationLoss: 12, activityType: 'ROAD_CYCLING', coordinateSystem: 'WGS84' });
    expect(body.geoPoints[0]).toEqual({ latitude: 41, longitude: 2.5, elevation: 3 });
    expect(body.geoPoints.at(-1)).toEqual({ latitude: 41.009, longitude: 2.51 });
    for (let i = 1; i < body.geoPoints.length; i++) {
      const [a, b] = [body.geoPoints[i - 1], body.geoPoints[i]];
      const dLat = (b.latitude - a.latitude) * 111_195, dLng = (b.longitude - a.longitude) * 111_195 * Math.cos(41 * Math.PI / 180);
      expect(Math.hypot(dLat, dLng)).toBeLessThanOrEqual(100.5);
    }
  });

  it('refuses when the rider did not grant COURSE_IMPORT', async () => {
    const ctx = setup(); await connected(ctx, ['ACTIVITY_EXPORT']);
    const response = await createGarminService(ctx.options)(send(course));
    expect(response.status).toBe(403);
    expect(ctx.fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['no points', { ...course, points: [] }],
    ['latitude out of range', { ...course, points: [{ lat: 91, lng: 0 }, { lat: 0, lng: 0 }] }],
    ['empty name', { ...course, name: ' ' }],
  ])('rejects %s with 400', async (_label, body) => {
    const ctx = setup(); await connected(ctx);
    expect((await createGarminService(ctx.options)(send(body))).status).toBe(400);
    expect(ctx.fetcher).not.toHaveBeenCalled();
  });

  it('reports course availability in status', async () => {
    const ctx = setup(); await connected(ctx);
    const status = await (await createGarminService(ctx.options)(ctx.request('/status'))).json();
    expect(status).toMatchObject({ available: true, connected: true, courseAvailable: true });
  });
});

it('rejects anonymous Supabase users as Garmin accounts', () => {
  expect(signedInAccount({ id: 'synthetic-account', is_anonymous: true })).toBeNull();
  expect(signedInAccount(null)).toBeNull();
  expect(signedInAccount({ id: 'synthetic-account', is_anonymous: false })).toBe('synthetic-account');
});
