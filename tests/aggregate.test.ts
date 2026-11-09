import {
  aggregate,
  currentWeekVsAverage,
  DEFAULT_COMPARE_WEEKS,
  TZ,
} from '../src/metrics/aggregate';
import type { StoredActivity } from '../src/domain/types';

let seq = 0;
function ride(
  iso: string,
  { distanceM = 20_000, elevGainM = 200, movingTimeS = 3_600 } = {},
): StoredActivity {
  seq += 1;
  return {
    id: `r${seq}`,
    startTime: Date.parse(iso),
    sport: 'cycling',
    totals: {
      distanceM,
      movingTimeS,
      elapsedTimeS: movingTimeS,
      elevGainM,
      avgSpeedMs: distanceM / movingTimeS,
      maxSpeedMs: 15,
    },
    hasTrack: true,
    source: 'gpx',
    importedAt: 0,
  };
}

describe('aggregate', () => {
  it('uses Europe/Madrid', () => {
    expect(TZ).toBe('Europe/Madrid');
  });

  it('sunday 23:30 madrid belongs to that week', () => {
    // Domingo 8 de noviembre, 23:30 en Madrid (UTC+1).
    const acts = [ride('2026-11-08T22:30:00Z')];
    const from = Date.parse('2026-11-02T12:00:00Z');
    const to = Date.parse('2026-11-12T12:00:00Z');
    const weeks = aggregate(acts, 'week', from, to);
    expect(weeks).toHaveLength(2);
    // Lunes 2 de noviembre, 00:00 en Madrid.
    expect(weeks[0].start).toBe(Date.parse('2026-11-01T23:00:00Z'));
    expect(weeks[0].rides).toBe(1);
    expect(weeks[1].start).toBe(Date.parse('2026-11-08T23:00:00Z'));
    expect(weeks[1].rides).toBe(0);
  });

  it('dst change week', () => {
    const acts = [
      ride('2026-10-19T06:00:00Z'), // lunes, CEST
      ride('2026-10-25T00:30:00Z'), // domingo 02:30 CEST, antes del cambio
      ride('2026-10-25T01:30:00Z'), // domingo 02:30 CET, después del cambio
      ride('2026-10-25T22:30:00Z'), // domingo 23:30 CET
      ride('2026-10-25T23:30:00Z'), // lunes 26, 00:30 CET: semana siguiente
    ];
    const from = Date.parse('2026-10-20T12:00:00Z');
    const to = Date.parse('2026-10-27T12:00:00Z');
    const weeks = aggregate(acts, 'week', from, to);
    expect(weeks.map((w) => w.rides)).toEqual([4, 1]);
    expect(weeks[0].start).toBe(Date.parse('2026-10-18T22:00:00Z')); // 00:00 CEST
    expect(weeks[1].start).toBe(Date.parse('2026-10-25T23:00:00Z')); // 00:00 CET
  });

  it('empty weeks are zero-filled', () => {
    const acts = [ride('2026-11-03T10:00:00Z'), ride('2026-11-17T10:00:00Z')];
    const from = Date.parse('2026-11-02T10:00:00Z');
    const to = Date.parse('2026-11-18T10:00:00Z');
    const weeks = aggregate(acts, 'week', from, to);
    expect(weeks).toHaveLength(3);
    expect(weeks[1]).toMatchObject({
      distanceM: 0,
      elevGainM: 0,
      movingTimeS: 0,
      rides: 0,
      avgSpeedMs: 0,
    });
  });

  it('empty range of activities returns zero periods', () => {
    const weeks = aggregate(
      [],
      'week',
      Date.parse('2026-11-02T10:00:00Z'),
      Date.parse('2026-11-04T10:00:00Z'),
    );
    expect(weeks).toHaveLength(1);
    expect(weeks[0].rides).toBe(0);
    expect(Number.isNaN(weeks[0].avgSpeedMs)).toBe(false);
  });

  it('avgSpeed is distance over moving time of the period', () => {
    const acts = [
      ride('2026-11-03T10:00:00Z', { distanceM: 20_000, movingTimeS: 1_000 }),
      ride('2026-11-04T10:00:00Z', { distanceM: 10_000, movingTimeS: 2_000 }),
    ];
    const [week] = aggregate(
      acts,
      'week',
      Date.parse('2026-11-03T00:00:00Z'),
      Date.parse('2026-11-05T00:00:00Z'),
    );
    // 30 km en 3.000 s, no la media de 20 y 5 m/s.
    expect(week.avgSpeedMs).toBe(10);
    expect(week.distanceM).toBe(30_000);
    expect(week.movingTimeS).toBe(3_000);
  });

  it('ride without gps counts in the totals', () => {
    const indoor = { ...ride('2026-11-03T18:00:00Z', { distanceM: 25_000 }), hasTrack: false };
    const [week] = aggregate(
      [indoor],
      'week',
      Date.parse('2026-11-03T00:00:00Z'),
      Date.parse('2026-11-05T00:00:00Z'),
    );
    expect(week.rides).toBe(1);
    expect(week.distanceM).toBe(25_000);
  });

  it('ignores activities outside the range', () => {
    const acts = [ride('2026-10-01T10:00:00Z'), ride('2026-11-03T10:00:00Z')];
    const weeks = aggregate(
      acts,
      'week',
      Date.parse('2026-11-03T00:00:00Z'),
      Date.parse('2026-11-05T00:00:00Z'),
    );
    expect(weeks).toHaveLength(1);
    expect(weeks[0].rides).toBe(1);
  });

  it('month starts at local midnight of day 1', () => {
    // 1 de noviembre, 00:30 en Madrid: cuenta en noviembre.
    const acts = [ride('2026-10-31T23:30:00Z')];
    const months = aggregate(
      acts,
      'month',
      Date.parse('2026-10-15T00:00:00Z'),
      Date.parse('2026-11-15T00:00:00Z'),
    );
    expect(months.map((m) => m.rides)).toEqual([0, 1]);
    expect(months[1].start).toBe(Date.parse('2026-10-31T23:00:00Z'));
  });

  it('labels periods in spanish', () => {
    const from = Date.parse('2026-11-03T00:00:00Z');
    expect(aggregate([], 'week', from, from)[0].label).toBe('2 nov');
    expect(aggregate([], 'month', from, from)[0].label).toBe('nov 2026');
  });

  it('day periods are local days', () => {
    // 25 de octubre (día del cambio de hora, 25 h) y 26 de octubre, ambos a las 00:30 en Madrid.
    const acts = [ride('2026-10-24T22:30:00Z'), ride('2026-10-25T23:30:00Z')];
    const days = aggregate(
      acts,
      'day',
      Date.parse('2026-10-24T22:00:00Z'),
      Date.parse('2026-10-26T22:59:59Z'),
    );
    expect(days.map((d) => d.label)).toEqual(['25 oct', '26 oct']);
    expect(days.map((d) => d.rides)).toEqual([1, 1]);
    expect(days[0].start).toBe(Date.parse('2026-10-24T22:00:00Z')); // 00:00 CEST
    expect(days[1].start).toBe(Date.parse('2026-10-25T23:00:00Z')); // 00:00 CET
  });

  it('day period puts 23:30 in that local day', () => {
    // Domingo 8 de noviembre, 23:30 en Madrid: en UTC ya es el 8 a las 22:30, no el 9.
    const days = aggregate(
      [ride('2026-11-08T22:30:00Z')],
      'day',
      Date.parse('2026-11-07T23:00:00Z'),
      Date.parse('2026-11-09T22:59:59Z'),
    );
    expect(days.map((d) => d.rides)).toEqual([1, 0]);
  });
});

describe('currentWeekVsAverage', () => {
  const now = Date.parse('2026-11-06T10:00:00Z'); // viernes

  it('delta null when no history', () => {
    const r = currentWeekVsAverage([ride('2026-11-03T10:00:00Z')], now);
    expect(r.current.rides).toBe(1);
    expect(r.deltaPct).toEqual({ distance: null, elev: null, time: null, speed: null, rides: null });
  });

  it('delta null with no activities at all', () => {
    const r = currentWeekVsAverage([], now);
    expect(r.current.rides).toBe(0);
    expect(r.deltaPct).toEqual({ distance: null, elev: null, time: null, speed: null, rides: null });
  });

  it('compares current week with the mean of the previous weeks', () => {
    expect(DEFAULT_COMPARE_WEEKS).toBe(4);
    const acts = [
      // Semana actual (desde el lunes 2 de noviembre): 60 km, 600 m, 3 h.
      ride('2026-11-03T10:00:00Z', { distanceM: 60_000, elevGainM: 600, movingTimeS: 10_800 }),
      // Cuatro semanas anteriores: 160 km, 1.600 m, 8 h en total; una vacía.
      ride('2026-10-06T10:00:00Z', { distanceM: 80_000, elevGainM: 800, movingTimeS: 14_400 }),
      ride('2026-10-14T10:00:00Z', { distanceM: 40_000, elevGainM: 400, movingTimeS: 7_200 }),
      ride('2026-10-27T10:00:00Z', { distanceM: 40_000, elevGainM: 400, movingTimeS: 7_200 }),
      // Fuera de la ventana de comparación.
      ride('2026-09-29T10:00:00Z', { distanceM: 999_000 }),
    ];
    const r = currentWeekVsAverage(acts, now);
    expect(r.avg.distanceM).toBe(40_000);
    expect(r.avg.elevGainM).toBe(400);
    expect(r.avg.movingTimeS).toBe(7_200);
    expect(r.deltaPct.distance).toBeCloseTo(50);
    expect(r.deltaPct.elev).toBeCloseTo(50);
    expect(r.deltaPct.time).toBeCloseTo(50);
  });

  it('respects the weeks argument', () => {
    const acts = [
      ride('2026-11-03T10:00:00Z', { distanceM: 30_000 }),
      ride('2026-10-27T10:00:00Z', { distanceM: 20_000 }),
      ride('2026-10-20T10:00:00Z', { distanceM: 40_000 }),
    ];
    const r = currentWeekVsAverage(acts, now, 1);
    expect(r.avg.distanceM).toBe(20_000);
    expect(r.deltaPct.distance).toBeCloseTo(50);
  });

  it('speed delta compares average speeds', () => {
    const prev = { distanceM: 95_652, movingTimeS: 13_998 };
    const acts = [
      // Semana actual: 88 km en 13.320 s, en dos salidas.
      ride('2026-11-03T10:00:00Z', { distanceM: 44_000, movingTimeS: 6_660 }),
      ride('2026-11-05T10:00:00Z', { distanceM: 44_000, movingTimeS: 6_660 }),
      // Una salida en cada una de las cuatro semanas anteriores.
      ride('2026-10-06T10:00:00Z', prev),
      ride('2026-10-13T10:00:00Z', prev),
      ride('2026-10-20T10:00:00Z', prev),
      ride('2026-10-27T10:00:00Z', prev),
    ];
    const r = currentWeekVsAverage(acts, now);
    expect(r.deltaPct.speed).toBeCloseTo(-3.32, 1);
    expect(r.deltaPct.rides).toBe(100);
  });

  it('speed delta null without rides this week', () => {
    const r = currentWeekVsAverage([ride('2026-10-27T10:00:00Z')], now);
    expect(r.current.rides).toBe(0);
    expect(r.deltaPct.speed).toBeNull();
    expect(r.deltaPct.rides).toBe(-100);
  });

  it('sunday 23:30 is still the current week', () => {
    const sunday = Date.parse('2026-11-08T22:30:00Z');
    const r = currentWeekVsAverage([ride('2026-11-08T22:30:00Z')], sunday);
    expect(r.current.start).toBe(Date.parse('2026-11-01T23:00:00Z'));
    expect(r.current.rides).toBe(1);
  });
});

describe('aggregate performance', () => {
  it('5000 activities and 6 calls take under 1 s (catches gross regressions; wall-clock is noisy under load)', () => {
    const DAY = 86_400_000;
    const now = Date.parse('2026-11-06T12:00:00Z');
    const acts = Array.from({ length: 5_000 }, (_, i) =>
      ride(new Date(now - (i + 1) * 0.29 * DAY).toISOString()),
    );
    const t0 = performance.now();
    aggregate(acts, 'week', now - 26 * 7 * DAY, now);
    aggregate(acts, 'month', now - 180 * DAY, now);
    aggregate(acts, 'week', now, now);
    aggregate(acts, 'month', now, now);
    aggregate(acts, 'week', now - 21 * DAY, now - 21 * DAY);
    aggregate(acts, 'month', now - 70 * DAY, now - 70 * DAY);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
