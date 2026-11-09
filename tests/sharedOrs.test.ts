import { readFileSync } from 'node:fs';
import { buildOrsBody, handleSharedOrs, type SharedOrsDependencies } from '../src/routes/shared/orsService';

const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/ors/${name}`, 'utf8'));
const roundTrip = { operation: 'round_trip', start: { lat: 40.4168, lng: -3.7038 }, lengthM: 30_000, points: 4, seed: 1 };
const path = { operation: 'path', waypoints: [{ lat: 40.4168, lng: -3.7038 }, { lat: 40.43, lng: -3.69 }] };
const request = (body: unknown = roundTrip, token = 'test-session') => new Request('https://example.invalid/ors-proxy', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'https://example.test' }, body: JSON.stringify(body),
});
const mock = (orsStatus = 200, orsJson: unknown = fixture('round-trip-ok.json')): SharedOrsDependencies => ({
  enabled: true, allowedOrigins: ['https://example.test'],
  authenticate: vi.fn().mockResolvedValue('00000000-0000-0000-0000-000000000001'),
  consumeQuota: vi.fn().mockResolvedValue({ allowed: true, retryAfterS: 0 }),
  route: vi.fn().mockResolvedValue({ status: orsStatus, json: orsJson }),
});

describe('ORS compartido: el servidor construye la petición', () => {
  it('vuelta circular con perfil de carretera, elevación y extra_info con waycategory, para descartar autopistas', () => {
    expect(buildOrsBody(roundTrip as never)).toEqual({
      coordinates: [[-3.7038, 40.4168]], elevation: true, instructions: false,
      extra_info: ['surface', 'waytype', 'steepness', 'waycategory'],
      options: { round_trip: { length: 30_000, points: 4, seed: 1 }, avoid_features: ['ferries', 'fords', 'steps'] },
    });
  });
  it('trayecto con alternativas solo entre dos puntos', () => {
    expect(buildOrsBody({ ...path, alternatives: 2 } as never)).toMatchObject({
      coordinates: [[-3.7038, 40.4168], [-3.69, 40.43]],
      alternative_routes: { target_count: 2, weight_factor: 1.4, share_factor: 0.6 },
    });
    expect(buildOrsBody(path as never)).not.toHaveProperty('alternative_routes');
  });
  it('el trayecto pide también waycategory, para descartar autopistas en los empalmes', () => {
    expect(buildOrsBody(path as never)).toMatchObject({ extra_info: ['surface', 'waytype', 'steepness', 'waycategory'] });
  });
  it('devuelve todas las alternativas con su waycategory', async () => {
    const response = await handleSharedOrs(request({ ...path, alternatives: 3 }), mock(200, fixture('path-alternatives-ok.json')));
    const body = await response.json();
    expect(body.data.features).toHaveLength(2);
    expect(Object.keys(body.data.features[1].properties.extras).sort()).toEqual(['steepness', 'surface', 'waycategory', 'waytypes']);
  });
  it('envía al motor exactamente el cuerpo construido y cobra una consulta', async () => {
    const deps = mock();
    const response = await handleSharedOrs(request(), deps);
    expect(response.status).toBe(200);
    expect(deps.consumeQuota).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 1);
    expect(deps.route).toHaveBeenCalledWith(buildOrsBody(roundTrip as never), expect.any(AbortSignal));
  });
});

describe('ORS compartido: límites y privacidad', () => {
  it('exige sesión antes de consumir cuota o llamar al motor', async () => {
    const deps = mock();
    (deps.authenticate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect((await handleSharedOrs(request(), deps)).status).toBe(401);
    expect(deps.consumeQuota).not.toHaveBeenCalled();
    expect(deps.route).not.toHaveBeenCalled();
  });
  it.each([
    { ...roundTrip, url: 'https://example.test' },
    { ...roundTrip, options: { avoid_features: [] } },
    { ...roundTrip, profile: 'driving-car' },
    { ...roundTrip, start: { lat: 95, lng: 0 } },
    { ...roundTrip, lengthM: 900_000 },
    { ...path, waypoints: [path.waypoints[0]] },
    { ...path, waypoints: Array(9).fill(path.waypoints[0]) },
    { ...path, waypoints: [...path.waypoints, path.waypoints[0]], alternatives: 2 },
    { operation: 'matrix' },
  ])('rechaza entradas no permitidas: %j', async body => {
    const deps = mock();
    expect((await handleSharedOrs(request(body), deps)).status).toBe(400);
    expect(deps.consumeQuota).not.toHaveBeenCalled();
  });
  it('falla cerrado si el servicio no está configurado', async () => {
    const deps = { ...mock(), enabled: false };
    expect((await handleSharedOrs(request(), deps)).status).toBe(503);
    expect(deps.route).not.toHaveBeenCalled();
  });
  it('con la cuota agotada responde 429 con el tiempo de espera y no llama al motor', async () => {
    const deps = mock();
    (deps.consumeQuota as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, retryAfterS: 3600 });
    const response = await handleSharedOrs(request(), deps);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('3600');
    expect(await response.json()).toMatchObject({ error: { code: 'quota_exceeded' }, retryAfterS: 3600 });
    expect(deps.route).not.toHaveBeenCalled();
  });
  it('devuelve solo geometría, resumen y extras: sin la consulta ni metadatos de ORS', async () => {
    const response = await handleSharedOrs(request(), mock());
    const body = await response.json();
    const [feature] = body.data.features;
    expect(feature.geometry.coordinates).toHaveLength(61);
    expect(feature.properties.summary.distance).toBe(29943.1);
    expect(Object.keys(feature.properties.extras).sort()).toEqual(['steepness', 'surface', 'waycategory', 'waytypes']);
    expect(body.metadata).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('query');
  });
  it('traduce «sin ruta» de ORS sin reenviar su mensaje, que lleva las coordenadas', async () => {
    const response = await handleSharedOrs(request(), mock(404, fixture('no-route-404.json')));
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe('no_route');
    expect(text).not.toContain('40.0000000');
  });
  it.each([[500, 502], [403, 503], [429, 429]])('ORS %i se traduce a %i sin el cuerpo crudo', async (ors, status) => {
    const response = await handleSharedOrs(request(), mock(ors, { error: { code: 2099, message: 'secret-internal' } }));
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain('secret-internal');
  });
  it('una respuesta 200 sin trazado válido no se reenvía', async () => {
    const response = await handleSharedOrs(request(), mock(200, { features: [{ geometry: { coordinates: [[1, 2]] } }] }));
    expect(response.status).toBe(502);
  });
  it('no registra coordenadas ni errores del motor en la consola', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const deps = mock(); deps.route = vi.fn().mockRejectedValue(new Error('fallo -3.7038 40.4168'));
      expect((await handleSharedOrs(request(), deps)).status).toBe(502);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally { for (const spy of spies) spy.mockRestore(); }
  });
  it('rechaza un origen no permitido y responde al preflight del permitido', async () => {
    const deps = mock(); deps.allowedOrigins = ['https://other.test'];
    expect((await handleSharedOrs(request(), deps)).status).toBe(403);
    const preflight = new Request('https://example.invalid/ors-proxy', { method: 'OPTIONS', headers: { Origin: 'https://example.test' } });
    const response = await handleSharedOrs(preflight, mock());
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://example.test');
  });
  it('limita la espera del motor a 20 s', async () => {
    vi.useFakeTimers();
    try {
      const deps = mock();
      deps.route = (_, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      const pending = handleSharedOrs(request(), deps);
      await vi.advanceTimersByTimeAsync(20_001);
      expect((await pending).status).toBe(504);
    } finally { vi.useRealTimers(); }
  });
});
