import { describe, expect, it } from 'vitest';
import { haversineM } from '../src/import/summary';
import type { HeatCellLite } from '../src/routes/library/schema';
import { buildRing, candidateRings, idealVertices, loopPerimeterM, ringRadiusM, type RingOptions } from '../src/routes/library/ring';
import { gridCells, offset, START } from './fixtures/libraryGenerator';

const normal: RingOptions = { distanceKm: 60, factor: 1.75, elevGainM: null, sparse: false, broad: false };
const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => haversineM(a.lat, a.lng, b.lat, b.lng);

describe('anillos: geometría', () => {
  it('el radio hace que el hexágono, por el factor de la zona, mida los km pedidos', () => {
    expect(ringRadiusM(60, 1.75, 5)).toBeCloseTo(5714.3, 0);
  });

  it('los vértices ideales están en el círculo que pasa por el inicio, con el centro hacia el eje', () => {
    const v = idealVertices(START, 0, 5000, 5);
    const centre = offset(START, 0, 5000);
    expect(v).toHaveLength(5);
    for (const p of v) expect(Math.abs(dist(p, centre) - 5000)).toBeLessThanOrEqual(5);
    expect(Math.abs(loopPerimeterM([START, ...v]) - 30_000)).toBeLessThanOrEqual(50);
  });
});

describe('anillos: elección de celdas', () => {
  const r = ringRadiusM(60, 1.75, 5);
  const ideal = idealVertices(START, 0, r, 5);

  it('en cada ventana elige la celda con más rutas', () => {
    const cells: HeatCellLite[] = ideal.flatMap(p => [
      { ...p, routes: 2, climbMPerKm: null },
      { ...offset(p, 300, 0), routes: 9, climbMPerKm: null },
    ]);
    const ring = buildRing(START, cells, 0, 5, normal);
    expect(ring).not.toBeNull();
    expect(ring!.waypoints.map(c => c.routes)).toEqual([9, 9, 9, 9, 9]);
  });

  it('con desnivel pedido, entre celdas de rutas parecidas, prefiere la subida más próxima a la pedida', () => {
    // 600 m en 60 km: 10 m/km.
    const cells: HeatCellLite[] = ideal.flatMap(p => [
      { ...p, routes: 6, climbMPerKm: 30 },
      { ...offset(p, 300, 0), routes: 5, climbMPerKm: 10 },
    ]);
    const ring = buildRing(START, cells, 0, 5, { ...normal, elevGainM: 600 });
    expect(ring!.waypoints.map(c => c.climbMPerKm)).toEqual([10, 10, 10, 10, 10]);
    expect(ring!.climbMPerKm).toBe(10);
  });

  it('sin celda para un vértice no hay anillo', () => {
    const cells = ideal.slice(0, 4).map(p => ({ ...p, routes: 5, climbMPerKm: null }));
    expect(buildRing(START, cells, 0, 5, normal)).toBeNull();
  });

  it('la estimación final queda a ±12 % de los km pedidos', () => {
    const cells = gridCells({ stepM: 900 });
    for (const axis of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const ring = buildRing(START, cells, axis, 5, normal);
      expect(ring).not.toBeNull();
      expect(Math.abs(ring!.estimateKm - 60) / 60).toBeLessThanOrEqual(0.12);
      expect(ring!.estimateKm).toBeCloseTo(1.75 * loopPerimeterM([START, ...ring!.waypoints]) / 1000, 6);
      for (const c of ring!.waypoints) expect(dist(c, START)).toBeGreaterThanOrEqual(1500);
    }
  });
});

describe('anillos: candidatos', () => {
  it('sin zona escasa ignora las celdas de una sola ruta; con zona escasa, las usa', () => {
    const cells = gridCells({ routes: 1 });
    expect(candidateRings(START, cells, normal)).toEqual([]);
    expect(candidateRings(START, cells, { ...normal, sparse: true }).length).toBeGreaterThan(0);
  });

  it('la pasada normal prueba 8 ejes cada 45° con k = 5', () => {
    const rings = candidateRings(START, gridCells(), normal);
    expect(rings.length).toBe(8);
    expect(new Set(rings.map(r => r.axisDeg))).toEqual(new Set([0, 45, 90, 135, 180, 225, 270, 315]));
    expect(rings.every(r => r.k === 5)).toBe(true);
  });

  it('la pasada amplia da anillos de k 4 y 6 con los ejes desplazados 22,5°', () => {
    const rings = candidateRings(START, gridCells(), { ...normal, broad: true });
    expect(rings.length).toBeGreaterThan(0);
    expect(new Set(rings.map(r => r.k))).toEqual(new Set([4, 6]));
    expect(rings.every(r => r.axisDeg % 45 === 22.5)).toBe(true);
  });

  it('con desnivel, primero los anillos cuya subida media se acerca más a la pedida', () => {
    // Al norte las celdas suben 10 m/km y al sur 30: con 600 m en 60 km gana el norte.
    const cells = gridCells().map(c => ({ ...c, climbMPerKm: c.lat > START.lat ? 10 : 30 }));
    const rings = candidateRings(START, cells, { ...normal, elevGainM: 600 });
    expect(rings[0].axisDeg).toBe(0);
    expect(rings[rings.length - 1].axisDeg).toBe(180);
  });
});
