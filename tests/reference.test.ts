import {
  computeReference,
  difficulty,
  EASY_BELOW_RATIO,
  HARD_ABOVE_RATIO,
  LONG_WINDOW_WEEKS,
  MIN_RIDES,
  SHORT_WINDOW_WEEKS,
  UPLIFT_WITHOUT_AVERAGE,
  upliftPct,
  type UserReference,
} from '../src/metrics/reference';
import type { StoredActivity } from '../src/domain/types';

const DAY_MS = 86_400_000;
// Viernes 6 de noviembre de 2026, 12:00 en Madrid (UTC+1, ya en horario de invierno).
const NOW = Date.parse('2026-11-06T11:00:00Z');

let seq = 0;
function ride(
  startTime: number,
  { distanceM = 40_000, elevGainM = 400, movingTimeS = 5_000, hasTrack = true } = {},
): StoredActivity {
  seq += 1;
  return {
    id: `r${seq}`,
    startTime,
    sport: 'cycling',
    totals: {
      distanceM,
      movingTimeS,
      elapsedTimeS: movingTimeS,
      elevGainM,
      avgSpeedMs: distanceM / movingTimeS,
      maxSpeedMs: 15,
    },
    hasTrack,
    source: 'gpx',
    importedAt: 0,
  };
}

const daysAgo = (d: number, opts?: Parameters<typeof ride>[1]) => ride(NOW - d * DAY_MS, opts);

function ref(avgDistanceM: number, avgElevGainM: number): UserReference {
  return {
    source: 'history',
    weeks: SHORT_WINDOW_WEEKS,
    rides: MIN_RIDES,
    ridesPerWeek: MIN_RIDES / SHORT_WINDOW_WEEKS,
    avgDistanceM,
    avgElevGainM,
    avgMovingTimeS: 7_200,
    avgSpeedMs: avgDistanceM / 7_200,
    longestDistanceM: avgDistanceM,
    maxElevGainM: avgElevGainM,
  };
}

describe('constants', () => {
  it('match the plan', () => {
    expect(MIN_RIDES).toBe(5);
    expect(SHORT_WINDOW_WEEKS).toBe(8);
    expect(LONG_WINDOW_WEEKS).toBe(12);
    expect(EASY_BELOW_RATIO).toBe(0.85);
    expect(HARD_ABOVE_RATIO).toBe(1.1);
  });
});

describe('computeReference', () => {
  it('uses 8 weeks when 5 rides in 8 weeks', () => {
    const inside = [1, 7, 20, 40, 55].map((d) => daysAgo(d));
    const outside = [70, 80].map((d) => daysAgo(d, { distanceM: 200_000 }));
    const r = computeReference([...inside, ...outside], NOW);
    expect(r?.source).toBe('history');
    expect(r?.weeks).toBe(SHORT_WINDOW_WEEKS);
    expect(r?.rides).toBe(MIN_RIDES);
    expect(r?.avgDistanceM).toBe(40_000);
  });

  it('falls back to 12 weeks', () => {
    const acts = [...[2, 10, 30].map((d) => daysAgo(d)), ...[60, 70, 80].map((d) => daysAgo(d))];
    const r = computeReference(acts, NOW);
    expect(r?.weeks).toBe(LONG_WINDOW_WEEKS);
    expect(r?.rides).toBe(6);
  });

  it('null below 5 rides in 12 weeks', () => {
    const acts = [...[2, 10, 30, 80].map((d) => daysAgo(d)), daysAgo(LONG_WINDOW_WEEKS * 7 + 1)];
    expect(computeReference(acts, NOW)).toBeNull();
  });

  it('null with no rides', () => {
    expect(computeReference([], NOW)).toBeNull();
  });

  it('null with a single ride', () => {
    expect(computeReference([daysAgo(1)], NOW)).toBeNull();
  });

  it('averages are per ride and speed is distance over moving time', () => {
    const acts = [
      daysAgo(1, { distanceM: 20_000, elevGainM: 100, movingTimeS: 3_600 }),
      daysAgo(2, { distanceM: 40_000, elevGainM: 300, movingTimeS: 5_400 }),
      daysAgo(3, { distanceM: 60_000, elevGainM: 500, movingTimeS: 9_000 }),
      daysAgo(4, { distanceM: 30_000, elevGainM: 200, movingTimeS: 3_600 }),
      daysAgo(5, { distanceM: 50_000, elevGainM: 900, movingTimeS: 7_200 }),
    ];
    const r = computeReference(acts, NOW)!;
    expect(r.avgDistanceM).toBe(40_000);
    expect(r.avgElevGainM).toBe(400);
    expect(r.avgMovingTimeS).toBe(5_760);
    expect(r.avgSpeedMs).toBeCloseTo(200_000 / 28_800, 10);
    expect(r.longestDistanceM).toBe(60_000);
    expect(r.maxElevGainM).toBe(900);
  });

  it('ridesPerWeek is rides over window weeks', () => {
    const acts = [1, 2, 3, 4, 5, 6].map((d) => daysAgo(d));
    expect(computeReference(acts, NOW)?.ridesPerWeek).toBe(6 / SHORT_WINDOW_WEEKS);
    const sparse = [...[2, 10, 30].map((d) => daysAgo(d)), ...[60, 70, 80].map((d) => daysAgo(d))];
    expect(computeReference(sparse, NOW)?.ridesPerWeek).toBe(6 / LONG_WINDOW_WEEKS);
  });

  it('counts rides without GPS', () => {
    const acts = [1, 2, 3, 4, 5].map((d) => daysAgo(d, { hasTrack: false }));
    expect(computeReference(acts, NOW)?.rides).toBe(5);
  });

  it('ignores rides after now', () => {
    const acts = [...[1, 2, 3, 4].map((d) => daysAgo(d)), ride(NOW + DAY_MS)];
    expect(computeReference(acts, NOW)).toBeNull();
  });

  it('window start is the same Madrid wall-clock time across the DST change', () => {
    // 8 semanas antes de NOW es el viernes 11 de septiembre a las 12:00 en Madrid (UTC+2),
    // es decir, 10:00Z; restar 56 × 24 h daría 11:00Z.
    const windowStart = Date.parse('2026-09-11T10:00:00Z');
    const base = [1, 2, 3, 4].map((d) => daysAgo(d));
    const atStart = ride(windowStart, { distanceM: 90_000 });
    const justBefore = ride(windowStart - 1, { distanceM: 90_000 });
    expect(computeReference([...base, atStart], NOW)?.weeks).toBe(SHORT_WINDOW_WEEKS);
    expect(computeReference([...base, justBefore], NOW)?.weeks).toBe(LONG_WINDOW_WEEKS);
  });

  it('sunday 23:30 madrid inside the window counts', () => {
    // Domingo 1 de noviembre, 23:30 en Madrid (22:30Z).
    const sunday = ride(Date.parse('2026-11-01T22:30:00Z'));
    const acts = [sunday, ...[10, 20, 30, 40].map((d) => daysAgo(d))];
    expect(computeReference(acts, NOW)?.rides).toBe(5);
  });

  it('zero moving time gives zero speed, not NaN', () => {
    const acts = [1, 2, 3, 4, 5].map((d) => daysAgo(d, { movingTimeS: 0 }));
    expect(computeReference(acts, NOW)?.avgSpeedMs).toBe(0);
  });
});

describe('difficulty', () => {
  const r = ref(50_000, 500);

  it('difficulty boundaries', () => {
    expect(difficulty({ distanceM: 42_000, elevGainM: 400 }, r)).toBe('Suave');
    // 42.500 / 50.000 = EASY_BELOW_RATIO y 55.000 / 50.000 = HARD_ABOVE_RATIO, los dos extremos de Media.
    expect(difficulty({ distanceM: 42_500, elevGainM: 0 }, r)).toBe('Media');
    expect(difficulty({ distanceM: 55_000, elevGainM: 550 }, r)).toBe('Media');
    expect(difficulty({ distanceM: 55_500, elevGainM: 0 }, r)).toBe('Dura');
    expect(difficulty({ distanceM: 40_000, elevGainM: 600 }, r)).toBe('Dura');
  });

  it('zero average elevation ignores elevation ratio', () => {
    const flat = ref(50_000, 0);
    expect(difficulty({ distanceM: 40_000, elevGainM: 300 }, flat)).toBe('Suave');
    expect(difficulty({ distanceM: 50_000, elevGainM: 300 }, flat)).toBe('Media');
  });

  it('no usable averages gives Media', () => {
    expect(difficulty({ distanceM: 40_000, elevGainM: 300 }, ref(0, 0))).toBe('Media');
  });
});

describe('upliftPct', () => {
  const r = ref(50_000, 500);

  it('upliftPct distance', () => {
    expect(upliftPct({ distanceM: 55_000, elevGainM: 0 }, r, 'distance')).toBeCloseTo(10, 10);
  });

  it('upliftPct elevation below average is negative', () => {
    expect(upliftPct({ distanceM: 0, elevGainM: 400 }, r, 'elevation')).toBeCloseTo(-20, 10);
  });

  it('UPLIFT_WITHOUT_AVERAGE when the average is zero', () => {
    expect(upliftPct({ distanceM: 50_000, elevGainM: 300 }, ref(50_000, 0), 'elevation')).toBe(
      UPLIFT_WITHOUT_AVERAGE,
    );
  });
});
