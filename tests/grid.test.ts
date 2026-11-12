import { describe, expect, it } from 'vitest';
import {
  buildCellCounts,
  buildVisitedCells,
  CELL_M,
  cellKey,
  MAX_TRACK_GAP_M,
  newRoadPct,
  ROUTE_SAMPLE_M,
} from '../src/metrics/grid';
import { ROUTE_CELL_M } from '../src/metrics/routes';
import type { Coord3, TrackPoint } from '../src/domain/types';
import { synthPath } from './helpers/synth';

const M_PER_DEG_LAT = 111_320;
const LAT_STEP = CELL_M / M_PER_DEG_LAT;
const O = { lat: 41.0, lng: 2.5 };

const parse = (key: string) => key.split(':').map(Number) as [number, number];

/** Track recto hacia el norte desde O, `lengthM` metros. */
const northTrack = (lengthM: number): TrackPoint[] =>
  synthPath([O, { lat: O.lat + lengthM / M_PER_DEG_LAT, lng: O.lng }]);

const toCoords = (pts: TrackPoint[]): Coord3[] => pts.map((p) => [p.lng!, p.lat!, p.ele ?? 0]);

describe('cellKey', () => {
  it('uses the 200 m cell of the route signature grid', () => {
    expect(CELL_M).toBe(200);
    expect(CELL_M).toBe(ROUTE_CELL_M);
  });

  it('same cell within 200 m grid', () => {
    // Centro de una fila: 50 m al norte sigue dentro de la misma celda.
    const row = Math.floor(O.lat / LAT_STEP);
    const lat = (row + 0.25) * LAT_STEP;
    expect(cellKey(lat, O.lng)).toBe(cellKey(lat + 50 / M_PER_DEG_LAT, O.lng));
    expect(cellKey(lat, O.lng)).not.toBe(cellKey(lat + 450 / M_PER_DEG_LAT, O.lng));
  });

  it('cell width corrected by latitude', () => {
    // Sin corregir, 0,003° de longitud son 334 m y a veces caerían a 2 columnas.
    for (let i = 0; i < 50; i++) {
      const lng = 10 + i * 0.0001;
      const [r1, c1] = parse(cellKey(60, lng));
      const [r2, c2] = parse(cellKey(60, lng + 0.003));
      expect(r2).toBe(r1);
      expect(c2 - c1).toBeLessThanOrEqual(1);
    }
  });
});

describe('buildVisitedCells', () => {
  it('gaps over 100 m are densified', () => {
    expect(MAX_TRACK_GAP_M).toBe(100);
    const far: TrackPoint[] = [
      { t: 0, lat: O.lat, lng: O.lng },
      { t: 1, lat: O.lat + 1000 / M_PER_DEG_LAT, lng: O.lng },
    ];
    expect(buildVisitedCells([far]).size).toBeGreaterThanOrEqual(5);
  });

  it('ignores points without GPS', () => {
    const noGps: TrackPoint[] = [{ t: 0 }, { t: 1, ele: 100 }];
    expect(buildVisitedCells([noGps]).size).toBe(0);
  });

  it('densifies across a point without GPS', () => {
    // Un punto sin GPS en medio (un túnel) no corta el track: se une con el siguiente punto con GPS.
    const tunnel: TrackPoint[] = [
      { t: 0, lat: O.lat, lng: O.lng },
      { t: 1 },
      { t: 2, lat: O.lat + 1000 / M_PER_DEG_LAT, lng: O.lng },
    ];
    expect(buildVisitedCells([tunnel]).size).toBeGreaterThanOrEqual(5);
  });

  it('merges every track', () => {
    const a = northTrack(1000);
    const b = synthPath([
      { lat: O.lat, lng: O.lng + 0.05 },
      { lat: O.lat + 1000 / M_PER_DEG_LAT, lng: O.lng + 0.05 },
    ]);
    const both = buildVisitedCells([a, b]);
    expect(both.size).toBe(buildVisitedCells([a]).size + buildVisitedCells([b]).size);
  });
});

describe('newRoadPct', () => {
  it('samples the route every 50 m', () => {
    expect(ROUTE_SAMPLE_M).toBe(50);
  });

  it('empty history gives 100 % new', () => {
    expect(newRoadPct(toCoords(northTrack(5000)), new Set())).toBe(100);
  });

  it('route over visited road gives 0 % new', () => {
    const track = northTrack(5000);
    expect(newRoadPct(toCoords(track), buildVisitedCells([track]))).toBe(0);
  });

  it('half visited gives about 50 %', () => {
    const visited = buildVisitedCells([northTrack(5000)]);
    const pct = newRoadPct(toCoords(northTrack(10_000)), visited);
    expect(pct).toBeGreaterThanOrEqual(45);
    expect(pct).toBeLessThanOrEqual(55);
  });

  it('single point route is new or known by its cell', () => {
    const one: Coord3[] = [[O.lng, O.lat, 100]];
    expect(newRoadPct(one, new Set())).toBe(100);
    expect(newRoadPct(one, new Set([cellKey(O.lat, O.lng)]))).toBe(0);
  });

  it('empty route counts as 100 % new, never NaN', () => {
    expect(newRoadPct([], new Set([cellKey(O.lat, O.lng)]))).toBe(100);
  });
});

describe('buildCellCounts', () => {
  const REPEATS = 3;
  const pass = (lat: number): TrackPoint[] => [{ t: 0, lat, lng: O.lng }, { t: 1, lat: lat + 1e-5, lng: O.lng }];

  it('counts distinct tracks per cell', () => {
    const counts = buildCellCounts(Array.from({ length: REPEATS }, () => pass(O.lat)));
    expect(counts.get(cellKey(O.lat, O.lng))?.count).toBe(REPEATS);
  });

  it('counts a track that crosses the same cell twice only once there', () => {
    const twice = [...pass(O.lat), ...pass(O.lat + 5 * LAT_STEP), ...pass(O.lat)];
    expect(buildCellCounts([twice]).get(cellKey(O.lat, O.lng))?.count).toBe(1);
  });

  it('keeps the first real point of the cell as its location and skips points without GPS', () => {
    const track: TrackPoint[] = [{ t: 0 }, { t: 1, lat: O.lat, lng: O.lng }, { t: 2, lat: O.lat + 1e-5, lng: O.lng }];
    const cell = buildCellCounts([track]).get(cellKey(O.lat, O.lng));
    expect(cell?.at).toEqual({ lat: O.lat, lng: O.lng });
    expect(buildCellCounts([[{ t: 0 }]]).size).toBe(0);
  });
});
