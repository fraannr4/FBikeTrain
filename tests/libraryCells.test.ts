import { describe, expect, it } from 'vitest';
import { cellKey, ROUTE_CELL_M } from '../src/metrics/routes';
import { MAX_TRACK_GAP_M } from '../src/metrics/grid';
import { haversineM } from '../src/import/summary';
import { passDistanceM as rwgpsPassDistanceM } from '../src/routes/sources/rwgpsService';
import {
  cellOverlap,
  densify,
  lineCells,
  OVERLAP_LIMIT,
  passDistanceM,
  type LinePoint,
} from '../src/routes/library/cells';

// Inicio sintético, en el centro de una fila de la rejilla para que una recta este-oeste no
// toque la fila vecina.
const ROW = Math.floor((40 * 111_320) / ROUTE_CELL_M);
const LAT0 = ((ROW + 0.5) * ROUTE_CELL_M) / 111_320;
const LNG0 = -3;
const M_PER_DEG_LAT = 111_320;
const mPerDegLng = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/** Punto a `eastM` metros al este y `northM` al norte del inicio sintético. */
const at = (eastM: number, northM = 0) => ({
  lat: LAT0 + northM / M_PER_DEG_LAT,
  lng: LNG0 + eastM / mPerDegLng(LAT0),
});

describe('densify', () => {
  it('intercala puntos para que ningún tramo supere MAX_TRACK_GAP_M', () => {
    const a = at(0);
    const b = at(1000);
    const out = densify([[a.lng, a.lat], [b.lng, b.lat]]);
    expect(out.length).toBeGreaterThanOrEqual(1000 / MAX_TRACK_GAP_M + 1);
    for (let i = 1; i < out.length; i++) {
      expect(haversineM(out[i - 1][1], out[i - 1][0], out[i][1], out[i][0])).toBeLessThanOrEqual(MAX_TRACK_GAP_M + 1e-6);
    }
    expect(out[0]).toEqual([a.lng, a.lat]);
    expect(out[out.length - 1]).toEqual([b.lng, b.lat]);
  });

  it('interpola la altitud solo si la tienen los dos extremos', () => {
    const a = at(0);
    const b = at(400);
    const c = at(800);
    const out = densify([[a.lng, a.lat, 100], [b.lng, b.lat, 120], [c.lng, c.lat]], 200);
    // a, mitad de a-b, b, mitad de b-c, c
    expect(out).toHaveLength(5);
    expect(out[1][2]).toBeCloseTo(110, 6);
    expect(out[2][2]).toBe(120);
    expect(out[3]).toHaveLength(2);
    expect(out[4]).toHaveLength(2);
  });

  it('una línea vacía o de un punto se queda igual', () => {
    expect(densify([])).toEqual([]);
    const a = at(0);
    expect(densify([[a.lng, a.lat]])).toEqual([[a.lng, a.lat]]);
  });
});

describe('lineCells', () => {
  it('una recta de 1 km con solo 2 vértices pisa al menos 5 celdas (densifica)', () => {
    const cells = lineCells([at(0), at(1000)]);
    expect(cells.size).toBeGreaterThanOrEqual(1000 / ROUTE_CELL_M);
    expect(cells.has(cellKey(at(500).lat, at(500).lng))).toBe(true);
  });

  it('una línea vacía no pisa ninguna celda', () => {
    expect(lineCells([]).size).toBe(0);
  });
});

describe('cellOverlap', () => {
  const east = (km: number) => [at(0), at(km * 1000)];

  it('una vuelta que repite 3/4 de las celdas de otra da 0,75', () => {
    const a = east(4);
    const b = [at(0), at(3000), at(3000, 1000)];
    expect(cellOverlap(a, b)).toBeCloseTo(0.75, 1);
    expect(Math.abs(cellOverlap(a, b) - 0.75)).toBeLessThanOrEqual(0.05);
  });

  it('una vuelta corta contenida en una larga da 1', () => {
    expect(cellOverlap(east(1), east(5))).toBe(1);
    expect(cellOverlap(east(5), east(1))).toBe(1);
  });

  it('sin puntos da 0', () => {
    expect(cellOverlap([], east(1))).toBe(0);
    expect(cellOverlap(east(1), [])).toBe(0);
  });

  it('el límite de solape de la spec es 0,7', () => {
    expect(OVERLAP_LIMIT).toBe(0.7);
  });
});

describe('passDistanceM', () => {
  const line: LinePoint[] = [
    [at(0).lng, at(0).lat],
    [at(1000).lng, at(1000).lat, 250],
  ];

  it('mide el paso mínimo de un punto a la línea', () => {
    const p = at(500, 100);
    expect(passDistanceM(p.lat, p.lng, line)).toBeCloseTo(100, 0);
    const q = at(1300);
    expect(passDistanceM(q.lat, q.lng, line)).toBeCloseTo(300, 0);
  });

  it('da lo mismo que la fórmula de rwgpsService', () => {
    const p = at(250, -420);
    const flat = line.map(([lng, lat]) => [lng, lat] as [number, number]);
    expect(passDistanceM(p.lat, p.lng, line)).toBeCloseTo(rwgpsPassDistanceM(p.lat, p.lng, flat), 2);
  });
});
