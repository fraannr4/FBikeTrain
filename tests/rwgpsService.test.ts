import { handleRwgps, rwgpsApiPath, type RwgpsServiceDependencies } from '../src/routes/sources/rwgpsService';

// Nunca sale a la red: `get` simulado con respuestas sintéticas de la API v1 de Ride with GPS.
const ORIGIN = 'https://usuario.github.io';
const SECRET_KEY = 'clave-de-servidor-sintetica';
const SECRET_TOKEN = 'token-de-servidor-sintetico';
const routeJson = {
  route: {
    id: 1, name: 'Ruta sintética', privacy_code: 'xyz', user: { id: 9, name: 'Autora', email: 'autora@example.com' },
    track_points: [{ x: 2, y: 41, e: 100, d: 0, S: 1 }, { x: 2, y: 41.01, d: 1112 }],
  },
};

function deps(over: Partial<RwgpsServiceDependencies> = {}) {
  const get = vi.fn<RwgpsServiceDependencies['get']>(async () => ({ status: 200, json: routeJson }));
  const consumeQuota = vi.fn<RwgpsServiceDependencies['consumeQuota']>(async () => ({ allowed: true, retryAfterS: 0 }));
  return {
    get, consumeQuota,
    all: { enabled: true, allowedOrigins: [ORIGIN], authenticate: async (t: string) => (t === 'sesion' ? 'user-1' : null), consumeQuota, get, ...over } satisfies RwgpsServiceDependencies,
  };
}
const post = (body: unknown, headers: Record<string, string> = {}) => new Request('https://x.supabase.co/functions/v1/rwgps', {
  method: 'POST', headers: { origin: ORIGIN, authorization: 'Bearer sesion', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

describe('rwgpsApiPath', () => {
  it('solo construye las dos lecturas permitidas', () => {
    expect(rwgpsApiPath({ kind: 'route', id: '12' })).toBe('/api/v1/routes/12.json');
    expect(rwgpsApiPath({ kind: 'collection', id: '7', privacyCode: 'a_b-C' })).toBe('/api/v1/collections/7.json?privacy_code=a_b-C');
  });
});

describe('función rwgps', () => {
  it('devuelve solo nombre, autor y puntos, con CORS del origen de la app', async () => {
    const d = deps();
    const res = await handleRwgps(post({ kind: 'route', id: '1' }), d.all);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const body = await res.json();
    expect(body).toEqual({ data: { route: { name: 'Ruta sintética', user: { name: 'Autora' }, track_points: [{ x: 2, y: 41, e: 100 }, { x: 2, y: 41.01 }] } } });
    expect(d.get).toHaveBeenCalledWith('/api/v1/routes/1.json', expect.any(AbortSignal));
    expect(d.consumeQuota).toHaveBeenCalledWith('user-1');
  });

  it('nunca devuelve la clave ni el token del servidor, tampoco en errores', async () => {
    for (const status of [200, 401, 403, 404, 429, 500]) {
      const d = deps({ get: async () => ({ status, json: { ...routeJson, api_key: SECRET_KEY, auth_token: SECRET_TOKEN, error: SECRET_TOKEN } }) });
      const text = await (await handleRwgps(post({ kind: 'route', id: '1' }), d.all)).text();
      expect(text).not.toContain(SECRET_KEY);
      expect(text).not.toContain(SECRET_TOKEN);
      expect(text).not.toContain('autora@example.com');
    }
  });

  it('colecciones: solo nombre e ids', async () => {
    const d = deps({ get: async () => ({ status: 200, json: { collection: { name: 'Cerca', user: { email: 'x@example.com' }, routes: [{ id: 3, name: 'a' }, { id: 4 }] } } }) });
    const body = await (await handleRwgps(post({ kind: 'collection', id: '55' }), d.all)).json();
    expect(body).toEqual({ data: { collection: { name: 'Cerca', routes: [{ id: 3 }, { id: 4 }] } } });
  });

  it.each([
    [{ kind: 'route', id: '1/../../users' }],
    [{ kind: 'route', id: 'pinned' }],
    [{ kind: 'collection', id: '0' }],
    [{ kind: 'user', id: '1' }],
    [{ kind: 'route', id: '1', privacyCode: 'a&b=c' }],
    [{ kind: 'route', id: '1', path: '/api/v1/users/current.json' }],
  ])('rechaza fuera de la lista permitida: %j', async body => {
    const d = deps();
    const res = await handleRwgps(post(body), d.all);
    expect(res.status).toBe(400);
    expect(d.get).not.toHaveBeenCalled();
    expect(d.consumeQuota).not.toHaveBeenCalled();
  });

  it('sin sesión válida no consume cuota ni llama', async () => {
    const d = deps();
    expect((await handleRwgps(post({ kind: 'route', id: '1' }, { authorization: '' }), d.all)).status).toBe(401);
    expect((await handleRwgps(post({ kind: 'route', id: '1' }, { authorization: 'Bearer otra' }), d.all)).status).toBe(401);
    expect(d.get).not.toHaveBeenCalled();
  });

  it('rechaza otros orígenes y métodos', async () => {
    const d = deps();
    expect((await handleRwgps(post({ kind: 'route', id: '1' }, { origin: 'https://evil.example' }), d.all)).status).toBe(403);
    expect((await handleRwgps(new Request('https://x/functions/v1/rwgps', { method: 'GET', headers: { origin: ORIGIN } }), d.all)).status).toBe(405);
    expect((await handleRwgps(new Request('https://x/functions/v1/rwgps', { method: 'OPTIONS', headers: { origin: ORIGIN } }), d.all)).status).toBe(204);
    expect(d.get).not.toHaveBeenCalled();
  });

  it('sin secretos configurados responde 503', async () => {
    const d = deps({ enabled: false });
    expect((await handleRwgps(post({ kind: 'route', id: '1' }), d.all)).status).toBe(503);
  });

  it('cuota agotada: 429 con retryAfterS y sin llamar a Ride with GPS', async () => {
    const d = deps({ consumeQuota: async () => ({ allowed: false, retryAfterS: 3600 }) });
    const res = await handleRwgps(post({ kind: 'route', id: '1' }), d.all);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { code: 'quota_exceeded' }, retryAfterS: 3600 });
    expect(d.get).not.toHaveBeenCalled();
  });

  it.each([
    [401, 503, 'unavailable'],
    [403, 403, 'not_visible'],
    [404, 404, 'not_found'],
    [429, 429, 'provider_busy'],
    [500, 502, 'provider_error'],
  ])('Ride with GPS %i se traduce a %i %s', async (upstream, status, code) => {
    const d = deps({ get: async () => ({ status: upstream, json: null }) });
    const res = await handleRwgps(post({ kind: 'route', id: '1' }), d.all);
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
  });

  it('una ruta sin track válido es 502', async () => {
    const d = deps({ get: async () => ({ status: 200, json: { route: { name: 'x', track_points: [{ x: 500, y: 0 }, { x: 0, y: 0 }] } } }) });
    expect((await handleRwgps(post({ kind: 'route', id: '1' }), d.all)).status).toBe(502);
  });
});
