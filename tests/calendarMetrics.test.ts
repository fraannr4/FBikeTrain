import {
  dayRange,
  daysUntil,
  GOAL_WINDOW_WEEKS,
  goalProgress,
  localDay,
  matchWorkouts,
  periodRange,
  periodStartOf,
  volumeProgress,
} from '../src/metrics/calendar';
import type { EventGoal, PlannedWorkout, StoredActivity, VolumeGoal } from '../src/domain/types';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

let seq = 0;
function ride(
  startTime: string | number,
  { distanceM = 20_000, elevGainM = 200, movingTimeS = 3_600, hasTrack = true } = {},
): StoredActivity {
  seq += 1;
  return {
    id: `r${seq}`,
    startTime: typeof startTime === 'number' ? startTime : Date.parse(startTime),
    sport: 'cycling',
    totals: {
      distanceM,
      movingTimeS,
      elapsedTimeS: movingTimeS,
      elevGainM,
      avgSpeedMs: movingTimeS > 0 ? distanceM / movingTimeS : 0,
      maxSpeedMs: 15,
    },
    hasTrack,
    source: 'gpx',
    importedAt: 0,
  };
}

function workout(date: string, over: Partial<PlannedWorkout> = {}): PlannedWorkout {
  seq += 1;
  return { id: `w${seq}`, date, title: 'Entreno', done: false, manual: false, createdAt: 0, ...over };
}

const eventGoal = (over: Partial<EventGoal> = {}): EventGoal => ({
  kind: 'event',
  id: 'g1',
  title: 'Marcha',
  date: '2026-12-14',
  distanceM: 120_000,
  createdAt: 0,
  ...over,
});

const volumeGoal = (over: Partial<VolumeGoal> = {}): VolumeGoal => ({
  kind: 'volume',
  id: 'v1',
  title: 'Noviembre',
  period: 'month',
  start: '2026-11-01',
  distanceM: 400_000,
  createdAt: 0,
  ...over,
});

describe('localDay', () => {
  it('localDay uses madrid', () => {
    expect(localDay(Date.parse('2026-11-14T23:30:00Z'))).toBe('2026-11-15');
    expect(localDay(Date.parse('2026-07-14T22:30:00Z'))).toBe('2026-07-15');
  });

  it('sunday 23:30 madrid stays on sunday', () => {
    // Domingo 15 de noviembre, 23:30 en Madrid (UTC+1).
    expect(localDay(Date.parse('2026-11-15T22:30:00Z'))).toBe('2026-11-15');
  });
});

describe('dayRange', () => {
  it('dayRange across dst', () => {
    const { from, to } = dayRange('2026-10-25');
    expect(from).toBe(Date.parse('2026-10-24T22:00:00Z'));
    expect(to - from).toBe(25 * HOUR_MS - 1);
  });

  it('normal day lasts 24 h', () => {
    const { from, to } = dayRange('2026-11-15');
    expect(from).toBe(Date.parse('2026-11-14T23:00:00Z'));
    expect(to - from).toBe(24 * HOUR_MS - 1);
  });
});

describe('daysUntil', () => {
  it('counts madrid calendar days and is negative when past', () => {
    const now = Date.parse('2026-11-06T23:30:00Z'); // 7 de noviembre, 00:30 en Madrid
    expect(daysUntil('2026-11-07', now)).toBe(0);
    expect(daysUntil('2026-11-08', now)).toBe(1);
    expect(daysUntil('2026-11-06', now)).toBe(-1);
  });

  it('is not shifted by the dst change', () => {
    const now = Date.parse('2026-10-24T10:00:00Z');
    expect(daysUntil('2026-10-26', now)).toBe(2);
  });
});

describe('matchWorkouts', () => {
  it('matches first ride of the day', () => {
    const w = workout('2026-11-15');
    const late = ride('2026-11-15T16:00:00Z');
    const early = ride('2026-11-15T08:00:00Z');
    expect(matchWorkouts([w], [late, early])).toEqual([{ id: w.id, activityId: early.id }]);
  });

  it('ride at 00:30 madrid marks that day', () => {
    const w14 = workout('2026-11-14');
    const w15 = workout('2026-11-15');
    const r = ride('2026-11-14T23:30:00Z');
    expect(matchWorkouts([w14, w15], [r])).toEqual([{ id: w15.id, activityId: r.id }]);
  });

  it('skips manual and done workouts', () => {
    const r = ride('2026-11-15T08:00:00Z');
    const done = workout('2026-11-15', { done: true, activityId: 'x' });
    const manual = workout('2026-11-15', { manual: true });
    expect(matchWorkouts([done, manual], [r])).toEqual([]);
  });

  it('day without rides is not matched', () => {
    expect(matchWorkouts([workout('2026-11-15')], [])).toEqual([]);
  });

  it('ride without gps still marks the day', () => {
    const w = workout('2026-11-15');
    const r = ride('2026-11-15T08:00:00Z', { hasTrack: false });
    expect(matchWorkouts([w], [r])).toEqual([{ id: w.id, activityId: r.id }]);
  });
});

describe('goalProgress', () => {
  const now = Date.parse('2026-11-06T10:00:00Z');

  it('uses an 8-week window', () => {
    expect(GOAL_WINDOW_WEEKS).toBe(8);
  });

  it('longest ride in the last 8 weeks vs distance', () => {
    const inside = ride(now - (GOAL_WINDOW_WEEKS - 3) * WEEK_MS, { distanceM: 96_000 });
    const outside = ride(now - (GOAL_WINDOW_WEEKS + 2) * WEEK_MS, { distanceM: 130_000 });
    const p = goalProgress(eventGoal(), [inside, outside], now);
    expect(p.longest).toEqual({ activityId: inside.id, distanceM: 96_000, pct: 80 });
    expect(p.pct).toBe(80);
  });

  it('pct is the lower of distance and elevation', () => {
    const r = ride(now - WEEK_MS, { distanceM: 96_000, elevGainM: 1_440 });
    const p = goalProgress(eventGoal({ elevGainM: 2_000 }), [r], now);
    expect(p.longest?.pct).toBe(80);
    expect(p.mostClimb).toEqual({ activityId: r.id, elevGainM: 1_440, pct: 72 });
    expect(p.pct).toBe(72);
  });

  it('longest and most climb can be different rides', () => {
    const long = ride(now - WEEK_MS, { distanceM: 100_000, elevGainM: 500 });
    const climb = ride(now - 2 * WEEK_MS, { distanceM: 60_000, elevGainM: 1_800 });
    const p = goalProgress(eventGoal({ elevGainM: 2_000 }), [long, climb], now);
    expect(p.longest?.activityId).toBe(long.id);
    expect(p.mostClimb?.activityId).toBe(climb.id);
  });

  it('only distance target ignores elevation', () => {
    const p = goalProgress(eventGoal(), [ride(now - WEEK_MS, { elevGainM: 3_000 })], now);
    expect(p.mostClimb).toBeUndefined();
  });

  it('pct is not capped at 100', () => {
    const p = goalProgress(eventGoal(), [ride(now - WEEK_MS, { distanceM: 150_000 })], now);
    expect(p.pct).toBe(125);
  });

  it('no rides gives 0', () => {
    const p = goalProgress(eventGoal({ elevGainM: 2_000 }), [], now);
    expect(p.pct).toBe(0);
    expect(p.longest).toBeUndefined();
    expect(p.mostClimb).toBeUndefined();
  });

  it('days left in madrid days', () => {
    const p = goalProgress(eventGoal(), [], Date.parse('2026-11-06T23:30:00Z'));
    expect(p.daysLeft).toBe(37);
  });

  it('past goal uses rides up to its date', () => {
    const goal = eventGoal({ date: '2026-10-18' });
    const before = ride('2026-10-18T07:00:00Z', { distanceM: 90_000 });
    // 19 de octubre, 00:30 en Madrid: ya es después del objetivo.
    const after = ride('2026-10-18T22:30:00Z', { distanceM: 140_000 });
    const p = goalProgress(goal, [before, after], now);
    expect(p.longest?.activityId).toBe(before.id);
    expect(p.pct).toBe(75);
    expect(p.daysLeft).toBeLessThan(0);
  });
});

describe('periodStartOf', () => {
  it('periodStartOf aligns to monday and day 1', () => {
    expect(periodStartOf('week', '2026-12-03')).toBe('2026-11-30');
    expect(periodStartOf('week', '2026-11-30')).toBe('2026-11-30');
    expect(periodStartOf('week', '2026-12-06')).toBe('2026-11-30'); // domingo
    expect(periodStartOf('month', '2026-11-17')).toBe('2026-11-01');
  });
});

describe('periodRange', () => {
  it('week covers monday 00:00 to next monday − 1 ms', () => {
    const r = periodRange('week', '2026-11-30');
    expect(r.from).toBe(Date.parse('2026-11-29T23:00:00Z'));
    expect(r.to).toBe(Date.parse('2026-12-06T23:00:00Z') - 1);
    expect(r.days).toBe(7);
  });

  it('month with dst change lasts 745 h', () => {
    const r = periodRange('month', '2026-10-01');
    expect(r.to + 1 - r.from).toBe(745 * HOUR_MS);
    expect(r.days).toBe(31);
  });

  it('february has 28 days', () => {
    expect(periodRange('month', '2027-02-01').days).toBe(28);
  });
});

describe('volumeProgress', () => {
  const now = Date.parse('2026-11-06T10:00:00Z');

  it('volume month sums rides in madrid month', () => {
    const acts = [
      ride('2026-10-31T23:30:00Z', { distanceM: 50_000 }), // 1 nov, 00:30 en Madrid
      ride('2026-11-15T09:00:00Z', { distanceM: 70_000 }),
      ride('2026-11-30T23:30:00Z', { distanceM: 90_000 }), // 1 dic, 00:30 en Madrid
    ];
    const p = volumeProgress(volumeGoal(), acts, now);
    expect(p.rides).toBe(2);
    expect(p.targets[0].value).toBe(120_000);
  });

  it('iso week crossing month counts both sides', () => {
    const goal = volumeGoal({ period: 'week', start: '2026-11-30' });
    const acts = [
      ride('2026-11-29T10:00:00Z', { distanceM: 1_000 }),
      ride('2026-11-30T10:00:00Z', { distanceM: 20_000 }),
      ride('2026-12-03T10:00:00Z', { distanceM: 30_000 }),
      ride('2026-12-06T22:30:00Z', { distanceM: 40_000 }), // domingo 6 dic, 23:30 en Madrid
      ride('2026-12-07T10:00:00Z', { distanceM: 5_000 }),
    ];
    const p = volumeProgress(goal, acts, now);
    expect(p.rides).toBe(3);
    expect(p.targets[0].value).toBe(90_000);
    expect(p.daysTotal).toBe(7);
  });

  it('month with dst change uses real hours', () => {
    const goal = volumeGoal({ start: '2026-10-01' });
    const r = ride('2026-09-30T22:30:00Z'); // 1 oct, 00:30 en Madrid
    const p = volumeProgress(goal, [r], Date.parse('2026-10-16T22:00:00Z'));
    expect(p.expectedPct).toBeCloseTo((384 / 745) * 100, 10);
    expect(p.expectedPct).toBeCloseTo(51.54, 2);
    expect(p.rides).toBe(1);
  });

  it('volume pct per target and total is the lower', () => {
    const goal = volumeGoal({ distanceM: 400_000, elevGainM: 5_000, movingTimeS: 20 * 3_600 });
    const r = ride('2026-11-03T09:00:00Z', {
      distanceM: 312_000,
      elevGainM: 3_000,
      movingTimeS: 10 * 3_600,
    });
    const p = volumeProgress(goal, [r], now);
    expect(p.targets.map((t) => t.key)).toEqual(['distanceM', 'elevGainM', 'movingTimeS']);
    expect(p.targets.map((t) => t.pct)).toEqual([78, 60, 50]);
    expect(p.pct).toBe(50);
  });

  it('only defined targets are listed', () => {
    const goal = volumeGoal({ distanceM: undefined, elevGainM: 5_000 });
    const p = volumeProgress(goal, [], now);
    expect(p.targets.map((t) => t.key)).toEqual(['elevGainM']);
  });

  it('expected pace says ahead or behind', () => {
    const at = Date.parse('2026-11-22T23:00:00Z'); // 23 nov, 00:00 en Madrid
    const ahead = volumeProgress(volumeGoal(), [ride('2026-11-10T09:00:00Z', { distanceM: 312_000 })], at);
    expect(ahead.expectedPct).toBeCloseTo((22 / 30) * 100, 10);
    expect(ahead.targets[0].expected).toBeCloseTo((400_000 * 22) / 30, 6);
    expect(ahead.targets[0].aheadPct).toBeCloseTo(78 - (22 / 30) * 100, 10);
    expect(ahead.aheadPct).toBeCloseTo(4.67, 2);

    const behind = volumeProgress(volumeGoal(), [ride('2026-11-10T09:00:00Z', { distanceM: 200_000 })], at);
    expect(behind.aheadPct).toBeCloseTo(-23.33, 2);
  });

  it('volume days left counts today', () => {
    const p = volumeProgress(volumeGoal(), [], now);
    expect(p.status).toBe('current');
    expect(p.daysTotal).toBe(30);
    expect(p.daysLeft).toBe(25);
  });

  it('last day of the period leaves 1 day', () => {
    // Domingo 6 dic, 23:30 en Madrid.
    const p = volumeProgress(
      volumeGoal({ period: 'week', start: '2026-11-30' }),
      [],
      Date.parse('2026-12-06T22:30:00Z'),
    );
    expect(p.status).toBe('current');
    expect(p.daysLeft).toBe(1);
  });

  it('future and past periods', () => {
    const dec = volumeProgress(volumeGoal({ start: '2026-12-01' }), [], now);
    expect(dec.status).toBe('future');
    expect(dec.expectedPct).toBe(0);
    expect(dec.daysLeft).toBe(31);

    const oct = volumeProgress(volumeGoal({ start: '2026-10-01' }), [], now);
    expect(oct.status).toBe('past');
    expect(oct.expectedPct).toBe(100);
    expect(oct.daysLeft).toBe(0);
  });

  it('volume without rides gives 0', () => {
    const p = volumeProgress(volumeGoal({ elevGainM: 5_000 }), [], now);
    expect(p.rides).toBe(0);
    expect(p.targets.every((t) => t.value === 0 && t.pct === 0)).toBe(true);
    expect(p.pct).toBe(0);
  });
});
