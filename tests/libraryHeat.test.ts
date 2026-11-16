import { describe, expect, it } from 'vitest';
import { cellKey, ROUTE_CELL_M } from '../src/metrics/routes';
import { ELEVATION_HYSTERESIS_M } from '../src/import/summary';
import { buildHeatCells, type HeatCell } from '../src/routes/library/heat';
import type { LinePoint } from '../src/routes/library/cells';

const ROW = Math.floor((40 * 111_320) / ROUTE_CELL_M);
const LAT0 = ((ROW + 0.5) * ROUTE_CELL_M) / 111_320;
const LNG0 = -3;
const M_PER_DEG_LAT = 111_320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

/** Vértice a `eastM` m al este y `northM` m al norte del inicio sintético, con altitud opcional. */
const pt = (eastM: number, northM = 0, ele?: number): LinePoint =>
  ele === undefined
    ? [LNG0 + eastM / mPerDegLng, LAT0 + northM / M_PER_DEG_LAT]
    : [LNG0 + eastM / mPerDegLng, LAT0 + northM / M_PER_DEG_LAT, ele];

const cellAt = (cells: HeatCell[], eastM: number, northM = 0): HeatCell | undefined => {
  const [lng, lat] = pt(eastM, northM);
  return cells.find((c) => c.cell === cellKey(lat, lng));
};

describe('buildHeatCells', () => {
  it('tres líneas que cruzan la misma celda dan routes: 3', () => {
    const cells = buildHeatCells([
      [pt(0), pt(1000)],
      [pt(-500), pt(800)],
      [pt(500, -1000), pt(500, 1000)],
    ]);
    expect(cellAt(cells, 500)?.routes).toBe(3);
  });

  it('una línea que pasa dos veces por una celda cuenta 1 ahí', () => {
    const cells = buildHeatCells([[pt(0), pt(1000), pt(0)]]);
    expect(cellAt(cells, 500)?.routes).toBe(1);
  });

  it('el punto de la celda es un punto real de la línea, no el centro', () => {
    const cells = buildHeatCells([[pt(0), pt(1000)]]);
    const c = cellAt(cells, 500)!;
    expect(cellKey(c.lat, c.lng)).toBe(c.cell);
    expect(c.lat).toBeCloseTo(LAT0, 9);
  });

  it('una línea sin altitud deja climbMPerKm y ele en null', () => {
    const cells = buildHeatCells([[pt(0), pt(1000)]]);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.climbMPerKm).toBeNull();
      expect(c.ele).toBeNull();
    }
  });

  it('una subida sintética de 50 m en 1 km da unos 50 m/km', () => {
    const cells = buildHeatCells([[pt(0, 0, 100), pt(1000, 0, 150)]]);
    const c = cellAt(cells, 500)!;
    expect(c.climbMPerKm).not.toBeNull();
    expect(Math.abs(c.climbMPerKm! - 50)).toBeLessThanOrEqual(5);
    expect(c.ele).toBeGreaterThan(115);
    expect(c.ele).toBeLessThan(135);
  });

  it('la bajada no suma subida', () => {
    const cells = buildHeatCells([[pt(0, 0, 150), pt(1000, 0, 100)]]);
    expect(cellAt(cells, 500)?.climbMPerKm).toBe(0);
  });

  it('el ruido por debajo de la histéresis no inventa subida', () => {
    const jitter = ELEVATION_HYSTERESIS_M / 2;
    const line: LinePoint[] = Array.from({ length: 21 }, (_, i) => pt(i * 50, 0, 200 + (i % 2) * jitter));
    const cells = buildHeatCells([line]);
    for (const c of cells) expect(c.climbMPerKm).toBe(0);
  });

  it('solo los tramos con altitud cuentan para la subida de la celda', () => {
    const cells = buildHeatCells([
      [pt(0, 0, 100), pt(1000, 0, 150)],
      [pt(0), pt(1000)],
    ]);
    const c = cellAt(cells, 500)!;
    expect(c.routes).toBe(2);
    expect(Math.abs(c.climbMPerKm! - 50)).toBeLessThanOrEqual(5);
  });

  it('sin líneas no hay celdas', () => {
    expect(buildHeatCells([])).toEqual([]);
  });
});
