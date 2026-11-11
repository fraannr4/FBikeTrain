import { RwgpsError } from '../src/routes/sources/ridewithgps';
import { clearRwgpsCredentials, loadRwgpsCredentials, saveRwgpsCredentials } from '../src/routes/sources/rwgpsCredentials';
import { createRwgpsToken, fetchRwgpsRoutes, parseRwgpsLinks, RWGPS_UNAUTHORIZED } from '../src/routes/sources/rwgpsImport';

// Respuestas sintéticas de la API v1; ids, nombres y puntos inventados en el mar.
const CREDS = { apiKey: 'clave-sintetica', authToken: 'token-sintetico' };
const route = (id: number, name: string) => ({
  route: { name, user: { name: 'Autora sintética' }, track_points: [{ x: 2.5, y: 41, e: 10 }, { x: 2.5, y: 41.01, e: 30 }, { x: 2.51, y: 41.01, e: 20 }] },
  id,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('parseRwgpsLinks', () => {
  it('saca rutas y colecciones de un texto pegado, sin duplicados, y separa lo que no vale', () => {
    const text = `Mira estas:
https://ridewithgps.com/routes/123-vuelta-sintetica
https://www.ridewithgps.com/routes/456?privacy_code=abc, https://ridewithgps.com/routes/123
https://ridewithgps.com/collections/77
https://evil.example/routes/9 http://ridewithgps.com/routes/1`;
    const { links, invalid } = parseRwgpsLinks(text);
    expect(links).toEqual([
      { kind: 'route', id: '123' },
      { kind: 'route', id: '456', privacyCode: 'abc' },
      { kind: 'collection', id: '77' },
    ]);
    expect(invalid).toEqual(['Mira', 'estas:', 'https://evil.example/routes/9', 'http://ridewithgps.com/routes/1']);
  });
});

describe('createRwgpsToken', () => {
  it('envía correo y contraseña solo a la API oficial y devuelve el token', async () => {
    const fetchImpl = vi.fn(async () => json({ auth_token: { auth_token: 'token-nuevo-123' } }, 201));
    expect(await createRwgpsToken(' clave ', 'yo@example.com', 'secreta', fetchImpl as unknown as typeof fetch)).toBe('token-nuevo-123');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ridewithgps.com/api/v1/auth_tokens.json');
    expect((init.headers as Record<string, string>)['x-rwgps-api-key']).toBe('clave');
    expect(JSON.parse(String(init.body))).toEqual({ user: { email: 'yo@example.com', password: 'secreta' } });
  });
  it('explica unas credenciales malas', async () => {
    const fetchImpl = (async () => json({ error: 'no' }, 401)) as unknown as typeof fetch;
    await expect(createRwgpsToken('k', 'a@b.c', 'x', fetchImpl)).rejects.toThrow(/no acepta/);
  });
});

describe('fetchRwgpsRoutes', () => {
  it('descarga las rutas enlazadas y las de una colección, y sigue si una falla', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.endsWith('/collections/77.json')) return json({ collection: { name: 'Cerca de casa', routes: [{ id: 2 }, { id: 1 }] } });
      if (url.endsWith('/routes/3.json')) return json({ error: 'no' }, 404);
      const id = Number(/routes\/(\d+)\.json/.exec(url)![1]);
      return json(route(id, `Ruta sintética ${id}`));
    }) as unknown as typeof fetch;
    const progress: number[] = [];
    const result = await fetchRwgpsRoutes(
      [{ kind: 'route', id: '1' }, { kind: 'collection', id: '77' }, { kind: 'route', id: '3' }],
      CREDS,
      { fetch: fetchImpl, onProgress: (p) => progress.push(p.done) },
    );
    expect(result.routes.map((r) => [r.id, r.name, r.sourceUrl])).toEqual([
      ['1', 'Ruta sintética 1', 'https://ridewithgps.com/routes/1'],
      ['2', 'Ruta sintética 2', 'https://ridewithgps.com/routes/2'],
    ]);
    expect(result.failed).toEqual([{ ref: 'Ruta 3', message: 'No existe en Ride with GPS.' }]);
    expect(calls.every((u) => u.startsWith('https://ridewithgps.com/api/v1/'))).toBe(true);
    expect(progress).toEqual([0, 1, 2]);
  });
  it('un 401 corta la importación: las credenciales no valen', async () => {
    const fetchImpl = (async () => json({ error: 'no' }, 401)) as unknown as typeof fetch;
    await expect(fetchRwgpsRoutes([{ kind: 'route', id: '1' }, { kind: 'route', id: '2' }], CREDS, { fetch: fetchImpl })).rejects.toThrow(RWGPS_UNAUTHORIZED);
    await expect(fetchRwgpsRoutes([{ kind: 'collection', id: 'pinned' }], CREDS, { fetch: fetchImpl })).rejects.toBeInstanceOf(RwgpsError);
  });
});

describe('credenciales de Ride with GPS', () => {
  it('se guardan sin contraseña y se borran al desconectar', async () => {
    await clearRwgpsCredentials();
    expect(await loadRwgpsCredentials()).toBeNull();
    await saveRwgpsCredentials({ apiKey: ' k ', authToken: ' t ' });
    expect(await loadRwgpsCredentials()).toEqual({ apiKey: 'k', authToken: 't' });
    await clearRwgpsCredentials();
    expect(await loadRwgpsCredentials()).toBeNull();
  });
});
