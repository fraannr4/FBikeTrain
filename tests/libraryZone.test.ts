import { describe, expect, it } from 'vitest';
import { haversineM } from '../src/import/summary';
import {
  DEFAULT_ZONE_FACTOR,
  MIN_FACTOR_PERIMETER_M,
  MIN_FACTOR_ROUTES,
  polygonFactor,
  typicalClimb,
  zoneFactor,
  ZONE_FACTOR_RANGE,
} from '../src/routes/library/zone';

const LAT0 = 40;
const LNG0 = -3;
const M_PER_DEG_LAT = 111_320;

/** Hexágono regular de radio `radiusM` alrededor del inicio sintético, cerrado (7 vértices). */
function hexagon(radiusM: number) {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);
  return Array.from({ length: 7 }, (_, i) => {
    const a = ((i % 6) * Math.PI) / 3;
    return { lat: LAT0 + (radiusM * Math.sin(a)) / M_PER_DEG_LAT, lng: LNG0 + (radiusM * Math.cos(a)) / mPerDegLng };
  });
}

function lengthM(line: { lat: number; lng: number }[]): number {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += haversineM(line[i - 1].lat, line[i - 1].lng, line[i].lat, line[i].lng);
  return d;
}

const HEX = hexagon(5000);
const PERIMETER = lengthM(HEX);
const loopWithFactor = (f: number) => ({ line: HEX, distanceM: f * PERIMETER, loop: true });

describe('constantes de la spec', () => {
  it('factor por defecto 1,7, mínimo 5 rutas, rango 1,2-2,5 y perímetro mínimo 1 km', () => {
    expect(DEFAULT_ZONE_FACTOR).toBe(1.7);
    expect(MIN_FACTOR_ROUTES).toBe(5);
    expect(ZONE_FACTOR_RANGE).toEqual({ min: 1.2, max: 2.5 });
    expect(MIN_FACTOR_PERIMETER_M).toBe(1000);
  });
});

describe('polygonFactor', () => {
  it('un hexágono recorrido por sus vértices da 1', () => {
    expect(polygonFactor(HEX, PERIMETER)).toBeCloseTo(1, 2);
  });

  it('con una distancia 1,75 veces el perímetro da 1,75', () => {
    expect(polygonFactor(HEX, 1.75 * PERIMETER)).toBeCloseTo(1.75, 2);
  });

  it('con un perímetro por debajo de MIN_FACTOR_PERIMETER_M da null', () => {
    const small = hexagon(800 / 6);
    expect(lengthM(small)).toBeLessThan(MIN_FACTOR_PERIMETER_M);
    expect(polygonFactor(small, 800)).toBeNull();
  });

  it('una ida y vuelta por la misma recta (polígono diminuto) da null', () => {
    const line = [
      { lat: LAT0, lng: LNG0 },
      { lat: LAT0 + 0.003, lng: LNG0 },
      { lat: LAT0, lng: LNG0 },
    ];
    expect(polygonFactor(line, 700)).toBeNull();
  });

  it('una línea vacía o de un punto da null', () => {
    expect(polygonFactor([], 1000)).toBeNull();
    expect(polygonFactor([{ lat: LAT0, lng: LNG0 }], 1000)).toBeNull();
  });
});

describe('zoneFactor', () => {
  it('con menos de MIN_FACTOR_ROUTES circulares usa el factor por defecto', () => {
    const routes = Array.from({ length: MIN_FACTOR_ROUTES - 1 }, () => loopWithFactor(1.4));
    expect(zoneFactor(routes)).toEqual({ factor: DEFAULT_ZONE_FACTOR, samples: MIN_FACTOR_ROUTES - 1 });
  });

  it('con 5 circulares da la mediana de sus factores', () => {
    const r = zoneFactor([1.4, 1.6, 1.75, 1.9, 2.0].map(loopWithFactor));
    expect(r.samples).toBe(5);
    expect(r.factor).toBeCloseTo(1.75, 2);
  });

  it('una ruta no circular no cuenta', () => {
    const routes = [...[1.4, 1.6, 1.75, 1.9].map(loopWithFactor), { ...loopWithFactor(2.0), loop: false }];
    expect(zoneFactor(routes)).toEqual({ factor: DEFAULT_ZONE_FACTOR, samples: 4 });
  });

  it('una circular con perímetro diminuto no cuenta', () => {
    const tiny = { line: hexagon(50), distanceM: 2000, loop: true };
    const routes = [...[1.4, 1.6, 1.75, 1.9].map(loopWithFactor), tiny];
    expect(zoneFactor(routes).samples).toBe(4);
  });

  it('acota el factor al rango de la zona', () => {
    const high = Array.from({ length: 5 }, () => loopWithFactor(3.0));
    expect(zoneFactor(high).factor).toBe(ZONE_FACTOR_RANGE.max);
    const low = Array.from({ length: 5 }, () => loopWithFactor(1.0));
    expect(zoneFactor(low).factor).toBe(ZONE_FACTOR_RANGE.min);
  });

  it('sin rutas usa el factor por defecto con 0 muestras', () => {
    expect(zoneFactor([])).toEqual({ factor: DEFAULT_ZONE_FACTOR, samples: 0 });
  });
});

describe('typicalClimb', () => {
  it('da la mediana de m/km e ignora las rutas sin desnivel', () => {
    const r = typicalClimb([
      { distanceM: 50_000, elevGainM: 500 }, // 10
      { distanceM: 40_000, elevGainM: 800 }, // 20
      { distanceM: 60_000, elevGainM: null },
      { distanceM: 30_000, elevGainM: 450 }, // 15
    ]);
    expect(r).toBeCloseTo(15, 6);
  });

  it('con un número par de rutas da la media de las dos centrales', () => {
    expect(typicalClimb([
      { distanceM: 10_000, elevGainM: 100 },
      { distanceM: 10_000, elevGainM: 300 },
    ])).toBeCloseTo(20, 6);
  });

  it('sin ninguna ruta con desnivel da null', () => {
    expect(typicalClimb([{ distanceM: 50_000, elevGainM: null }])).toBeNull();
    expect(typicalClimb([])).toBeNull();
  });
});
