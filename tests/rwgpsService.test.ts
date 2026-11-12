import { handleRwgps, isAllowedRwgpsPath, rwgpsApiPath, type RwgpsServiceDependencies } from '../src/routes/sources/rwgpsService';
import type { RwgpsIndexRow } from '../src/routes/sources/rwgpsSync';

// Nunca sale a la red: `get` simulado con respuestas sintéticas de la API v1 de Ride with GPS.
const ORIGIN = 'https://usuario.github.io';
const SECRET_KEY = 'clave-de-servidor-sintetica';
const SECRET_TOKEN = 'token-de-servidor-sintetico';
const routeJson = {
  route: {
    id: 1, name: 'Ruta sintética', visibility: 'public', privacy_code: 'xyz', user: { id: 9, name: 'Autora', email: 'autora@example.com' },
    track_points: [{ x: 2, y: 41, e: 100, d: 0, S: 1 }, { x: 2, y: 41.01, d: 1112 }],
  },
};

function deps(over: Partial<RwgpsServiceDependencies> = {}) {
  const get = vi.fn<RwgpsServiceDependencies['get']>(async () => ({ status: 200, json: routeJson }));
  const consumeQuota = vi.fn<RwgpsServiceDependencies['consumeQuota']>(async () => ({ allowed: true, retryAfterS: 0 }));
  const near = vi.fn<RwgpsServiceDependencies['near']>(async () => []);
  const lastSyncAt = vi.fn<RwgpsServiceDependencies['lastSyncAt']>(async () => new Date());
  const scheduleSync = vi.fn<RwgpsServiceDependencies['scheduleSync']>(() => {});
  return {
    get, consumeQuota, near, lastSyncAt, scheduleSync,
    all: { enabled: true, allowedOrigins: [ORIGIN], authenticate: async (t: string) => (t === 'sesion' ? 'user-1' : null), consumeQuota, get, near, lastSyncAt, scheduleSync, ...over } satisfies RwgpsServiceDependencies,
  };
}
const post = (body: unknown, headers: Record<string, string> = {}) => new Request('https://x.supabase.co/functions/v1/rwgps', {
  method: 'POST', headers: { origin: ORIGIN, authorization: 'Bearer sesion', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

describe('rwgpsApiPath', () => {
  it('solo construye las dos lecturas permitidas', () => {
    expect(rwgpsApiPath({ kind: 'route', id: '12' })).toBe('/api/v1/routes/12.json');
    // privacy_code no se reenvía: la cuenta común no puede comprobarlo.
    expect(rwgpsApiPath({ kind: 'collection', id: '7', privacyCode: 'a_b-C' })).toBe('/api/v1/collections/7.json');
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
    const d = deps({ get: async () => ({ status: 200, json: { collection: { name: 'Cerca', visibility: 'public', user: { email: 'x@example.com' }, routes: [{ id: 3, name: 'a' }, { id: 4 }] } } }) });
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

  it.each([['private'], ['followers_only'], [undefined]])('una ruta con visibility %s es 403 y no se devuelve', async visibility => {
    const d = deps({ get: async () => ({ status: 200, json: { route: { ...routeJson.route, visibility } } }) });
    const res = await handleRwgps(post({ kind: 'route', id: '1' }), d.all);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('track_points');
  });

  it('un privacy_code cualquiera no abre lo privado de la cuenta común', async () => {
    const d = deps({ get: async () => ({ status: 200, json: { route: { ...routeJson.route, visibility: 'private' } } }) });
    expect((await handleRwgps(post({ kind: 'route', id: '1', privacyCode: 'inventado' }), d.all)).status).toBe(403);
  });

  it('una colección privada es 403', async () => {
    const d = deps({ get: async () => ({ status: 200, json: { collection: { name: 'Mía', visibility: 'private', routes: [{ id: 3 }] } } }) });
    expect((await handleRwgps(post({ kind: 'collection', id: '5' }), d.all)).status).toBe(403);
  });

  it('una ruta sin track válido es 502', async () => {
    const d = deps({ get: async () => ({ status: 200, json: { route: { name: 'x', visibility: 'public', track_points: [{ x: 500, y: 0 }, { x: 0, y: 0 }] } } }) });
    expect((await handleRwgps(post({ kind: 'route', id: '1' }), d.all)).status).toBe(502);
  });
});

describe('isAllowedRwgpsPath', () => {
  it.each([
    '/api/v1/routes/12.json', '/api/v1/collections/7.json',
    '/api/v1/routes.json?page=1&page_size=200', '/api/v1/collections.json?page=3&page_size=200',
  ])('permite %s', path => expect(isAllowedRwgpsPath(path)).toBe(true));
  it.each([
    '/api/v1/users/current.json', '/api/v1/auth_tokens.json', '/api/v1/routes/12.gpx', '/api/v1/routes/12/polyline.json',
    '/api/v1/collections/pinned.json', '/api/v1/routes.json', '/api/v1/routes.json?page=1&page_size=200&visibility=private',
    '/api/v1/routes/0.json', '//evil.example/api/v1/routes/1.json', '/api/v1/routes/1.json?privacy_code=x',
  ])('rechaza %s', path => expect(isAllowedRwgpsPath(path)).toBe(false));
});

// Rutas indexadas sintéticas de norte a sur, de (41, lng) a (41.1, lng), alrededor del punto (41.05, 2).
function indexed(id: number, lngOffset: number, distanceM: number): RwgpsIndexRow {
  const lng = 2 + lngOffset;
  return {
    id, name: `Ruta ${id}`, author: 'Autora', distance_m: distanceM, elev_gain_m: id % 2 ? 300 : null, start_lat: 41, start_lng: lng,
    min_lat: 41, max_lat: 41.1, min_lng: lng, max_lng: lng, line: [[lng, 41], [lng, 41.1]], source: 'seed',
  };
}
// Grados de longitud por kilómetro a 41,05° de latitud.
const KM_LNG = 1 / (111.32 * Math.cos((41.05 * Math.PI) / 180));

describe('función rwgps: rutas cerca (op nearby)', () => {
  const nearby = (extra: Record<string, unknown> = {}) => post({ op: 'nearby', lat: 41.05, lng: 2, ...extra });

  it.each([
    [{ lat: 91 }], [{ lat: -91 }], [{ lng: 181 }], [{ lng: -181 }], [{ lat: '41' }],
    [{ radiusKm: 0.5 }], [{ radiusKm: 31 }], [{ distanceKm: 4 }], [{ distanceKm: 301 }], [{ kind: 'route' }], [{ id: '1' }],
  ])('valida la petición sin gastar cuota: %j', async extra => {
    const d = deps();
    const res = await handleRwgps(nearby(extra), d.all);
    expect(res.status).toBe(400);
    expect(d.consumeQuota).not.toHaveBeenCalled();
    expect(d.near).not.toHaveBeenCalled();
  });

  it('cuota agotada: 429 sin consultar el índice', async () => {
    const d = deps({ consumeQuota: async () => ({ allowed: false, retryAfterS: 500 }) });
    const res = await handleRwgps(nearby(), d.all);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { code: 'quota_exceeded' }, retryAfterS: 500 });
    expect(d.near).not.toHaveBeenCalled();
  });

  it('gasta 1 de cuota, usa 10 km por defecto, filtra por paso y ordena por cercanía', async () => {
    const d = deps();
    d.near.mockResolvedValue([indexed(1, 6 * KM_LNG, 50_000), indexed(2, 0, 80_000), indexed(3, 15 * KM_LNG, 60_000), indexed(4, -3 * KM_LNG, 40_000)]);
    const res = await handleRwgps(nearby(), d.all);
    expect(res.status).toBe(200);
    expect(d.consumeQuota).toHaveBeenCalledTimes(1);
    expect(d.near).toHaveBeenCalledWith(41.05, 2, 10);
    const { data } = await res.json();
    expect(data.routes.map((r: { id: string }) => r.id)).toEqual(['2', '4', '1']);
    expect(data.total).toBe(3);
    expect(data.routes[0]).toEqual({ id: '2', name: 'Ruta 2', author: 'Autora', distanceM: 80_000, elevGainM: null, start: { lat: 41, lng: 2 }, line: [[2, 41], [2, 41.1]], passM: 0 });
    expect(data.routes[1].passM).toBeGreaterThan(2900);
    expect(data.routes[1].passM).toBeLessThan(3100);
  });

  it('con distancia objetivo, ordena por diferencia de distancia y después por paso', async () => {
    const d = deps();
    d.near.mockResolvedValue([indexed(1, 6 * KM_LNG, 52_000), indexed(2, 0, 80_000), indexed(3, 2 * KM_LNG, 48_000), indexed(4, 1 * KM_LNG, 48_000)]);
    const { data } = await (await handleRwgps(nearby({ radiusKm: 12, distanceKm: 50 }), d.all)).json();
    expect(d.near).toHaveBeenCalledWith(41.05, 2, 12);
    expect(data.routes.map((r: { id: string }) => r.id)).toEqual(['4', '3', '1', '2']);
  });

  it('devuelve como mucho 60 rutas y el total encontrado', async () => {
    const d = deps();
    d.near.mockResolvedValue(Array.from({ length: 90 }, (_, i) => indexed(i + 1, (i / 20) * KM_LNG, 50_000)));
    const { data } = await (await handleRwgps(nearby(), d.all)).json();
    expect(data.routes).toHaveLength(60);
    expect(data.total).toBe(90);
  });

  it('ignora filas del índice mal formadas', async () => {
    const d = deps();
    d.near.mockResolvedValue([{ ...indexed(1, 0, 1000), line: [[2, 41]] }, { ...indexed(2, 0, 1000), line: 'x' } as unknown as RwgpsIndexRow, indexed(3, 0, 1000)]);
    const { data } = await (await handleRwgps(nearby(), d.all)).json();
    expect(data.routes.map((r: { id: string }) => r.id)).toEqual(['3']);
  });

  it('si el índice falla, 503 sin detalles', async () => {
    const d = deps({ near: async () => { throw new Error('relation rwgps_route_index secret'); } });
    const res = await handleRwgps(nearby(), d.all);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('secret');
  });

  it.each([[null], [new Date(Date.now() - 7 * 3600_000)]])('índice sin sincronizar (%s): programa la sincronización', async last => {
    const d = deps({ lastSyncAt: async () => last });
    expect((await handleRwgps(nearby(), d.all)).status).toBe(200);
    expect(d.scheduleSync).toHaveBeenCalledTimes(1);
  });

  it('índice reciente: no programa nada', async () => {
    const d = deps({ lastSyncAt: async () => new Date(Date.now() - 3600_000) });
    await handleRwgps(nearby(), d.all);
    expect(d.scheduleSync).not.toHaveBeenCalled();
  });

  it('la sincronización nunca rompe la respuesta', async () => {
    const d = deps({ lastSyncAt: async () => null, scheduleSync: () => { throw new Error('boom'); } });
    expect((await handleRwgps(nearby(), d.all)).status).toBe(200);
    const e = deps({ lastSyncAt: async () => { throw new Error('db'); } });
    expect((await handleRwgps(nearby(), e.all)).status).toBe(200);
    expect(e.scheduleSync).not.toHaveBeenCalled();
  });

  it('una petición sin op sigue siendo una lectura (compatibilidad)', async () => {
    const d = deps();
    expect((await handleRwgps(post({ kind: 'route', id: '1' }), d.all)).status).toBe(200);
    expect(d.near).not.toHaveBeenCalled();
    expect((await handleRwgps(post({ op: 'get', kind: 'route', id: '1' }), d.all)).status).toBe(400);
  });
});

describe('función rwgps: leer no escribe en el índice', () => {
  it('una lectura pública no toca el índice compartido', async () => {
    const d = deps();
    expect((await handleRwgps(post({ kind: 'route', id: '1' }), d.all)).status).toBe(200);
    expect(d.near).not.toHaveBeenCalled();
    expect(d.scheduleSync).not.toHaveBeenCalled();
  });
});
