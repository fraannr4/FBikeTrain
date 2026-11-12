import { buildIndexRow, simplifyLine, syncRwgpsIndex, MAX_SYNC_ROUTE_FETCHES, type RwgpsIndexRow, type RwgpsSyncDependencies } from '../src/routes/sources/rwgpsSync';
import { isAllowedRwgpsPath } from '../src/routes/sources/rwgpsService';

// Índice propio de rutas públicas de Ride with GPS. Sin red: `get` simulado con respuestas sintéticas de la API v1.
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 12, 12);
const SECRET_TOKEN = 'token-de-servidor-sintetico';

function track(n: number, lat0 = 41, lng0 = 2) {
  return Array.from({ length: n }, (_, i) => ({ x: lng0 + i * 0.0001, y: lat0 + i * 0.0001, e: 100 + (i % 2) * 5, d: i * 13.6, S: 1, R: 2 }));
}
function routeDetail(id: number, visibility = 'public', n = 5) {
  return { route: { id, name: `Ruta ${id}`, visibility, user_id: 99, user: { id: 99, name: 'Autora', email: 'autora@example.com' }, privacy_code: 'secreto', distance: 5000, elevation_gain: 120, track_points: track(n) } };
}
const listPage = (kind: 'routes' | 'collections', page: number) => `/api/v1/${kind}.json?page=${page}&page_size=200`;

function setup(responses: Record<string, unknown>, indexed: Record<number, number> = {}) {
  const get = vi.fn<RwgpsSyncDependencies['get']>(async path => (path in responses ? { status: 200, json: responses[path] } : { status: 404, json: null }));
  const upserted: RwgpsIndexRow[] = [];
  const removed: number[] = [];
  const deps: RwgpsSyncDependencies = {
    get,
    indexedAt: async ids => new Map(ids.filter(id => id in indexed).map(id => [id, indexed[id]])),
    upsert: async row => { upserted.push(row); },
    remove: async id => { removed.push(id); },
    now: () => NOW,
  };
  return { deps, get, upserted, removed };
}

describe('syncRwgpsIndex', () => {
  const base = {
    [listPage('collections', 1)]: { collections: [{ id: 10, visibility: 'private' }, { id: 11 }] },
    '/api/v1/collections/10.json': { collection: { id: 10, visibility: 'private', routes: [{ id: 1, visibility: 'public' }, { id: 2, visibility: 'private' }] } },
    '/api/v1/collections/11.json': { collection: { id: 11, routes: [{ id: 3 }, { id: 1, visibility: 'public' }] } },
    [listPage('routes', 1)]: { routes: [{ id: 4, visibility: 'public' }], meta: { pagination: { record_count: 1, page_count: 1, page_size: 200, next_page_url: null } } },
    '/api/v1/routes/1.json': routeDetail(1),
    '/api/v1/routes/3.json': routeDetail(3, 'private'),
    '/api/v1/routes/4.json': routeDetail(4),
  };

  it('indexa solo las rutas públicas de colecciones y de la cuenta, sin repetir', async () => {
    const s = setup(base);
    const result = await syncRwgpsIndex(s.deps, new AbortController().signal);
    expect(s.upserted.map(r => r.id).sort()).toEqual([1, 4]);
    expect(s.upserted.every(r => r.source === 'seed')).toBe(true);
    const paths = s.get.mock.calls.map(c => c[0]);
    expect(paths).not.toContain('/api/v1/routes/2.json'); // privada según el resumen: ni se pide
    expect(paths.filter(p => p === '/api/v1/routes/1.json')).toHaveLength(1);
    expect(result).toMatchObject({ indexed: 2, error: null });
  });

  it('solo pide rutas de la lista permitida', async () => {
    const s = setup(base);
    await syncRwgpsIndex(s.deps, new AbortController().signal);
    for (const [path] of s.get.mock.calls) expect(isAllowedRwgpsPath(path)).toBe(true);
  });

  it('pagina las rutas de la cuenta mientras haya página siguiente', async () => {
    const s = setup({
      ...base,
      [listPage('routes', 1)]: { routes: [{ id: 4, visibility: 'public' }], meta: { pagination: { record_count: 2, page_count: 2, page_size: 200, next_page_url: 'https://ridewithgps.com/api/v1/routes.json?page=2' } } },
      [listPage('routes', 2)]: { routes: [{ id: 5, visibility: 'public' }], meta: { pagination: { record_count: 2, page_count: 2, page_size: 200, next_page_url: null } } },
      '/api/v1/routes/5.json': routeDetail(5),
    });
    await syncRwgpsIndex(s.deps, new AbortController().signal);
    expect(s.upserted.map(r => r.id).sort()).toEqual([1, 4, 5]);
  });

  it(`como mucho ${MAX_SYNC_ROUTE_FETCHES} rutas por pasada`, async () => {
    const ids = Array.from({ length: 200 }, (_, i) => i + 100);
    const responses: Record<string, unknown> = {
      [listPage('collections', 1)]: { collections: [] },
      [listPage('routes', 1)]: { routes: ids.map(id => ({ id, visibility: 'public' })), meta: { pagination: { record_count: 200, page_count: 1, page_size: 200, next_page_url: null } } },
    };
    for (const id of ids) responses[`/api/v1/routes/${id}.json`] = routeDetail(id);
    const s = setup(responses);
    await syncRwgpsIndex(s.deps, new AbortController().signal);
    expect(MAX_SYNC_ROUTE_FETCHES).toBe(80);
    expect(s.get.mock.calls.filter(c => /^\/api\/v1\/routes\/\d+\.json$/.test(c[0]))).toHaveLength(80);
    expect(s.upserted).toHaveLength(80);
  });

  it('no vuelve a pedir lo indexado hace menos de 30 días y refresca lo antiguo', async () => {
    const s = setup(base, { 1: NOW - 2 * DAY, 4: NOW - 31 * DAY });
    await syncRwgpsIndex(s.deps, new AbortController().signal);
    const paths = s.get.mock.calls.map(c => c[0]);
    expect(paths).not.toContain('/api/v1/routes/1.json');
    expect(paths).toContain('/api/v1/routes/4.json');
  });

  it('quita del índice una ruta indexada que ya no es pública o ya no existe', async () => {
    const responses: Record<string, unknown> = { ...base, '/api/v1/routes/4.json': routeDetail(4, 'private') };
    delete responses['/api/v1/routes/1.json']; // 404
    const s = setup(responses, { 1: NOW - 40 * DAY, 4: NOW - 40 * DAY });
    await syncRwgpsIndex(s.deps, new AbortController().signal);
    expect(s.removed.sort()).toEqual([1, 4]);
    expect(s.upserted).toHaveLength(0);
  });

  it('para al primer 429 de Ride with GPS', async () => {
    const s = setup(base);
    const get = vi.fn<RwgpsSyncDependencies['get']>(async path => (path.startsWith('/api/v1/routes/') ? { status: 429, json: null } : s.deps.get(path, new AbortController().signal)));
    const result = await syncRwgpsIndex({ ...s.deps, get }, new AbortController().signal);
    expect(result.error).toBe('provider_busy');
    expect(get.mock.calls.filter(c => c[0].startsWith('/api/v1/routes/'))).toHaveLength(1);
  });

  it('si la lista falla, devuelve un código de error sin texto de Ride with GPS', async () => {
    const s = setup({});
    const result = await syncRwgpsIndex({ ...s.deps, get: async () => ({ status: 500, json: { error: SECRET_TOKEN } }) }, new AbortController().signal);
    expect(result.error).toBe('provider_error');
    expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN);
  });

  it('cancelada, no sigue pidiendo rutas', async () => {
    const s = setup(base);
    const controller = new AbortController();
    controller.abort();
    const result = await syncRwgpsIndex(s.deps, controller.signal);
    expect(result.error).toBe('timeout');
    expect(s.upserted).toHaveLength(0);
  });
});

describe('buildIndexRow', () => {
  it('resume la ruta: nombre, autor, cifras, inicio, caja y línea simplificada', () => {
    const json = routeDetail(7, 'public', 1000);
    const row = buildIndexRow(7, json, 'user')!;
    expect(row).toMatchObject({ id: 7, name: 'Ruta 7', author: 'Autora', distance_m: 5000, elev_gain_m: 120, start_lat: 41, start_lng: 2, source: 'user' });
    expect(row.line.length).toBeLessThanOrEqual(300);
    expect(row.line[0]).toEqual([2, 41]);
    expect(row.line.at(-1)).toEqual([2 + 999 * 0.0001, 41 + 999 * 0.0001].map(v => Math.round(v * 1e5) / 1e5));
    expect(row.min_lat).toBe(41);
    expect(row.max_lat).toBeCloseTo(41.0999, 6);
    expect(row.min_lng).toBe(2);
    expect(row.max_lng).toBeCloseTo(2.0999, 6);
  });

  it('nunca guarda correo, ids de usuario ni privacy_code', () => {
    const text = JSON.stringify(buildIndexRow(7, routeDetail(7), 'seed'));
    expect(text).not.toContain('autora@example.com');
    expect(text).not.toContain('secreto');
    expect(text).not.toContain('99');
  });

  it('sin cifras de la API, calcula la distancia y el desnivel desde el track', () => {
    const json = { route: { name: 'x', visibility: 'public', track_points: [{ x: 2, y: 41, e: 100 }, { x: 2, y: 41.01, e: 150 }, { x: 2, y: 41.02, e: 130 }] } };
    const row = buildIndexRow(8, json, 'seed')!;
    expect(row.distance_m).toBeGreaterThan(2200);
    expect(row.distance_m).toBeLessThan(2250);
    expect(row.elev_gain_m).toBe(50);
    expect(row.author).toBe('');
  });

  it('sin elevación, el desnivel queda en null', () => {
    const row = buildIndexRow(8, { route: { visibility: 'public', track_points: [{ x: 2, y: 41 }, { x: 2, y: 41.01 }] } }, 'seed')!;
    expect(row.elev_gain_m).toBeNull();
  });

  it.each([
    [{ route: { visibility: 'private', track_points: track(5) } }],
    [{ route: { track_points: track(5) } }],
    [{ route: { visibility: 'public', track_points: [{ x: 2, y: 41 }, { x: 500, y: 41 }] } }],
    [{ route: { visibility: 'public', track_points: [{ x: 2, y: 41 }] } }],
    [null],
  ])('no indexa lo que no es público o no tiene 2 puntos válidos: %j', json => {
    expect(buildIndexRow(9, json, 'seed')).toBeNull();
  });
});

describe('simplifyLine', () => {
  it('deja como mucho 300 puntos y conserva el primero y el último', () => {
    const points = Array.from({ length: 5000 }, (_, i) => [i, i] as [number, number]);
    const line = simplifyLine(points, 300);
    expect(line).toHaveLength(300);
    expect(line[0]).toEqual([0, 0]);
    expect(line.at(-1)).toEqual([4999, 4999]);
  });

  it('no toca una línea corta', () => {
    expect(simplifyLine([[1, 2], [3, 4]], 300)).toEqual([[1, 2], [3, 4]]);
  });
});
