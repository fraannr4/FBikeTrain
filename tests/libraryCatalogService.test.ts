import { webcrypto } from 'node:crypto';
import { handleRouteSources, type RouteSourceDependencies } from '../src/routes/sources/service';
import { findLibraryCatalog, findLibraryRoute } from '../src/routes/sources/client';
import { buildLibraryCatalog, catalogResponseSchema, detailResponseSchema, toLibraryDetail } from '../src/routes/library/catalog';
import { circleBox } from '../src/routes/library/zoneResponse';
import { squareRow } from './fixtures/libraryZone';

const user = { id: '10000000-0000-4000-8000-000000000001', isAnonymous: false };
const request = (body: unknown) => new Request('https://app.test/route-sources', { method: 'POST', headers: { authorization: 'Bearer session', 'content-type': 'application/json', origin: 'https://app.test' }, body: JSON.stringify(body) });
const mock = (): RouteSourceDependencies => ({
  enabled: true, wikilocAuthorized: false, wikilocSearchTemplate: '', allowedOrigins: ['https://app.test'],
  authenticate: vi.fn().mockResolvedValue(user), consumeQuota: vi.fn().mockResolvedValue({ allowed: true, retryAfterS: 0 }),
  readCache: vi.fn().mockResolvedValue(null), writeCache: vi.fn().mockResolvedValue(undefined),
  claim: vi.fn().mockResolvedValue(true), fetch: vi.fn(), now: () => 0,
  routesInBox: vi.fn().mockResolvedValue([]), heatCellsInBox: vi.fn().mockResolvedValue([]), replaceHeatCells: vi.fn().mockResolvedValue(undefined),
  upsertRoutes: vi.fn(), rwgpsRouteDetail: vi.fn(), lastRwgpsSyncAt: vi.fn().mockResolvedValue(null), requestRwgpsSync: vi.fn(),
  routeById: vi.fn().mockResolvedValue(null),
});
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('route-sources: catálogo de la biblioteca (library-list y library-route)', () => {
  const list = { source: 'library', kind: 'library-list', lat: 40.0004, lon: -3.0004, radiusM: 50_000 };
  const one = { source: 'library', kind: 'library-route', id: '00000000-0000-4000-8000-000000000001' };
  const rows = (n: number) => Array.from({ length: n }, (_, i) => squareRow(i + 1, { km: 50 + i, eastKm: i }));

  it('lista las rutas cercanas con miniatura, sin línea completa, gastando una consulta de cuota', async () => {
    const deps = mock(); deps.routesInBox = vi.fn().mockResolvedValue(rows(3));
    const response = await handleRouteSources(request(list), deps);
    expect(response.status).toBe(200);
    const catalog = catalogResponseSchema.parse((await response.json()).data);
    expect(catalog.total).toBe(3);
    expect(catalog.routes[0]).not.toHaveProperty('line');
    expect(deps.consumeQuota).toHaveBeenCalledWith(user.id);
    expect(deps.routesInBox).toHaveBeenCalledWith(circleBox(40, -3, 50_000));
    // Solo lee: ni llena zonas ni sincroniza.
    expect(deps.fetch).not.toHaveBeenCalled(); expect(deps.requestRwgpsSync).not.toHaveBeenCalled(); expect(deps.upsertRoutes).not.toHaveBeenCalled();
  });
  it('exige sesión, cuota y una petición válida', async () => {
    const anon = mock(); anon.authenticate = vi.fn().mockResolvedValue(null);
    expect((await handleRouteSources(request(list), anon)).status).toBe(401);
    const limited = mock(); limited.consumeQuota = vi.fn().mockResolvedValue({ allowed: false, retryAfterS: 12 });
    const response = await handleRouteSources(request(list), limited);
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('12');
    expect(limited.routesInBox).not.toHaveBeenCalled();
    for (const bad of [{ ...list, radiusM: 10 }, { ...list, distanceKm: 60 }, { ...one, id: 'no' }, { ...one, lat: 1 }])
      expect((await handleRouteSources(request(bad), mock())).status).toBe(400);
  });
  it('un fallo de lectura no filtra detalles', async () => {
    const deps = mock(); deps.routesInBox = vi.fn().mockRejectedValue(new Error('service-role-secret'));
    const response = await handleRouteSources(request(list), deps);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('service-role-secret');
  });
  it('devuelve una ruta con su línea completa y 404 si no existe', async () => {
    const row = rows(1)[0];
    const deps = mock(); deps.routeById = vi.fn().mockResolvedValue(row);
    const response = await handleRouteSources(request(one), deps);
    expect(response.status).toBe(200);
    expect(detailResponseSchema.parse((await response.json()).data).line).toEqual(row.line);
    expect(deps.routeById).toHaveBeenCalledWith(one.id);
    const missing = mock(); missing.routeById = vi.fn().mockResolvedValue(null);
    expect((await handleRouteSources(request(one), missing)).status).toBe(404);
  });
});

describe('findLibraryCatalog y findLibraryRoute', () => {
  const rows = [squareRow(1, { km: 60 })];
  const catalog = buildLibraryCatalog({ lat: 40, lon: -3, radiusM: 50_000 }, rows);
  it('envía el centro normalizado y valida la respuesta', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { data: JSON.parse(JSON.stringify(catalog)) }, error: null });
    expect(await findLibraryCatalog({ lat: 40.00011, lon: -3.00011, radiusM: 49_500 }, { invoke })).toEqual(catalog);
    expect(invoke).toHaveBeenCalledWith('route-sources', { body: { source: 'library', kind: 'library-list', lat: 40, lon: -3, radiusM: 50_000 }, signal: undefined });
    await expect(findLibraryCatalog({ lat: 40, lon: -3, radiusM: 50_000 }, { invoke: vi.fn().mockResolvedValue({ data: { data: { total: 'x' } }, error: null }) })).rejects.toThrow('invalid_response');
    await expect(findLibraryCatalog({ lat: 40, lon: -3, radiusM: 50_000 }, { invoke: vi.fn().mockResolvedValue({ data: null, error: new Error('x') }) })).rejects.toThrow('unavailable');
  });
  it('pide una ruta por id y la devuelve validada', async () => {
    const detail = toLibraryDetail(rows[0]);
    const invoke = vi.fn().mockResolvedValue({ data: { data: JSON.parse(JSON.stringify(detail)) }, error: null });
    expect(await findLibraryRoute('00000000-0000-4000-8000-000000000001', { invoke })).toEqual(detail);
    expect(invoke).toHaveBeenCalledWith('route-sources', { body: { source: 'library', kind: 'library-route', id: '00000000-0000-4000-8000-000000000001' }, signal: undefined });
    const gone = Object.assign(new Error('x'), { context: new Response('', { status: 404 }) });
    await expect(findLibraryRoute(detail.id, { invoke: vi.fn().mockResolvedValue({ data: null, error: gone }) })).rejects.toThrow('not_found');
  });
});
