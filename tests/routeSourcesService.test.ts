import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { handleRouteSources, CACHE_TTL_MS, sourceCacheKey, type RouteSourceDependencies } from '../src/routes/sources/service';
import { sourceTransport, wikilocSearchUrl } from '../src/routes/sources/providers';
import { parseOverpass } from '../src/routes/sources/overpass';
import { routeReferenceSchema } from '../src/routes/sources/schema';
import { findLibrary } from '../src/routes/sources/client';
import { libraryZoneSchema, encodeLibraryZone, normalizeLibrarySearch } from '../src/routes/library/schema';
import { buildLibraryZone, circleBox } from '../src/routes/library/zoneResponse';
import { routeDetailJson, searchHit, searchJson, squareRow } from './fixtures/libraryZone';

const fixture = (name: string) => readFileSync(resolve('tests/fixtures/route-sources', name), 'utf8');
const search = { lat: 0, lon: 0, radiusM: 2000 };
const at = '2026-11-09T12:00:00.000Z';
const now = Date.parse(at);
const template = 'https://es.wikiloc.com/public-search?lat={lat}&lon={lon}&radius={radiusM}'; // URL ficticia, no endpoint real.
const user = { id: '10000000-0000-4000-8000-000000000001', isAnonymous: false };
const request = (body: unknown = { ...search, source: 'osm' }, headers = {}) => new Request('https://app.test/route-sources', { method: 'POST', headers: { authorization: 'Bearer session', 'content-type': 'application/json', origin: 'https://app.test', ...headers }, body: JSON.stringify(body) });
const mock = (): RouteSourceDependencies => ({
  enabled: true, wikilocAuthorized: false, wikilocSearchTemplate: template, allowedOrigins: ['https://app.test'],
  authenticate: vi.fn().mockResolvedValue(user), consumeQuota: vi.fn().mockResolvedValue({ allowed: true, retryAfterS: 0 }),
  readCache: vi.fn().mockResolvedValue(null), writeCache: vi.fn().mockResolvedValue(undefined),
  claim: vi.fn().mockResolvedValue(true), fetch: vi.fn().mockImplementation(async () => new Response(fixture('overpass.json'))), now: () => now,
  routesInBox: vi.fn().mockResolvedValue([]), heatCellsInBox: vi.fn().mockResolvedValue([]), replaceHeatCells: vi.fn().mockResolvedValue(undefined),
  upsertRoutes: vi.fn().mockImplementation(async (rows: unknown[]) => rows.length),
  rwgpsRouteDetail: vi.fn().mockImplementation(async (id: number) => ({ status: 200, json: routeDetailJson(id) })),
  lastRwgpsSyncAt: vi.fn().mockResolvedValue(new Date(now)), requestRwgpsSync: vi.fn(),
});
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('route-sources HTTP y caché', () => {
  it('exige sesión real antes de acceder a caché/proveedores', async () => {
    const deps = mock(); deps.authenticate = vi.fn().mockResolvedValue(null);
    expect((await handleRouteSources(request(), deps)).status).toBe(401);
    expect(deps.readCache).not.toHaveBeenCalled(); expect(deps.fetch).not.toHaveBeenCalled();
    expect((await handleRouteSources(request(undefined, { authorization: '' }), mock())).status).toBe(401);
  });
  it.each([{ ...search, radiusM: -1 }, { ...search, source: 'arbitrary' }, { ...search, url: 'https://evil.invalid' }, { ...search, track: [] }, { ...search, lat: 91 }])('rechaza parámetros extra o fuera de límites', async input => {
    const deps = mock(); expect((await handleRouteSources(request(input), deps)).status).toBe(400);
    expect(deps.readCache).not.toHaveBeenCalled(); expect(deps.fetch).not.toHaveBeenCalled();
  });
  it('falla cerrado si falta autorización Wikiloc incluso con caché', async () => {
    const deps = mock();
    const response = await handleRouteSources(request({ ...search, source: 'wikiloc' }), deps);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('wikiloc_authorization_required');
    expect(deps.readCache).not.toHaveBeenCalled(); expect(deps.fetch).not.toHaveBeenCalled();
  });
  it('consulta, atribuye y escribe una caché con TTL de 7 días', async () => {
    const deps = mock(); const response = await handleRouteSources(request(), deps);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toHaveLength(1);
    const row = vi.mocked(deps.writeCache).mock.calls[0][0];
    expect(Date.parse(row.expires_at) - Date.parse(row.fetched_at)).toBe(CACHE_TTL_MS);
    expect(row.cache_key).not.toContain('2000');
    expect(deps.claim).toHaveBeenCalledWith('osm');
    expect(deps.fetch).toHaveBeenCalledWith('https://overpass-api.de/api/interpreter', expect.objectContaining({ method: 'POST', redirect: 'manual', credentials: 'omit', headers: expect.objectContaining({ 'User-Agent': expect.stringContaining('FBikeTrain') }) }));
  });
  it('reutiliza caché con timestamps Postgres consumiendo cuota pero sin tocar el proveedor ni el slot', async () => {
    const deps = mock();
    deps.readCache = vi.fn().mockResolvedValue({ payload: parseOverpass(JSON.parse(fixture('overpass.json')), search, at), fetched_at: '2026-11-09T12:00:00+00:00', expires_at: new Date(now + CACHE_TTL_MS).toISOString() });
    expect((await handleRouteSources(request(), deps)).status).toBe(200);
    expect(deps.consumeQuota).toHaveBeenCalledWith(user.id);
    expect(deps.fetch).not.toHaveBeenCalled(); expect(deps.claim).not.toHaveBeenCalled(); expect(deps.writeCache).not.toHaveBeenCalled();
  });
  it.each(['expired', 'corrupt', 'future', 'wrong-source'])('renueva caché %s', async mode => {
    const deps = mock();
    const row = { payload: mode === 'corrupt' ? [{ broken: true }] : [], fetched_at: at, expires_at: new Date(now + CACHE_TTL_MS).toISOString() };
    if (mode === 'expired') { row.fetched_at = new Date(now - CACHE_TTL_MS).toISOString(); row.expires_at = at; }
    if (mode === 'future') { row.fetched_at = new Date(now + 1).toISOString(); row.expires_at = new Date(now + 1 + CACHE_TTL_MS).toISOString(); }
    if (mode === 'wrong-source') Object.assign(row, { payload: [{ source: 'wikiloc' }] });
    deps.readCache = vi.fn().mockResolvedValue(row);
    expect((await handleRouteSources(request(), deps)).status).toBe(200);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });
  it('cachea también búsquedas vacías válidas', async () => {
    const deps = mock(); deps.fetch = vi.fn().mockResolvedValue(new Response('{"elements":[]}'));
    expect((await handleRouteSources(request(), deps)).status).toBe(200);
    expect(vi.mocked(deps.writeCache).mock.calls[0][0].payload).toEqual([]);
  });
  it('no consulta si no puede comprobar caché/límite; no filtra errores crudos', async () => {
    const deps = mock(); deps.readCache = vi.fn().mockRejectedValue(new Error('secret-service-role'));
    const result = await handleRouteSources(request(), deps);
    expect(result.status).toBe(503); expect(await result.text()).not.toContain('secret-service-role'); expect(deps.fetch).not.toHaveBeenCalled();
    deps.readCache = vi.fn().mockResolvedValue(null); deps.claim = vi.fn().mockResolvedValue(false);
    const busy = await handleRouteSources(request(), deps);
    expect(busy.status).toBe(429); expect(busy.headers.get('retry-after')).toBe('30'); expect(deps.fetch).not.toHaveBeenCalled();
  });
  it('no cachea errores, redirecciones, respuestas enormes ni JSON parcial de Overpass', async () => {
    for (const response of [new Response('', { status: 403 }), new Response('', { status: 302, headers: { Location: 'https://evil.invalid' } }), new Response('{"elements":[],"remark":"timeout"}'), new Response('x'.repeat(8_000_001))]) {
      const deps = mock(); deps.fetch = vi.fn().mockResolvedValue(response);
      expect((await handleRouteSources(request(), deps)).status).toBeGreaterThanOrEqual(500);
      expect(deps.writeCache).not.toHaveBeenCalled(); expect(deps.fetch).toHaveBeenCalledTimes(1);
    }
  });
  it('resuelve CORS, métodos, falta configuración y límite de cuerpo', async () => {
    expect((await handleRouteSources(request(undefined, { origin: 'https://evil.invalid' }), mock())).status).toBe(403);
    const preflight = await handleRouteSources(new Request('https://app.test', { method: 'OPTIONS', headers: { origin: 'https://app.test' } }), mock());
    expect(preflight.status).toBe(204); expect(preflight.headers.get('access-control-allow-origin')).toBe('https://app.test');
    expect((await handleRouteSources(new Request('https://app.test'), mock())).status).toBe(405);
    expect((await handleRouteSources(request(), { ...mock(), enabled: false })).status).toBe(503);
    expect((await handleRouteSources(request({ junk: 'x'.repeat(3000) }), mock())).status).toBe(400);
  });
  it('propaga cancelación sin consultar y acota la espera de red', async () => {
    const controller = new AbortController(); controller.abort(); const deps = mock();
    const req = request(); Object.defineProperty(req, 'signal', { value: controller.signal });
    expect((await handleRouteSources(req, deps)).status).toBe(499); expect(deps.fetch).not.toHaveBeenCalled();
  });
  it('respeta cancelación durante lectura de caché y timeout del proveedor', async () => {
    const deps = mock(); const controller = new AbortController();
    const req = request(); Object.defineProperty(req, 'signal', { value: controller.signal });
    deps.readCache = async () => { controller.abort(); return { payload: [], fetched_at: at, expires_at: new Date(now + CACHE_TTL_MS).toISOString() }; };
    expect((await handleRouteSources(req, deps)).status).toBe(499); expect(deps.fetch).not.toHaveBeenCalled();
    vi.useFakeTimers();
    const slow = mock(); slow.fetch = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('provider-secret')))));
    const pending = handleRouteSources(request(), slow);
    await vi.waitFor(() => expect(slow.fetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(30_000);
    const response = await pending;
    expect(response.status).toBe(504); expect(await response.text()).not.toContain('provider-secret'); expect(slow.writeCache).not.toHaveBeenCalled();
  });
  it('separa claves por fuente/radio y valida URLs malformadas sin lanzar TypeError', async () => {
    expect(await sourceCacheKey('osm', search)).not.toBe(await sourceCacheKey('wikiloc', search));
    expect(await sourceCacheKey('osm', search)).toBe(await sourceCacheKey('osm', { ...search, radiusM: 2001 }));
    expect(await sourceCacheKey('osm', search)).not.toBe(await sourceCacheKey('osm', { ...search, radiusM: 5001 }));
    expect(routeReferenceSchema.safeParse({ source: 'osm', url: 'not-url', author: 'Test', name: 'Test', distanceM: 10, ascentM: null, fetchedAt: at }).success).toBe(false);
  });
});

describe('normalización, geometría persistida y cuota por cuenta', () => {
  it('cuantiza antes de cachear y consultar, agrupando puntos y radios próximos', async () => {
    const deps = mock(); const raw = { lat: 40.12341, lon: -3.12341, radiusM: 5001, source: 'osm' };
    deps.fetch = vi.fn().mockResolvedValue(new Response('{"elements":[]}'));
    expect((await handleRouteSources(request(raw), deps)).status).toBe(200);
    const key = await sourceCacheKey('osm', { lat: 40.12349, lon: -3.12349, radiusM: 9999 });
    expect(deps.readCache).toHaveBeenCalledWith(key);
    expect(vi.mocked(deps.writeCache).mock.calls[0][0].cache_key).toBe(key);
    const body = vi.mocked(deps.fetch).mock.calls[0][1]!.body as URLSearchParams;
    expect(body.get('data')).toContain('around:10000,40.123,-3.123');
    expect(body.get('data')).not.toContain('40.12341');
    const wiki = mock(); wiki.wikilocAuthorized = true;
    wiki.fetch = vi.fn().mockResolvedValue(new Response('<main id="no-results">No hay rutas</main>'));
    await handleRouteSources(request({ ...raw, source: 'wikiloc' }), wiki);
    expect(vi.mocked(wiki.fetch).mock.calls[0][0]).toBe('https://es.wikiloc.com/public-search?lat=40.123&lon=-3.123&radius=10000');
  });
  it('guarda y devuelve como máximo 2000 puntos por ruta sin cambiar distancia ni procedencia', async () => {
    const deps = mock(); const payload = JSON.parse(fixture('overpass.json'));
    payload.elements.find((e: { id: number }) => e.id === 1).geometry = Array.from({ length: 6000 }, (_, i) => ({ lat: Math.sin(i / 10) / 10000, lon: i / 100000 }));
    deps.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    const response = await handleRouteSources(request(), deps);
    expect(response.status).toBe(200);
    const result = (await response.json()).data;
    expect(vi.mocked(deps.writeCache).mock.calls[0][0].payload).toEqual(result);
    expect(result[0].geometry.coordinates.reduce((n: number, line: unknown[]) => n + line.length, 0)).toBeLessThanOrEqual(2000);
    expect(result[0].geometry.coordinates).toHaveLength(2);
    expect(result[0].author).toContain('OpenStreetMap');
    expect(result[0].distanceM).toBe(parseOverpass(payload, { ...search, radiusM: 5000 }, at)[0].distanceM);
  });
  it('rechaza sesiones anónimas antes de cuota, caché o slot', async () => {
    const deps = mock(); deps.authenticate = vi.fn().mockResolvedValue({ ...user, isAnonymous: true });
    expect((await handleRouteSources(request(), deps)).status).toBe(401);
    expect(deps.consumeQuota).not.toHaveBeenCalled(); expect(deps.readCache).not.toHaveBeenCalled(); expect(deps.claim).not.toHaveBeenCalled();
  });
  it('consume por user.id antes de caché y slot global', async () => {
    const deps = mock(); const order: string[] = [];
    deps.consumeQuota = vi.fn().mockImplementation(async () => { order.push('quota'); return { allowed: true, retryAfterS: 0 }; });
    deps.readCache = async () => { order.push('cache'); return null; };
    deps.claim = async () => { order.push('slot'); return true; };
    expect((await handleRouteSources(request(), deps)).status).toBe(200);
    expect(deps.consumeQuota).toHaveBeenCalledWith(user.id); expect(order).toEqual(['quota', 'cache', 'slot']);
  });
  it('rechaza cuota agotada también con caché disponible y falla cerrado ante error SQL', async () => {
    const deps = mock(); deps.consumeQuota = vi.fn().mockResolvedValue({ allowed: false, retryAfterS: 17 });
    deps.readCache = vi.fn().mockResolvedValue({ payload: [], fetched_at: at, expires_at: new Date(now + CACHE_TTL_MS).toISOString() });
    const response = await handleRouteSources(request(), deps);
    expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('17');
    expect(await response.text()).toContain('quota_exceeded');
    expect(deps.readCache).not.toHaveBeenCalled(); expect(deps.claim).not.toHaveBeenCalled(); expect(deps.fetch).not.toHaveBeenCalled();
    deps.consumeQuota = vi.fn().mockRejectedValue(new Error('service-role-secret'));
    const error = await handleRouteSources(request(), deps);
    expect(error.status).toBe(503); expect(await error.text()).not.toContain('service-role-secret');
    expect(deps.claim).not.toHaveBeenCalled(); expect(deps.fetch).not.toHaveBeenCalled();
  });
});

describe('transporte conservador Wikiloc', () => {
  it('espacia cada petición al menos un segundo y reclama el límite global para cada una', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () => new Response('ok'));
    const claim = vi.fn().mockResolvedValue(true);
    const transport = sourceTransport('wikiloc', { fetch: fetchMock, claim, signal: new AbortController().signal });
    await transport('https://es.wikiloc.com/public-test');
    const pending = transport('https://es.wikiloc.com/public-test');
    await vi.advanceTimersByTimeAsync(999); expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(51); await pending; expect(fetchMock).toHaveBeenCalledTimes(2); expect(claim).toHaveBeenCalledTimes(2);
  });
  it('rechaza hosts externos y plantillas sin región antes de solicitar nada', async () => {
    const deps = mock(); const transport = sourceTransport('wikiloc', { ...deps, signal: new AbortController().signal });
    await expect(transport('https://evil.invalid/a')).rejects.toThrow('blocked');
    expect(() => wikilocSearchUrl('https://es.wikiloc.com/search', search)).toThrow('unavailable');
    expect(() => wikilocSearchUrl('https://evil.invalid/?lat={lat}&lon={lon}&r={radiusM}', search)).toThrow('unavailable');
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it('devuelve HTML cambiado y captcha controlados sin cachearlos', async () => {
    for (const html of [fixture('wikiloc-blocked.html'), '<html>Nuevo formato</html>']) {
      const deps = mock(); deps.wikilocAuthorized = true; deps.fetch = vi.fn().mockResolvedValue(new Response(html));
      const response = await handleRouteSources(request({ ...search, source: 'wikiloc' }), deps);
      expect(response.status).toBe(502); expect(deps.writeCache).not.toHaveBeenCalled();
    }
  });
  it('mantiene metadatos si el enlace GPX público devuelve login', async () => {
    // La integración de tres peticiones reales se prueba con reloj simulado, nunca contra Wikiloc.
    vi.useFakeTimers();
    const deps = mock(); deps.wikilocAuthorized = true;
    deps.fetch = vi.fn().mockResolvedValueOnce(new Response(fixture('wikiloc-search.html'))).mockResolvedValueOnce(new Response(fixture('wikiloc-detail.html'))).mockResolvedValueOnce(new Response('<html>Login requerido</html>'));
    const result = handleRouteSources(request({ ...search, source: 'wikiloc' }), deps);
    // crypto.subtle utiliza el hilo de Node y necesita completar antes de avanzar el reloj.
    await vi.waitFor(() => expect(deps.fetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(2200);
    const response = await result;
    expect(response.status).toBe(200); expect((await response.json()).data[0].geometry).toBeUndefined();
    expect(deps.fetch).toHaveBeenCalledTimes(3);
  });
  it('no cachea una primera ficha bloqueada como resultado vacío', async () => {
    vi.useFakeTimers();
    const deps = mock(); deps.wikilocAuthorized = true;
    deps.fetch = vi.fn().mockResolvedValueOnce(new Response(fixture('wikiloc-search.html'))).mockResolvedValueOnce(new Response('', { status: 403 }));
    const pending = handleRouteSources(request({ ...search, source: 'wikiloc' }), deps);
    await vi.waitFor(() => expect(deps.fetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1100);
    expect((await pending).status).toBe(502); expect(deps.writeCache).not.toHaveBeenCalled(); expect(deps.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('route-sources: operaciones retiradas', () => {
  it.each(['passes', 'waypoints'])('kind %s ya no existe: 400 sin gastar cuota ni consultar', async kind => {
    const deps = mock();
    expect((await handleRouteSources(request({ lat: 0, lon: 0, radiusM: 30_000, source: 'osm', kind }), deps)).status).toBe(400);
    expect(deps.consumeQuota).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});

describe('route-sources: biblioteca común (kind library)', () => {
  const lib = { source: 'library', kind: 'library', lat: 40.0123, lon: -3.0234, radiusM: 20_000, distanceKm: 60, elevGainM: null };
  const normalized = normalizeLibrarySearch({ lat: lib.lat, lon: lib.lon, radiusM: lib.radiusM, distanceKm: lib.distanceKm, elevGainM: null });
  const rows = (n: number) => Array.from({ length: n }, (_, i) => squareRow(i + 1, { km: 50 + i }));
  const sparse = () => {
    const deps = mock();
    deps.routesInBox = vi.fn().mockResolvedValueOnce(rows(3)).mockResolvedValue(rows(5));
    deps.fetch = vi.fn().mockImplementation(async () => Response.json(searchJson([searchHit(901), searchHit(902)])));
    return deps;
  };
  const respond = async (deps: RouteSourceDependencies) => {
    vi.useFakeTimers();
    const pending = handleRouteSources(request(lib), deps);
    let done = false;
    void pending.then(() => { done = true; });
    // crypto.subtle termina en el hilo de Node: se avanza el reloj a pasos hasta que llega la respuesta.
    await vi.waitFor(async () => { await vi.advanceTimersByTimeAsync(200); if (!done) throw new Error('pendiente'); }, { timeout: 10_000, interval: 5 });
    const response = await pending;
    return { status: response.status, zone: libraryZoneSchema.parse((await response.json()).data) };
  };

  it.each([[null], [new Date(now - 7 * 3600_000)]])('con la sincronización de Ride with GPS pendiente (%s) la pide a la función rwgps una vez', async last => {
    const deps = mock(); deps.routesInBox = vi.fn().mockResolvedValue(rows(20));
    deps.lastRwgpsSyncAt = vi.fn().mockResolvedValue(last);
    expect((await respond(deps)).status).toBe(200);
    expect(deps.requestRwgpsSync).toHaveBeenCalledTimes(1);
  });

  it('con la sincronización reciente no pide nada', async () => {
    const deps = mock(); deps.routesInBox = vi.fn().mockResolvedValue(rows(20));
    deps.lastRwgpsSyncAt = vi.fn().mockResolvedValue(new Date(now - 3600_000));
    expect((await respond(deps)).status).toBe(200);
    expect(deps.requestRwgpsSync).not.toHaveBeenCalled();
  });

  it('un fallo al comprobar o pedir la sincronización no rompe la respuesta', async () => {
    const deps = mock(); deps.routesInBox = vi.fn().mockResolvedValue(rows(20));
    deps.lastRwgpsSyncAt = vi.fn().mockRejectedValue(new Error('db secreto'));
    expect((await respond(deps)).status).toBe(200);
    expect(deps.requestRwgpsSync).not.toHaveBeenCalled();
    const other = mock(); other.routesInBox = vi.fn().mockResolvedValue(rows(20));
    other.lastRwgpsSyncAt = vi.fn().mockResolvedValue(null);
    other.requestRwgpsSync = vi.fn(() => { throw new Error('boom'); });
    expect((await respond(other)).status).toBe(200);
  });

  it('rechaza radios de más de 40 km y sesiones anónimas antes de leer nada', async () => {
    const deps = mock();
    expect((await handleRouteSources(request({ ...lib, radiusM: 50_000 }), deps)).status).toBe(400);
    deps.authenticate = vi.fn().mockResolvedValue({ ...user, isAnonymous: true });
    expect((await handleRouteSources(request(lib), deps)).status).toBe(401);
    expect(deps.routesInBox).not.toHaveBeenCalled(); expect(deps.consumeQuota).not.toHaveBeenCalled();
  });

  it('una zona con 20 rutas responde sin buscar en Ride with GPS ni leer la marca', async () => {
    const deps = mock(); deps.routesInBox = vi.fn().mockResolvedValue(rows(20));
    const { status, zone } = await respond(deps);
    expect(status).toBe(200);
    expect(zone).toMatchObject({ routeCount: 20, fill: 'none' });
    expect(deps.consumeQuota).toHaveBeenCalledWith(user.id);
    expect(deps.routesInBox).toHaveBeenCalledWith(circleBox(normalized.lat, normalized.lon, normalized.radiusM));
    expect(deps.fetch).not.toHaveBeenCalled(); expect(deps.readCache).not.toHaveBeenCalled(); expect(deps.rwgpsRouteDetail).not.toHaveBeenCalled();
  });

  it('una zona con 3 rutas y sin marca se llena una vez, guarda la marca y recalcula el calor de su caja', async () => {
    const deps = sparse();
    const { status, zone } = await respond(deps);
    expect(status).toBe(200);
    expect(zone).toMatchObject({ routeCount: 5, fill: 'imported' });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(deps.fetch).mock.calls[0][0])).toMatch(/^https:\/\/ridewithgps\.com\/find\/search\.json\?/);
    expect(vi.mocked(deps.fetch).mock.calls[0][1]).toMatchObject({ redirect: 'manual', credentials: 'omit', headers: expect.objectContaining({ Accept: 'application/json' }) });
    expect(deps.claim).toHaveBeenCalledWith('rwgps');
    expect(deps.rwgpsRouteDetail).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.upsertRoutes).mock.calls[0][0]).toHaveLength(2);
    const mark = vi.mocked(deps.writeCache).mock.calls[0][0];
    expect(mark).toMatchObject({ source: 'rwgps', payload: [901, 902] });
    expect(mark.cache_key.startsWith('v1:rwgps-fill:')).toBe(true);
    expect(Date.parse(mark.expires_at) - Date.parse(mark.fetched_at)).toBe(CACHE_TTL_MS);
    const box = circleBox(normalized.lat, normalized.lon, normalized.radiusM);
    expect(vi.mocked(deps.replaceHeatCells).mock.calls[0][1]).toEqual(box);
    expect(vi.mocked(deps.replaceHeatCells).mock.calls[0][0].length).toBeGreaterThan(0);
    for (const c of vi.mocked(deps.replaceHeatCells).mock.calls[0][0]) {
      expect(c.lat).toBeGreaterThanOrEqual(box.minLat); expect(c.lat).toBeLessThanOrEqual(box.maxLat);
      expect(c.lng).toBeGreaterThanOrEqual(box.minLng); expect(c.lng).toBeLessThanOrEqual(box.maxLng);
    }
  });

  it('con la marca de zona ya llenada no vuelve a buscar', async () => {
    const deps = sparse();
    deps.readCache = vi.fn().mockResolvedValue({ payload: [901], fetched_at: at, expires_at: new Date(now + CACHE_TTL_MS).toISOString() });
    const { zone } = await respond(deps);
    expect(zone).toMatchObject({ routeCount: 3, fill: 'none' });
    expect(vi.mocked(deps.readCache).mock.calls[0][0].startsWith('v1:rwgps-fill:')).toBe(true);
    expect(deps.fetch).not.toHaveBeenCalled(); expect(deps.writeCache).not.toHaveBeenCalled();
  });

  it('sin resultados en Ride with GPS deja la marca y avisa con nothing-found', async () => {
    const deps = sparse(); deps.fetch = vi.fn().mockImplementation(async () => Response.json(searchJson([])));
    deps.routesInBox = vi.fn().mockResolvedValue([]);
    const { zone } = await respond(deps);
    expect(zone).toMatchObject({ routeCount: 0, routes: [], cells: [], fill: 'nothing-found' });
    expect(vi.mocked(deps.writeCache).mock.calls[0][0].payload).toEqual([]);
    expect(deps.replaceHeatCells).not.toHaveBeenCalled();
  });

  it('Ride with GPS ocupado, bloqueado o sin credenciales: 200 con lo que había y fill unavailable, sin marca', async () => {
    const setups: ((d: RouteSourceDependencies) => void)[] = [
      d => { d.fetch = vi.fn().mockResolvedValue(new Response('', { status: 429 })); },
      d => { d.fetch = vi.fn().mockResolvedValue(new Response('', { status: 403 })); },
      d => { d.claim = vi.fn().mockResolvedValue(false); },
      d => { d.rwgpsRouteDetail = vi.fn().mockResolvedValue({ status: 401, json: null }); },
    ];
    for (const setup of setups) {
      const deps = sparse(); setup(deps);
      const { status, zone } = await respond(deps);
      expect(status).toBe(200);
      expect(zone).toMatchObject({ routeCount: 3, fill: 'unavailable' });
      expect(deps.writeCache).not.toHaveBeenCalled();
      vi.useRealTimers();
    }
  });

  it('un fallo al leer la biblioteca no filtra el error crudo', async () => {
    const deps = mock(); deps.routesInBox = vi.fn().mockRejectedValue(new Error('service-role-secret'));
    const response = await handleRouteSources(request(lib), deps);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('service-role-secret');
  });
});

describe('transporte de Ride with GPS', () => {
  it('solo pide al buscador de ridewithgps.com y acepta JSON', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('{}'));
    const transport = sourceTransport('rwgps', { fetch: fetchMock, claim: vi.fn().mockResolvedValue(true), signal: new AbortController().signal });
    await expect(transport('https://evil.invalid/find/search.json?x=1')).rejects.toThrow('blocked');
    await expect(transport('https://ridewithgps.com/routes/1.json')).rejects.toThrow('blocked');
    expect(fetchMock).not.toHaveBeenCalled();
    await transport('https://ridewithgps.com/find/search.json?search%5Blat%5D=40');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: expect.objectContaining({ Accept: 'application/json' }) });
  });
});

describe('findLibrary', () => {
  const base = { lat: 40, lon: -3, radiusM: 20_000, distanceKm: 60, elevGainM: null };
  const zone = buildLibraryZone(base, [squareRow(1, { km: 60 })], [], 'none');
  it('envía la búsqueda normalizada y devuelve la zona validada', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { data: JSON.parse(JSON.stringify(encodeLibraryZone(zone))) }, error: null });
    const result = await findLibrary({ lat: 40.00011, lon: -3.00011, radiusM: 19_500, distanceKm: 60.2, elevGainM: 810 }, { invoke });
    expect(result).toEqual(zone);
    expect(invoke).toHaveBeenCalledWith('route-sources', { body: { source: 'library', kind: 'library', lat: 40, lon: -3, radiusM: 20_000, distanceKm: 60, elevGainM: 800 }, signal: undefined });
  });
  it('una respuesta que no valida es invalid_response; un error de la función, unavailable o busy', async () => {
    await expect(findLibrary(base, { invoke: vi.fn().mockResolvedValue({ data: { data: { routeCount: -1 } }, error: null }) })).rejects.toThrow('invalid_response');
    await expect(findLibrary(base, { invoke: vi.fn().mockResolvedValue({ data: null, error: new Error('x') }) })).rejects.toThrow('unavailable');
    const quota = Object.assign(new Error('x'), { context: new Response('', { status: 429 }) });
    await expect(findLibrary(base, { invoke: vi.fn().mockResolvedValue({ data: null, error: quota }) })).rejects.toThrow('busy');
  });
});
