import {
  cellKey,
  groupRoutes,
  ROUTE_CELL_M,
  routeCells,
  routeSimilarity,
  SAME_ROUTE_MAX_DIST_DIFF,
  SAME_ROUTE_MIN_SIMILARITY,
} from '../src/metrics/routes';
import type { LatLng, RouteSig, TrackPoint } from '../src/domain/types';
import { synthPath } from './helpers/synth';

const M_PER_DEG_LAT = 111_320;
const SIDE_M = 5000;
const O: LatLng = { lat: 41.0, lng: 2.5 };
const dLat = SIDE_M / M_PER_DEG_LAT;
const dLng = SIDE_M / (M_PER_DEG_LAT * Math.cos((O.lat * Math.PI) / 180));

/** Cuadrado de 5 km de lado desde O: norte, este, sur, oeste. */
const LOOP: LatLng[] = [
  O,
  { lat: O.lat + dLat, lng: O.lng },
  { lat: O.lat + dLat, lng: O.lng + dLng },
  { lat: O.lat, lng: O.lng + dLng },
  O,
];
/** El mismo cuadrado hacia el oeste: solo comparte el lado norte que sale de O. */
const MIRRORED: LatLng[] = [
  O,
  { lat: O.lat + dLat, lng: O.lng },
  { lat: O.lat + dLat, lng: O.lng - dLng },
  { lat: O.lat, lng: O.lng - dLng },
  O,
];

const DAY_MS = 86_400_000;
const T0 = Date.UTC(2026, 0, 4, 8, 0, 0);

function sig(activityId: string, day: number, points: TrackPoint[], distanceM = 4 * SIDE_M): RouteSig {
  return { activityId, activityStart: T0 + day * DAY_MS, distanceM, cells: routeCells(points) };
}

describe('cellKey', () => {
  it('row and col follow the cell size', () => {
    const lat = 41.0;
    const row = Math.floor((lat * M_PER_DEG_LAT) / ROUTE_CELL_M);
    const rowCenterLat = ((row + 0.5) * ROUTE_CELL_M) / M_PER_DEG_LAT;
    const col = Math.floor((2.5 * M_PER_DEG_LAT * Math.cos((rowCenterLat * Math.PI) / 180)) / ROUTE_CELL_M);
    expect(cellKey(lat, 2.5)).toBe(`${row}:${col}`);
  });

  it('points 50 m apart inside one cell share the key, 250 m apart do not', () => {
    const base = cellKey(41.0, 2.5);
    const row = Number(base.split(':')[0]);
    const cellSouthLat = (row * ROUTE_CELL_M) / M_PER_DEG_LAT;
    const inside = cellSouthLat + 10 / M_PER_DEG_LAT;
    expect(cellKey(inside, 2.5)).toBe(cellKey(inside + 50 / M_PER_DEG_LAT, 2.5));
    expect(cellKey(inside, 2.5)).not.toBe(cellKey(inside + 250 / M_PER_DEG_LAT, 2.5));
  });

  it('accepts another cell size', () => {
    const lat = 41.0;
    const row = Math.floor((lat * M_PER_DEG_LAT) / 1000);
    expect(cellKey(lat, 2.5, 1000).startsWith(`${row}:`)).toBe(true);
  });
});

describe('routeCells', () => {
  it('has no repeated cells', () => {
    const cells = routeCells(synthPath(LOOP));
    expect(new Set(cells).size).toBe(cells.length);
    // 4 lados de 5 km en celdas de 200 m: unas 100 celdas.
    expect(cells.length).toBeGreaterThan(90);
    expect(cells.length).toBeLessThan(115);
  });

  it('ignores points without position (ride without GPS)', () => {
    const indoor: TrackPoint[] = [{ t: T0 }, { t: T0 + 1000, ele: 100 }];
    expect(routeCells(indoor)).toEqual([]);
    expect(routeCells([])).toEqual([]);
  });
});

describe('routeSimilarity', () => {
  it('same loop with 10 m gps offset is same route', () => {
    const a = synthPath(LOOP);
    const b = synthPath(LOOP, { offsetM: 10, startTime: T0 + DAY_MS });
    expect(routeSimilarity(routeCells(a), routeCells(b))).toBeGreaterThanOrEqual(0.8);
    const groups = groupRoutes([sig('a', 0, a), sig('b', 1, b)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].activityIds).toHaveLength(2);
  });

  it('reverse direction is same route', () => {
    const forward = routeCells(synthPath(LOOP));
    const reverse = routeCells(synthPath([...LOOP].reverse()));
    expect(routeSimilarity(forward, reverse)).toBe(1);
  });

  it('mirrored loop sharing one side is different', () => {
    const a = routeCells(synthPath(LOOP));
    const b = routeCells(synthPath(MIRRORED));
    expect(routeSimilarity(a, b)).toBeLessThan(SAME_ROUTE_MIN_SIMILARITY);
    expect(routeSimilarity(a, b)).toBeGreaterThan(0);
  });

  it('two empty sets are 0, not NaN', () => {
    expect(routeSimilarity([], [])).toBe(0);
  });

  it('is jaccard', () => {
    expect(routeSimilarity(['a', 'b', 'c'], ['b', 'c', 'd'])).toBeCloseTo(2 / 4);
    expect(routeSimilarity(['a'], [])).toBe(0);
  });
});

describe('groupRoutes', () => {
  it('distance 25 % longer is different', () => {
    const cells = routeCells(synthPath(LOOP));
    const a: RouteSig = { activityId: 'a', activityStart: T0, distanceM: 40_000, cells };
    const b: RouteSig = { activityId: 'b', activityStart: T0 + DAY_MS, distanceM: 50_000, cells };
    expect(groupRoutes([a, b])).toEqual([]);
  });

  it('distance exactly at the allowed difference is still the same route', () => {
    const cells = routeCells(synthPath(LOOP));
    const a: RouteSig = { activityId: 'a', activityStart: T0, distanceM: 40_000, cells };
    const b: RouteSig = {
      activityId: 'b',
      activityStart: T0 + DAY_MS,
      distanceM: 40_000 * (1 + SAME_ROUTE_MAX_DIST_DIFF),
      cells,
    };
    expect(groupRoutes([a, b])).toEqual([{ id: 'a', activityIds: ['a', 'b'] }]);
  });

  it('single rides are not groups', () => {
    const north: LatLng[] = LOOP.map((p) => ({ lat: p.lat + 3 * dLat, lng: p.lng }));
    const sigs = [sig('a', 0, synthPath(LOOP)), sig('b', 1, synthPath(MIRRORED)), sig('c', 2, synthPath(north))];
    expect(groupRoutes(sigs)).toEqual([]);
  });

  it('a single ride gives no groups', () => {
    expect(groupRoutes([sig('a', 0, synthPath(LOOP))])).toEqual([]);
    expect(groupRoutes([])).toEqual([]);
  });

  it('empty cells never match', () => {
    const a: RouteSig = { activityId: 'a', activityStart: T0, distanceM: 30_000, cells: [] };
    const b: RouteSig = { activityId: 'b', activityStart: T0 + DAY_MS, distanceM: 30_000, cells: [] };
    expect(groupRoutes([a, b])).toEqual([]);
  });

  it('group id is the earliest ride and ids go by start, whatever the input order', () => {
    const loop = (id: string, day: number, offsetM: number) =>
      sig(id, day, synthPath(LOOP, { offsetM }), 4 * SIDE_M + offsetM);
    const groups = groupRoutes([loop('late', 9, 5), loop('first', 1, 0), loop('mid', 4, 10)]);
    expect(groups).toEqual([{ id: 'first', activityIds: ['first', 'mid', 'late'] }]);
  });

  it('sorted by number of rides', () => {
    const mirrored = (id: string, day: number) => sig(id, day, synthPath(MIRRORED));
    const loop = (id: string, day: number) => sig(id, day, synthPath(LOOP));
    const groups = groupRoutes([mirrored('m1', 0), mirrored('m2', 1), loop('l1', 2), loop('l2', 3), loop('l3', 4)]);
    expect(groups.map((g) => g.activityIds.length)).toEqual([3, 2]);
    expect(groups[0].id).toBe('l1');
    expect(groups[1].id).toBe('m1');
  });
});
