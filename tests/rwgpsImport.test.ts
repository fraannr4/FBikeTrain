import { db } from '../src/db/db';
import { RwgpsError } from '../src/routes/sources/ridewithgps';
import { clearLegacyRwgpsCredentials } from '../src/routes/sources/rwgpsCredentials';
import { fetchRwgpsRoutes, parseRwgpsLinks } from '../src/routes/sources/rwgpsImport';

// Respuestas sintéticas de la función `rwgps`; ids, nombres y puntos inventados en el mar.
const route = (id: number, name: string) => ({
  route: { name, user: { name: 'Autora sintética' }, track_points: [{ x: 2.5, y: 41, e: 10 }, { x: 2.5, y: 41.01, e: 30 }, { x: 2.51, y: 41.01, e: 20 }] },
  id,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, extra: object = {}) => json({ error: { code, message: 'x' }, ...extra }, status);
const access = (fetchImpl: (url: string, init: RequestInit) => Promise<Response>) => ({ getToken: async () => 'sesion-sintetica', fetch: fetchImpl as unknown as typeof fetch });

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


describe('fetchRwgpsRoutes por la función compartida', () => {
  it('pide cada ruta y colección a la función con la sesión, nunca a ridewithgps.com, y sigue si una falla', async () => {
    const calls: { url: string; auth: string | null; body: { kind: string; id: string; privacyCode?: string } }[] = [];
    const result = await fetchRwgpsRoutes(
      [{ kind: 'route', id: '1', privacyCode: 'abc' }, { kind: 'collection', id: '77' }, { kind: 'route', id: '3' }],
      access(async (url, init) => {
        const body = JSON.parse(String(init.body));
        calls.push({ url, auth: new Headers(init.headers).get('authorization'), body });
        if (body.kind === 'collection') return json({ data: { collection: { name: 'Cerca de casa', routes: [{ id: 2 }, { id: 1 }] } } });
        if (body.id === '3') return fail(404, 'not_found');
        return json({ data: route(Number(body.id), `Ruta sintética ${body.id}`) });
      }),
    );
    expect(result.routes.map((r) => [r.id, r.name, r.sourceUrl])).toEqual([
      ['1', 'Ruta sintética 1', 'https://ridewithgps.com/routes/1?privacy_code=abc'],
      ['2', 'Ruta sintética 2', 'https://ridewithgps.com/routes/2'],
    ]);
    expect(result.failed).toEqual([{ ref: 'Ruta 3', message: 'No existe en Ride with GPS.' }]);
    expect(calls.every((c) => /\/functions\/v1\/rwgps$/.test(c.url) && c.auth === 'Bearer sesion-sintetica')).toBe(true);
    expect(calls[0].body).toEqual({ kind: 'collection', id: '77' });
    expect(calls[1].body).toEqual({ kind: 'route', id: '1' });
  });

  it('sin sesión no llama', async () => {
    const f = vi.fn();
    await expect(fetchRwgpsRoutes([{ kind: 'route', id: '1' }], { getToken: async () => null, fetch: f })).rejects.toThrow(/sesión/);
    expect(f).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'unauthorized', /sesión/],
    [429, 'quota_exceeded', /300 rutas al día/],
    [429, 'provider_busy', /espera unos minutos/],
    [503, 'unavailable', /no está disponible/],
    [404, 'NOT_FOUND', /no está disponible/],
  ])('un %i %s corta el lote entero', async (status, code, text) => {
    let n = 0;
    const promise = fetchRwgpsRoutes([{ kind: 'route', id: '1' }, { kind: 'route', id: '2' }], access(async () => { n++; return fail(status, code, { retryAfterS: 7200 }); }));
    await expect(promise).rejects.toThrow(text);
    await expect(promise).rejects.toBeInstanceOf(RwgpsError);
    expect(n).toBe(1);
  });

  it('una ruta privada no para las demás', async () => {
    const result = await fetchRwgpsRoutes([{ kind: 'route', id: '1' }, { kind: 'route', id: '2' }], access(async (_u, init) => {
      const body = JSON.parse(String(init.body));
      return body.id === '1' ? fail(403, 'not_visible') : json({ data: route(2, 'Pública') });
    }));
    expect(result.routes.map((r) => r.id)).toEqual(['2']);
    expect(result.failed[0].message).toMatch(/No es pública/);
  });
});

describe('credenciales antiguas de Ride with GPS', () => {
  it('se borran del navegador', async () => {
    await db.meta.put({ key: 'rwgps:credentials', value: { apiKey: 'k', authToken: 't' } });
    await clearLegacyRwgpsCredentials();
    expect(await db.meta.get('rwgps:credentials')).toBeUndefined();
  });
});
