import { describe, expect, it } from 'vitest';
import { RwgpsError, parseRwgpsRouteId, rwgpsRouteToLibraryInput } from '../src/routes/sources/ridewithgps';

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
