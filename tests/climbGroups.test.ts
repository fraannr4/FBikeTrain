import {
  CLIMB_INDEX_CELL_M,
  SAME_CLIMB_MAX_M,
  groupClimbs,
  sameClimb,
} from '../src/metrics/climbGroups';
import type { ClimbEffort, LatLng } from '../src/domain/types';
import { EARTH_RADIUS_M, haversineM } from '../src/import/summary';

const M_PER_DEG_LAT = 111_320;
const O: LatLng = { lat: 41.0, lng: 2.5 };
/** Final de la subida de referencia: 2 km al norte de O. */
const LENGTH_M = 2000;
const DAY_MS = 86_400_000;
const T0 = Date.UTC(2026, 0, 4, 8);

/** Punto desplazado `northM` metros al norte y `eastM` al este de `p`. */
function offset(p: LatLng, northM: number, eastM = 0): LatLng {
  return {
    lat: p.lat + northM / M_PER_DEG_LAT,
    lng: p.lng + eastM / (M_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180)),
  };
}

type EffortOpts = {
  activityId: string;
  n?: number;
  day?: number;
  start?: LatLng;
  end?: LatLng;
  startDistM?: number;
  timeS?: number;
};

function effort({
  activityId,
  n = 0,
  day = 0,
  start = O,
  end = offset(start, LENGTH_M),
  startDistM = 1000,
  timeS = 600,
}: EffortOpts): ClimbEffort {
  return {
    id: `${activityId}_${n}`,
    activityId,
    activityStart: T0 + day * DAY_MS,
    startIdx: 0,
    endIdx: 100,
    start,
    end,
    startDistM,
    lengthM: LENGTH_M,
    gainM: 100,
    avgGradePct: 5,
    timeS,
    avgSpeedMs: LENGTH_M / timeS,
    vamMh: 100 / (timeS / 3600),
  };
}

const END = offset(O, LENGTH_M);

describe('sameClimb', () => {
  it('needs both start and end within the limit', () => {
    const near = SAME_CLIMB_MAX_M - 10;
    const far = SAME_CLIMB_MAX_M + 10;
    expect(sameClimb({ start: O, end: END }, { start: offset(O, near), end: offset(END, near) })).toBe(true);
    expect(sameClimb({ start: O, end: END }, { start: offset(O, far), end: END })).toBe(false);
    expect(sameClimb({ start: O, end: END }, { start: O, end: offset(END, 0, far) })).toBe(false);
  });

  it('the limit itself is not close enough', () => {
    // Desplazamiento en grados con el mismo radio que haversineM, para medir justo en el límite.
    const degFor = (m: number) => (m / EARTH_RADIUS_M) * (180 / Math.PI);
    const at = (m: number) => ({ lat: O.lat + degFor(m), lng: O.lng });
    const a = { start: O, end: END };
    expect(haversineM(O.lat, O.lng, at(SAME_CLIMB_MAX_M).lat, O.lng)).toBeCloseTo(SAME_CLIMB_MAX_M, 6);
    expect(sameClimb(a, { start: at(SAME_CLIMB_MAX_M), end: END })).toBe(false);
    expect(sameClimb(a, { start: at(SAME_CLIMB_MAX_M - 0.01), end: END })).toBe(true);
  });
});

describe('groupClimbs', () => {
  it('same climb within 100 m groups', () => {
    const a = effort({ activityId: 'a' });
    const b = effort({
      activityId: 'b',
      day: 1,
      start: offset(O, SAME_CLIMB_MAX_M - 40),
      end: offset(END, SAME_CLIMB_MAX_M - 20),
    });
    const groups = groupClimbs([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].efforts.map((e) => e.id)).toEqual(['a_0', 'b_0']);
  });

  it('120 m away is a different climb', () => {
    const a = effort({ activityId: 'a' });
    const b = effort({
      activityId: 'b',
      day: 1,
      start: offset(O, SAME_CLIMB_MAX_M + 20),
      end: offset(END, SAME_CLIMB_MAX_M + 20),
    });
    expect(groupClimbs([a, b])).toHaveLength(2);
  });

  it('matching end only is not enough', () => {
    const a = effort({ activityId: 'a' });
    const b = effort({ activityId: 'b', day: 1, start: offset(O, -300), end: END });
    expect(groupClimbs([a, b])).toHaveLength(2);
  });

  it('two passes in one ride count as two', () => {
    const first = effort({ activityId: 'a', n: 0, startDistM: 1000 });
    const second = effort({ activityId: 'a', n: 1, startDistM: 15000 });
    const groups = groupClimbs([second, first]);
    expect(groups).toHaveLength(1);
    expect(groups[0].efforts.map((e) => e.id)).toEqual(['a_0', 'a_1']);
  });

  it('best is the fastest', () => {
    const groups = groupClimbs([
      effort({ activityId: 'a', day: 0, timeS: 700 }),
      effort({ activityId: 'b', day: 1, timeS: 540 }),
      effort({ activityId: 'c', day: 2, timeS: 620 }),
    ]);
    expect(groups[0].best.id).toBe('b_0');
  });

  it('group id is the earliest effort id', () => {
    const late = effort({ activityId: 'late', day: 5, start: offset(O, 30), end: offset(END, 30) });
    const early = effort({ activityId: 'early', day: 1 });
    const groups = groupClimbs([late, early]);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('early_0');
    expect(groups[0].start).toEqual(early.start);
    expect(groups[0].end).toEqual(early.end);
    expect(groups[0].lengthM).toBe(early.lengthM);
    expect(groups[0].avgGradePct).toBe(early.avgGradePct);
    expect(groups[0].efforts.map((e) => e.id)).toEqual(['early_0', 'late_0']);
  });

  it('sorted by number of passes', () => {
    const other = offset(O, 0, 5000);
    const groups = groupClimbs([
      effort({ activityId: 'x', day: 9, start: other }),
      effort({ activityId: 'a', day: 0 }),
      effort({ activityId: 'b', day: 1 }),
      effort({ activityId: 'c', day: 2 }),
    ]);
    expect(groups.map((g) => g.efforts.length)).toEqual([3, 1]);
  });

  it('ties in passes go by the latest pass, most recent first', () => {
    const other = offset(O, 0, 5000);
    const groups = groupClimbs([
      effort({ activityId: 'a', day: 0 }),
      effort({ activityId: 'x', day: 3, start: other }),
      effort({ activityId: 'b', day: 4 }),
      effort({ activityId: 'y', day: 7, start: other }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['x_0', 'a_0']);
  });

  it('empty input gives no groups', () => {
    expect(groupClimbs([])).toEqual([]);
  });

  it('a single effort is a group of one', () => {
    const only = effort({ activityId: 'a' });
    const groups = groupClimbs([only]);
    expect(groups).toHaveLength(1);
    expect(groups[0].efforts).toEqual([only]);
    expect(groups[0].best).toBe(only);
  });

  it('starts on either side of an index cell boundary still group', () => {
    // Fila y columna donde empieza una celda del índice, y dos inicios a 30 m a cada lado.
    const row = Math.ceil((O.lat * M_PER_DEG_LAT) / CLIMB_INDEX_CELL_M);
    const corner: LatLng = { lat: (row * CLIMB_INDEX_CELL_M) / M_PER_DEG_LAT, lng: O.lng };
    const half = (SAME_CLIMB_MAX_M - 40) / 2;
    const s1 = offset(corner, -half, -half);
    const s2 = offset(corner, half, half);
    const groups = groupClimbs([
      effort({ activityId: 'a', start: s1, end: offset(s1, LENGTH_M) }),
      effort({ activityId: 'b', day: 1, start: s2, end: offset(s2, LENGTH_M) }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('far from the meridian, close starts in adjacent rows still group', () => {
    const east: LatLng = { lat: 41.0, lng: 170 };
    const row = Math.ceil((east.lat * M_PER_DEG_LAT) / CLIMB_INDEX_CELL_M);
    const edge: LatLng = { lat: (row * CLIMB_INDEX_CELL_M) / M_PER_DEG_LAT, lng: east.lng };
    const s1 = offset(edge, -20);
    const s2 = offset(edge, 20);
    const groups = groupClimbs([
      effort({ activityId: 'a', start: s1, end: offset(s1, LENGTH_M) }),
      effort({ activityId: 'b', day: 1, start: s2, end: offset(s2, LENGTH_M) }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('does not mutate its input', () => {
    const input = [effort({ activityId: 'b', day: 1 }), effort({ activityId: 'a', day: 0 })];
    const copy = structuredClone(input);
    groupClimbs(input);
    expect(input).toEqual(copy);
  });
});
