import { syncReferenceRoutes, MAX_SYNC_ROUTE_FETCHES, type ReferenceSyncDependencies } from '../src/routes/sources/rwgpsSync';
import type { ReferenceRouteRow } from '../src/routes/library/rows';
import { isAllowedRwgpsPath } from '../src/routes/sources/rwgpsService';

// Sincronización de la cuenta común de Ride with GPS hacia `reference_routes`. Sin red: `get` simulado
// con respuestas sintéticas de la API v1, en el mar frente a la costa (41,0 / 2,5).
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 12, 12);
const SECRET_TOKEN = 'token-de-servidor-sintetico';

function track(n: number) {
  return Array.from({ length: n }, (_, i) => ({ x: 2.5 + i * 0.0001, y: 41 + i * 0.0001, e: 100 + (i % 2) * 5, d: i * 13.6, S: 1, R: 2 }));
}
function routeDetail(id: number, visibility = 'public') {
  return { route: { id, name: `Ruta ${id}`, visibility, user_id: 99, user: { id: 99, name: 'Autora' }, distance: 5000, elevation_gain: 120, track_points: track(5) } };
}
const listPage = (kind: 'routes' | 'collections', page: number) => `/api/v1/${kind}.json?page=${page}&page_size=200`;

function setup(responses: Record<string, unknown>, imported: Record<string, number> = {}) {
  const get = vi.fn<ReferenceSyncDependencies['get']>(async path => (path in responses ? { status: 200, json: responses[path] } : { status: 404, json: null }));
  const upserted: ReferenceRouteRow[] = [];
  const removed: string[] = [];
  const deps: ReferenceSyncDependencies = {
    get,
    importedAt: async ids => new Map(ids.filter(id => id in imported).map(id => [id, imported[id]])),
    upsert: async row => { upserted.push(row); },
    remove: async id => { removed.push(id); },
    now: () => NOW,
  };
  return { deps, get, upserted, removed };
}

const base = {
  [listPage('collections', 1)]: { collections: [{ id: 10 }, { id: 11 }] },
  '/api/v1/collections/10.json': { collection: { id: 10, routes: [{ id: 1, visibility: 'public' }, { id: 2, visibility: 'private' }] } },
  '/api/v1/collections/11.json': { collection: { id: 11, routes: [{ id: 3 }, { id: 1, visibility: 'public' }] } },
  [listPage('routes', 1)]: { routes: [{ id: 4, visibility: 'public' }], meta: { pagination: { next_page_url: null } } },
  '/api/v1/routes/1.json': routeDetail(1),
  '/api/v1/routes/3.json': routeDetail(3, 'private'),
  '/api/v1/routes/4.json': routeDetail(4),
};

describe('syncReferenceRoutes', () => {
  it('sube las rutas públicas nuevas como filas rwgps, sin repetir', async () => {
    const s = setup(base);
    const result = await syncReferenceRoutes(s.deps, new AbortController().signal);
    expect(s.upserted.map(r => r.source_id).sort()).toEqual(['1', '4']);
    expect(s.upserted.every(r => r.source === 'rwgps' && r.url === `https://ridewithgps.com/routes/${r.source_id}`)).toBe(true);
    const paths = s.get.mock.calls.map(c => c[0]);
    expect(paths).not.toContain('/api/v1/routes/2.json'); // privada según el resumen: ni se pide
    expect(paths.filter(p => p === '/api/v1/routes/1.json')).toHaveLength(1);
    expect(result).toMatchObject({ indexed: 2, error: null });
  });

  it('solo pide rutas de la lista permitida', async () => {
    const s = setup(base);
    await syncReferenceRoutes(s.deps, new AbortController().signal);
    for (const [path] of s.get.mock.calls) expect(isAllowedRwgpsPath(path)).toBe(true);
  });

  it('pagina las rutas de la cuenta mientras haya página siguiente', async () => {
    const s = setup({
      ...base,
      [listPage('routes', 1)]: { routes: [{ id: 4, visibility: 'public' }], meta: { pagination: { next_page_url: 'https://ridewithgps.com/api/v1/routes.json?page=2' } } },
      [listPage('routes', 2)]: { routes: [{ id: 5, visibility: 'public' }], meta: { pagination: { next_page_url: null } } },
      '/api/v1/routes/5.json': routeDetail(5),
    });
    await syncReferenceRoutes(s.deps, new AbortController().signal);
    expect(s.upserted.map(r => r.source_id).sort()).toEqual(['1', '4', '5']);
  });

  it(`como mucho ${MAX_SYNC_ROUTE_FETCHES} rutas por pasada`, async () => {
    const ids = Array.from({ length: 200 }, (_, i) => i + 100);
    const responses: Record<string, unknown> = {
      [listPage('collections', 1)]: { collections: [] },
      [listPage('routes', 1)]: { routes: ids.map(id => ({ id, visibility: 'public' })), meta: { pagination: { next_page_url: null } } },
    };
    for (const id of ids) responses[`/api/v1/routes/${id}.json`] = routeDetail(id);
    const s = setup(responses);
    await syncReferenceRoutes(s.deps, new AbortController().signal);
    expect(MAX_SYNC_ROUTE_FETCHES).toBe(80);
    expect(s.upserted).toHaveLength(80);
  });

  it('no vuelve a pedir una ruta importada hace 10 días y refresca la de hace 31', async () => {
    const s = setup(base, { 1: NOW - 10 * DAY, 4: NOW - 31 * DAY });
    await syncReferenceRoutes(s.deps, new AbortController().signal);
    const paths = s.get.mock.calls.map(c => c[0]);
    expect(paths).not.toContain('/api/v1/routes/1.json');
    expect(paths).toContain('/api/v1/routes/4.json');
  });

  it('borra una ruta importada que ya no es pública o ya no existe', async () => {
    const responses: Record<string, unknown> = { ...base, '/api/v1/routes/4.json': routeDetail(4, 'private') };
    delete responses['/api/v1/routes/1.json']; // 404
    const s = setup(responses, { 1: NOW - 40 * DAY, 4: NOW - 40 * DAY });
    const result = await syncReferenceRoutes(s.deps, new AbortController().signal);
    expect(s.removed.sort()).toEqual(['1', '4']);
    expect(s.upserted).toHaveLength(0);
    expect(result.removed).toBe(2);
  });

  it('un 429 corta la pasada con provider_busy', async () => {
    const s = setup(base);
    const get = vi.fn<ReferenceSyncDependencies['get']>(async (path, signal) => (path.startsWith('/api/v1/routes/') ? { status: 429, json: null } : s.deps.get(path, signal)));
    const result = await syncReferenceRoutes({ ...s.deps, get }, new AbortController().signal);
    expect(result.error).toBe('provider_busy');
    expect(get.mock.calls.filter(c => c[0].startsWith('/api/v1/routes/'))).toHaveLength(1);
    expect(s.upserted).toHaveLength(0);
  });

  it('si la lista falla, devuelve un código de error sin texto de Ride with GPS', async () => {
    const s = setup({});
    const result = await syncReferenceRoutes({ ...s.deps, get: async () => ({ status: 500, json: { error: SECRET_TOKEN } }) }, new AbortController().signal);
    expect(result.error).toBe('provider_error');
    expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN);
  });

  it('cancelada, no sigue pidiendo rutas', async () => {
    const s = setup(base);
    const controller = new AbortController();
    controller.abort();
    const result = await syncReferenceRoutes(s.deps, controller.signal);
    expect(result.error).toBe('timeout');
    expect(s.upserted).toHaveLength(0);
  });
});
