import type { Coord3, LatLng } from '../src/domain/types';
import { referenceRange, routeName } from '../src/ui/routes/routeView';

// Inicio sintético: la Puerta del Sol (punto público), nunca «Casa».
const SOL: LatLng = { lat: 40.4168, lng: -3.7038 };
const KM_LAT = 1 / 111.32;
const KM_LNG = 1 / (111.32 * Math.cos((SOL.lat * Math.PI) / 180));

/** Lazo de radio `r` km cuyo centro está a `dx`, `dy` km del inicio. */
function loop(dxKm: number, dyKm: number, rKm = 3, n = 60): Coord3[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const x = dxKm + Math.cos(t) * rKm;
    const y = dyKm + Math.sin(t) * rKm;
    return [SOL.lng + x * KM_LNG, SOL.lat + y * KM_LAT, 600 + i];
  });
}

describe('routeName', () => {
  it('names the loop by the side of the start where it goes', () => {
    expect(routeName(loop(0, 8), SOL)).toBe('Vuelta por el norte');
    expect(routeName(loop(8, 0), SOL)).toBe('Vuelta por el este');
    expect(routeName(loop(-6, -6), SOL)).toBe('Vuelta por el suroeste');
    expect(routeName(loop(6, 6), SOL)).toBe('Vuelta por el noreste');
  });

  it('a loop around the start is a loop around it', () => {
    expect(routeName(loop(0, 0, 6), SOL)).toBe('Vuelta alrededor del inicio');
  });
});

describe('referenceRange', () => {
  it('reads the last 12 weeks of Madrid up to now, same wall-clock hour across the time change', () => {
    const now = Date.parse('2026-11-06T10:00:00Z');
    expect(referenceRange(now)).toEqual({ from: Date.parse('2026-08-14T09:00:00Z'), to: now });
  });
});
