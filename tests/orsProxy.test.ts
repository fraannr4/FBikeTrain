import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchRoundTrip, OrsError, type OrsFeature } from '../src/routes/ors';
import { chooseOrsAccess, fetchSharedRoadFeature, hasOrsAccess, sharedOrsAccess } from '../src/routes/orsProxy';
import { fetchRoadPath } from '../src/routes/roadPath';
import { handleSharedOrs } from '../src/routes/shared/orsService';

// Nunca sale a la red: `fetch` simulado con el fixture de ORS (Puerta del Sol) envuelto como lo devuelve el proxy.
const orsFixture = JSON.parse(readFileSync('tests/fixtures/ors/round-trip-ok.json', 'utf8')) as { features: OrsFeature[] };
const SOL = { lat: 40.4168, lng: -3.7038 };
const token = async () => 'session-token';
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }));
const ok = () => reply(200, { data: { features: orsFixture.features } });
const roundTrip = { operation: 'round_trip', start: SOL, lengthM: 30_000, points: 4, seed: 1 } as const;

async function errorOf(p: Promise<unknown>): Promise<OrsError> {
  try { await p; } catch (e) { if (e instanceof OrsError) return e; throw e; }
  throw new Error('no ha fallado');
}

describe('cliente del motor de rutas compartido', () => {
  it('llama a la función ors-proxy con la sesión y solo la operación, nunca la URL de ORS', async () => {
    const f = ok();
    const feature = await fetchSharedRoadFeature(token, roundTrip, undefined, f);
    expect(feature.geometry.coordinates).toHaveLength(61);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toMatch(/\/functions\/v1\/ors-proxy$/);
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer session-token');
    expect(JSON.parse(String(init!.body))).toEqual(roundTrip);
  });

  it('sin sesión no llama y pide entrar', async () => {
    const f = ok();
    const e = await errorOf(fetchSharedRoadFeature(async () => null, roundTrip, undefined, f));
    expect(e.kind).toBe('session');
    expect(f).not.toHaveBeenCalled();
  });

  it.each([
    [401, {}, 'session', /sesión/],
    [429, { retryAfterS: 7200 }, 'quota_day', /150 consultas al día/],
    [429, { retryAfterS: 30 }, 'rate_minute', /8 consultas por minuto/],
    [503, {}, 'unreachable', /no está disponible/],
    [404, {}, 'no_route', /carretera/],
    [502, {}, 'server', /motor de rutas/],
  ] as const)('HTTP %i se traduce a un error comprensible', async (status, extra, kind, text) => {
    const e = await errorOf(fetchSharedRoadFeature(token, roundTrip, undefined, reply(status, { error: { code: 'x', message: 'crudo' }, ...extra })));
    expect(e.kind).toBe(kind);
    expect(e.message).toMatch(text);
    expect(e.message).not.toContain('crudo');
  });

  it('el límite diario dice cuándo se renueva', async () => {
    const e = await errorOf(fetchSharedRoadFeature(token, roundTrip, undefined, reply(429, { retryAfterS: 2 * 3600 }, { 'Retry-After': '7200' })));
    expect(e.message).toMatch(/2 h/);
  });

  it('un fallo de red es «sin conexión», no un error inesperado', async () => {
    const f = vi.fn<typeof fetch>(async () => { throw new TypeError('Failed to fetch'); });
    expect((await errorOf(fetchSharedRoadFeature(token, roundTrip, undefined, f))).kind).toBe('unreachable');
  });

  it('respeta la cancelación', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(fetchSharedRoadFeature(token, roundTrip, controller.signal, ok())).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('fetchAll devuelve todas las alternativas del trayecto', async () => {
    const two = reply(200, { data: { features: [orsFixture.features[0], orsFixture.features[0]] } });
    const path = { operation: 'path' as const, waypoints: [SOL, { lat: 40.43, lng: -3.69 }], alternatives: 3 };
    expect(await sharedOrsAccess(token, two).fetchAll(path)).toHaveLength(2);
  });

  it('una respuesta sin trazado es «sin ruta»', async () => {
    expect((await errorOf(fetchSharedRoadFeature(token, roundTrip, undefined, reply(200, { data: { features: [] } })))).kind).toBe('no_route');
  });

  it('funciona de punta a punta contra el handler del servidor', async () => {
    const server = vi.fn<typeof fetch>(async (_url, init) => handleSharedOrs(new Request('https://example.invalid/ors-proxy', init), {
      enabled: true, allowedOrigins: [],
      authenticate: async () => 'user-1', consumeQuota: async () => ({ allowed: true, retryAfterS: 0 }),
      route: async () => ({ status: 200, json: orsFixture }),
    }));
    const feature = await fetchSharedRoadFeature(token, roundTrip, undefined, server);
    expect(feature.properties.summary.distance).toBe(29943.1);
    expect(feature.properties.extras.waytypes.summary.length).toBeGreaterThan(0);
  });
});

describe('selector de modo', () => {
  const account = { client: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } }, error: null }) } } as unknown as SupabaseClient };

  it('con cuenta y el modo compartido activado va por el servidor', () => {
    const access = chooseOrsAccess('', account, true);
    expect(typeof access).toBe('object');
    expect(hasOrsAccess(access)).toBe(true);
  });
  it('sin cuenta, o con el modo apagado, usa la clave personal', () => {
    expect(chooseOrsAccess('mi-clave', null, true)).toBe('mi-clave');
    expect(chooseOrsAccess('mi-clave', account, false)).toBe('mi-clave');
    expect(hasOrsAccess(chooseOrsAccess('  ', account, false))).toBe(false);
  });
  it('el modo sale de VITE_SHARED_ORS_ENABLED', () => {
    vi.stubEnv('VITE_SHARED_ORS_ENABLED', 'true');
    try { expect(typeof chooseOrsAccess('', account)).toBe('object'); } finally { vi.unstubAllEnvs(); }
    expect(chooseOrsAccess('', account)).toBe('');
  });
  it('el token de la sesión viaja en la petición', async () => {
    const f = ok();
    vi.stubGlobal('fetch', f);
    try {
      await fetchRoundTrip(chooseOrsAccess('', account, true), { start: SOL, lengthM: 30_000, points: 4, seed: 1 });
    } finally { vi.unstubAllGlobals(); }
    expect(new Headers(f.mock.calls[0][1]!.headers).get('authorization')).toBe('Bearer jwt');
  });
});

describe('las funciones de rutas aceptan el acceso compartido', () => {
  it('la vuelta circular va por el proxy y no a ORS', async () => {
    const f = ok();
    await fetchRoundTrip(sharedOrsAccess(token, f), { start: SOL, lengthM: 30_000, points: 4, seed: 1 });
    expect(String(f.mock.calls[0][0])).toMatch(/ors-proxy$/);
    expect(JSON.parse(String(f.mock.calls[0][1]!.body))).toEqual(roundTrip);
  });
  it('una conexión por carretera no pide clave personal en modo compartido', async () => {
    const coords = orsFixture.features[0].geometry.coordinates;
    const a = { lat: coords[0][1], lng: coords[0][0] };
    const b = { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] };
    const f = ok();
    const points = await fetchRoadPath(sharedOrsAccess(token, f), [a, b]);
    expect(points.length).toBe(61);
    expect(JSON.parse(String(f.mock.calls[0][1]!.body))).toEqual({ operation: 'path', waypoints: [a, b] });
    await expect(fetchRoadPath('', [a, b], undefined, f)).rejects.toThrow(/clave/);
  });
});
