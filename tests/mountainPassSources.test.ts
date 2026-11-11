import { webcrypto } from 'node:crypto';
import { buildPassQuery, normalizePassSearch, parsePasses } from '../src/routes/sources/passes';
import { findMountainPasses, type RouteSourceInvoker } from '../src/routes/sources/client';
import { CACHE_TTL_MS, handleRouteSources, sourceCacheKey, type RouteSourceDependencies } from '../src/routes/sources/service';

// Entirely synthetic: public-road-shaped fixtures in the sea, not actual tracks.
const search = { lat: 0, lon: 0, radiusM: 40_000 };
const at = '2026-11-11T12:00:00.000Z';
const pass = (id = 1, overrides = {}) => ({ type: 'node', id, lat: 0.2, lon: 0, tags: { mountain_pass: 'yes', name: 'Collado inventado', ele: '450' }, ...overrides });
const road = (overrides = {}) => ({ type: 'way', id: 2, nodes: [3, 1, 4], tags: { highway: 'secondary', surface: 'asphalt' }, geometry: [{ lat: 0.19, lon: 0 }, { lat: 0.2, lon: 0 }, { lat: 0.21, lon: 0 }], ...overrides });
const payload = (elements = [pass(), road()]) => ({ elements });
const request = (body: unknown = { ...search, source: 'osm', kind: 'passes' }, signal?: AbortSignal) => {
  const req = new Request('https://app.test/route-sources', {
    method: 'POST', headers: { authorization: 'Bearer session', 'content-type': 'application/json', origin: 'https://app.test' }, body: JSON.stringify(body),
  });
  // Request is Node's fetch, whereas jsdom owns AbortController in these tests.
  if (signal) Object.defineProperty(req, 'signal', { value: signal });
  return req;
};
const dependencies = (): RouteSourceDependencies => ({
  enabled: true, wikilocAuthorized: false, wikilocSearchTemplate: '', allowedOrigins: ['https://app.test'],
  authenticate: vi.fn().mockResolvedValue({ id: '10000000-0000-4000-8000-000000000001', isAnonymous: false }),
  consumeQuota: vi.fn().mockResolvedValue({ allowed: true, retryAfterS: 0 }),
  readCache: vi.fn().mockResolvedValue(null), writeCache: vi.fn().mockResolvedValue(undefined),
  claim: vi.fn().mockResolvedValue(true), fetch: vi.fn().mockImplementation(async () => Response.json(payload())), now: () => Date.parse(at),
});
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('puertos en carretera de Overpass', () => {
  it('consulta mountain_pass y saddle con nombre y ele, y sus carreteras', () => {
    const query = buildPassQuery(search);
    expect(query).toContain('[mountain_pass=yes][name][ele]');
    expect(query).toContain('[natural=saddle][name][ele]');
    expect(query).toContain('way(around.passes:120)');
    expect(query).toContain('[bbox:-0.3593,-0.3593,0.3593,0.3593]');
    expect(query).not.toContain('node(around:');
    expect(normalizePassSearch({ lat: 0.0004, lon: 0.0004, radiusM: 37_001 })).toEqual(search);
  });

  it('devuelve cota y puntos reales a ambos lados solo si pertenece a carretera', () => {
    const [found] = parsePasses(payload(), search);
    expect(found).toMatchObject({ id: 'osm-pass-1', name: 'Collado inventado', ele: 450, lat: 0.2, lng: 0,
      approach: { lat: 0.19, lng: 0 }, departure: { lat: 0.21, lng: 0 } });
    expect(found.distanceM).toBeGreaterThan(15_000);
    expect(found.distanceM).toBeLessThan(40_000);
  });

  it('un saddle fuera de la carretera no es un puerto ciclista', () => {
    expect(parsePasses(payload([pass(1, { tags: { natural: 'saddle', name: 'Collado', ele: '450' } })]), search)).toEqual([]);
    // Carretera a unos 220 m del collado: demasiado lejos para atribuirle el puerto.
    const far = [{ lat: 0.19, lon: 0.002 }, { lat: 0.2, lon: 0.002 }, { lat: 0.21, lon: 0.002 }];
    expect(parsePasses(payload([pass(), road({ nodes: [7, 8, 9], geometry: far })]), search)).toEqual([]);
  });

  it('un puerto cartografiado junto a la vía usa el vértice de la carretera más próximo', () => {
    const near = [{ lat: 0.19, lon: 0.0005 }, { lat: 0.2, lon: 0.0005 }, { lat: 0.21, lon: 0.0005 }];
    const [found] = parsePasses(payload([pass(), road({ nodes: [7, 8, 9], geometry: near })]), search);
    expect(found).toMatchObject({ name: 'Collado inventado', lat: 0.2, lng: 0.0005, approach: { lat: 0.19, lng: 0.0005 }, departure: { lat: 0.21, lng: 0.0005 } });
  });

  it.each([
    { tags: { mountain_pass: 'yes', ele: '450' } },
    { tags: { mountain_pass: 'yes', name: 'Collado' } },
    { tags: { mountain_pass: 'yes', name: 'Collado', ele: 'unknown' } },
    { lat: 0.01 }, { lat: 0.5 },
  ])('descarta sin nombre/cota o fuera del anillo', overrides => {
    expect(parsePasses(payload([pass(1, overrides), road()]), search)).toEqual([]);
  });

  it.each([{ highway: 'path' }, { highway: 'trunk' }, { highway: 'secondary', bicycle: 'no' }, { highway: 'secondary', access: 'private' }, { highway: 'secondary', surface: 'gravel' }])('descarta carreteras no aptas', tags => {
    expect(parsePasses(payload([pass(), road({ tags })]), search)).toEqual([]);
  });

  it('rechaza respuestas parciales o inválidas y limita a diez puertos', () => {
    expect(() => parsePasses({ ...payload(), remark: 'timeout' }, search)).toThrow();
    expect(() => parsePasses({}, search)).toThrow();
    const elements = Array.from({ length: 12 }, (_, i) => [pass(i + 1), road({ id: i + 100, nodes: [50, i + 1, 51] })]).flat();
    expect(parsePasses(payload(elements), search)).toHaveLength(10);
  });
});

describe('puertos: HTTP, caché y cliente', () => {
  it('usa autenticación y cuota antes del proveedor; 40 km solo con kind passes', async () => {
    const deps = dependencies();
    const response = await handleRouteSources(request(), deps);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toHaveLength(1);
    expect(deps.consumeQuota).toHaveBeenCalledTimes(1);
    expect(deps.claim).toHaveBeenCalledWith('osm');
    expect(vi.mocked(deps.writeCache).mock.calls[0][0].source).toBe('osm');
    expect((await handleRouteSources(request({ ...search, source: 'osm' }), dependencies())).status).toBe(400);
    expect((await handleRouteSources(request({ ...search, source: 'wikiloc', kind: 'passes' }), dependencies())).status).toBe(400);
    const denied = dependencies(); denied.authenticate = vi.fn().mockResolvedValue(null);
    expect((await handleRouteSources(request(), denied)).status).toBe(401);
    expect(denied.readCache).not.toHaveBeenCalled();
  });

  it('reutiliza caché siete días con clave distinta de rutas y consume cuota sin HTTP', async () => {
    const deps = dependencies();
    deps.readCache = vi.fn().mockResolvedValue({ payload: parsePasses(payload(), search), fetched_at: at, expires_at: new Date(Date.parse(at) + CACHE_TTL_MS).toISOString() });
    const response = await handleRouteSources(request(), deps);
    expect(response.status).toBe(200);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.consumeQuota).toHaveBeenCalledTimes(1);
    const a = await sourceCacheKey('osm', { ...search, radiusM: 20_000 });
    const b = await sourceCacheKey('osm', { ...search, radiusM: 20_000 }, 'passes');
    expect(a).not.toBe(b);
    expect(b).not.toContain('20000');
  });

  it('no consulta ni lee caché sin cuota, y respeta cancelación', async () => {
    const deps = dependencies(); deps.consumeQuota = vi.fn().mockResolvedValue({ allowed: false, retryAfterS: 60 });
    expect((await handleRouteSources(request(), deps)).status).toBe(429);
    expect(deps.readCache).not.toHaveBeenCalled(); expect(deps.fetch).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    expect((await handleRouteSources(request(undefined, controller.signal), dependencies())).status).toBe(499);
  });

  it('cliente consulta solo fuentes y propaga fallo o cancelación sin repetir', async () => {
    const invoke = vi.fn<RouteSourceInvoker['invoke']>().mockResolvedValue({ data: { data: parsePasses(payload(), search) }, error: null });
    expect(await findMountainPasses({ lat: 0, lng: 0 }, { invoke })).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith('route-sources', { body: { ...search, source: 'osm', kind: 'passes' }, signal: undefined });
    invoke.mockResolvedValue({ data: null, error: {} });
    await expect(findMountainPasses({ lat: 0, lng: 0 }, { invoke })).rejects.toThrow();
    const controller = new AbortController(); controller.abort(); invoke.mockClear();
    await expect(findMountainPasses({ lat: 0, lng: 0 }, { invoke }, controller.signal)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
