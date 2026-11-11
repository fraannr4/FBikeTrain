import { describe, expect, it, vi } from 'vitest';
import { RwgpsError, fetchRwgpsRoute, parseRwgpsRouteId, rwgpsRouteToLibraryInput } from '../src/routes/sources/ridewithgps';

// Fixture sintético con la forma documentada en /api/v1/doc/endpoints/routes y reference/track_points.
const fixture = {
  route: {
    id: 1234,
    name: 'Ruta sintética',
    user: { name: 'Autor Ficticio' },
    track_points: [
      { x: 2.0, y: 41.0, d: 0, e: 100, S: 1, R: 2 },
      { x: 2.0, y: 41.01, d: 1112, e: 150 },
      { x: 2.0, y: 41.02, d: 2224, e: 130 },
    ],
  },
};

describe('parseRwgpsRouteId', () => {
  it('lee id y privacy_code de URLs de ruta', () => {
    expect(parseRwgpsRouteId('https://ridewithgps.com/routes/1234')).toEqual({ id: '1234' });
    expect(parseRwgpsRouteId('https://ridewithgps.com/routes/1234?privacy_code=abc')).toEqual({ id: '1234', privacyCode: 'abc' });
    expect(parseRwgpsRouteId('https://www.ridewithgps.com/routes/99-nombre')).toEqual({ id: '99' });
  });
  it('rechaza otros dominios y rutas que no son de ruta', () => {
    expect(parseRwgpsRouteId('https://evil.com/routes/1234')).toBeNull();
    expect(parseRwgpsRouteId('https://ridewithgps.com/trips/1234')).toBeNull();
    expect(parseRwgpsRouteId('nada')).toBeNull();
  });
});

describe('rwgpsRouteToLibraryInput', () => {
  it('convierte track_points en puntos y calcula cifras', () => {
    const r = rwgpsRouteToLibraryInput(fixture, 'https://ridewithgps.com/routes/1234');
    expect(r.name).toBe('Ruta sintética');
    expect(r.author).toBe('Autor Ficticio');
    expect(r.sourceUrl).toBe('https://ridewithgps.com/routes/1234');
    expect(r.points[1]).toEqual({ lat: 41.01, lng: 2.0, ele: 150 });
    expect(r.distanceM).toBeGreaterThan(2200);
    expect(r.distanceM).toBeLessThan(2250);
    expect(r.elevGainM).toBe(50);
  });
  it('rechaza respuestas sin track o con coordenadas inválidas', () => {
    expect(() => rwgpsRouteToLibraryInput({ route: { id: 1, name: 'x' } }, 'u')).toThrow(RwgpsError);
    expect(() => rwgpsRouteToLibraryInput({ route: { id: 1, name: 'x', track_points: [{ x: 0, y: 0 }, { x: 500, y: 0 }] } }, 'u')).toThrow(RwgpsError);
  });
});

describe('fetchRwgpsRoute', () => {
  const creds = { apiKey: 'k', authToken: 't' };
  it('llama solo a /api/v1 con las cabeceras documentadas', async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }));
    const r = await fetchRwgpsRoute('https://ridewithgps.com/routes/1234?privacy_code=abc', creds, f);
    expect(r.points).toHaveLength(3);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://ridewithgps.com/api/v1/routes/1234.json?privacy_code=abc');
    expect(init.headers['x-rwgps-api-key']).toBe('k');
    expect(init.headers['x-rwgps-auth-token']).toBe('t');
  });
  it('traduce 401, 403, 404 y 429 a errores comprensibles', async () => {
    for (const [status, text] of [[401, /clave|token/i], [403, /visible|permiso/i], [404, /no existe/i], [429, /límite|espera/i]] as const) {
      const f = vi.fn().mockResolvedValue(new Response('{}', { status }));
      await expect(fetchRwgpsRoute('https://ridewithgps.com/routes/1', creds, f)).rejects.toThrow(text);
    }
  });
  it('pide credenciales y una URL válida', async () => {
    const f = vi.fn();
    await expect(fetchRwgpsRoute('https://ridewithgps.com/routes/1', { apiKey: '', authToken: '' }, f)).rejects.toThrow(RwgpsError);
    await expect(fetchRwgpsRoute('https://otro.com/routes/1', creds, f)).rejects.toThrow(RwgpsError);
    expect(f).not.toHaveBeenCalled();
  });
});
