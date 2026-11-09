import {
  performanceSummary,
  RANGE_WINDOW_DAYS,
  RECENT_WINDOW_DAYS,
} from '../src/metrics/performance';
import { MIN_RIDE_DISTANCE_M } from '../src/import/summary';
import type { StoredActivity } from '../src/domain/types';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const DAY_MS = 86_400_000;

let seq = 0;
function ride(
  startTime: number,
  {
    distanceM = 20_000,
    elevGainM = 200,
    movingTimeS = 3_600,
    avgCadence,
  }: { distanceM?: number; elevGainM?: number; movingTimeS?: number; avgCadence?: number } = {},
): StoredActivity {
  seq += 1;
  return {
    id: `p${seq}`,
    startTime,
    sport: 'cycling',
    totals: {
      distanceM,
      movingTimeS,
      elapsedTimeS: movingTimeS,
      elevGainM,
      avgSpeedMs: distanceM / movingTimeS,
      maxSpeedMs: 15,
      ...(avgCadence === undefined ? {} : { avgCadence }),
    },
    hasTrack: true,
    source: 'gpx',
    importedAt: 0,
  };
}

/** Salida `days` días antes de NOW (aproximado: para fechas lejos de los bordes de la ventana). */
const daysAgo = (days: number) => NOW - days * DAY_MS;

describe('performanceSummary', () => {
  it('uses windows of 30 and 365 days', () => {
    expect(RECENT_WINDOW_DAYS).toBe(30);
    expect(RANGE_WINDOW_DAYS).toBe(365);
  });

  it('speed is total distance over total time', () => {
    const acts = [
      ride(daysAgo(3), { distanceM: 60_000, movingTimeS: 7_200 }),
      ride(daysAgo(5), { distanceM: 20_000, movingTimeS: 3_600 }),
    ];
    const r = performanceSummary(acts, NOW);
    // 80 km en 3 h, no la media de 8,33 y 5,56 m/s.
    expect(r.speed.value).toBeCloseTo(7.407, 3);
    expect(r.rides30).toBe(2);
  });

  it('range comes from single rides of 12 months', () => {
    const acts = [
      ride(daysAgo(3), { distanceM: 30_000, movingTimeS: 3_600 }), // 8,33 m/s
      ride(daysAgo(100), { distanceM: 18_000, movingTimeS: 3_600 }), // 5 m/s, la más lenta
      ride(daysAgo(200), { distanceM: 36_000, movingTimeS: 3_600 }), // 10 m/s, la más rápida
      ride(daysAgo(400), { distanceM: 72_000, movingTimeS: 3_600 }), // fuera de los 12 meses
    ];
    const r = performanceSummary(acts, NOW);
    expect(r.speed.min).toBe(5);
    expect(r.speed.max).toBe(10);
    expect(r.speed.mean).toBeCloseTo(84_000 / 10_800);
    expect(r.speed.value).toBeCloseTo(30_000 / 3_600);
  });

  it('deltaPct compares 30 days with the 12-month mean', () => {
    const acts = [
      ride(daysAgo(3), { elevGainM: 600 }),
      ride(daysAgo(100), { elevGainM: 200 }),
      ride(daysAgo(200), { elevGainM: 100 }),
    ];
    const r = performanceSummary(acts, NOW);
    expect(r.elevPerRide.value).toBe(600);
    expect(r.elevPerRide.mean).toBe(300);
    expect(r.elevPerRide.min).toBe(100);
    expect(r.elevPerRide.max).toBe(600);
    expect(r.elevPerRide.deltaPct).toBeCloseTo(100);
  });

  it('cadence weighted by moving time and ignores rides without sensor', () => {
    const acts = [
      ride(daysAgo(2), { movingTimeS: 7_200, avgCadence: 90 }),
      ride(daysAgo(4), { movingTimeS: 3_600, avgCadence: 60 }),
      ride(daysAgo(6), { movingTimeS: 3_600 }),
    ];
    const r = performanceSummary(acts, NOW);
    expect(r.cadence).not.toBeNull();
    expect(r.cadence!.value).toBe(80);
    expect(r.cadence!.ridesWith30).toBe(2);
    expect(r.cadence!.min).toBe(60);
    expect(r.cadence!.max).toBe(90);
    expect(r.rides30).toBe(3);
  });

  it('cadence null when no ride has cadence', () => {
    const r = performanceSummary([ride(daysAgo(2)), ride(daysAgo(100))], NOW);
    expect(r.cadence).toBeNull();
  });

  it('cadence keeps 12-month mean when the last 30 days have no sensor', () => {
    const r = performanceSummary(
      [ride(daysAgo(2)), ride(daysAgo(100), { avgCadence: 85 })],
      NOW,
    );
    expect(r.cadence).toEqual({
      value: null,
      mean: 85,
      min: 85,
      max: 85,
      deltaPct: null,
      ridesWith30: 0,
    });
  });

  it('longest ride of 30 days with its date', () => {
    const longest = ride(daysAgo(10), { distanceM: 80_000 });
    const acts = [
      ride(daysAgo(3), { distanceM: 50_000 }),
      longest,
      ride(daysAgo(20), { distanceM: 30_000 }),
      ride(daysAgo(100), { distanceM: 120_000 }),
    ];
    const r = performanceSummary(acts, NOW);
    expect(r.longest.value).toBe(80_000);
    expect(r.longest.startTime).toBe(longest.startTime);
    expect(r.longest.mean).toBe(70_000);
    expect(r.longest.min).toBe(30_000);
    expect(r.longest.max).toBe(120_000);
  });

  it('no rides in 30 days gives null values and keeps 12-month mean', () => {
    const acts = [
      ride(daysAgo(40), { distanceM: 40_000, elevGainM: 400, movingTimeS: 4_000 }),
      ride(daysAgo(100), { distanceM: 20_000, elevGainM: 200, movingTimeS: 2_000 }),
    ];
    const r = performanceSummary(acts, NOW);
    expect(r.rides30).toBe(0);
    expect(r.speed).toEqual({ value: null, mean: 10, min: 10, max: 10, deltaPct: null });
    expect(r.elevPerRide).toEqual({ value: null, mean: 300, min: 200, max: 400, deltaPct: null });
    expect(r.longest).toEqual({
      value: null,
      mean: 30_000,
      min: 20_000,
      max: 40_000,
      deltaPct: null,
      startTime: null,
    });
  });

  it('empty history gives nulls, not zeros or NaN', () => {
    const empty = { value: null, mean: null, min: null, max: null, deltaPct: null };
    expect(performanceSummary([], NOW)).toEqual({
      rides30: 0,
      speed: empty,
      elevPerRide: empty,
      cadence: null,
      longest: { ...empty, startTime: null },
    });
  });

  it('a single ride is its own mean', () => {
    const r = performanceSummary([ride(daysAgo(1), { distanceM: 36_000 })], NOW);
    expect(r.speed).toEqual({ value: 10, mean: 10, min: 10, max: 10, deltaPct: 0 });
    expect(r.longest.deltaPct).toBe(0);
  });

  it('ride without gps counts', () => {
    const indoor = { ...ride(daysAgo(1), { distanceM: 25_000 }), hasTrack: false };
    const r = performanceSummary([indoor], NOW);
    expect(r.rides30).toBe(1);
    expect(r.longest.value).toBe(25_000);
  });

  it('too short rides are ignored', () => {
    const acts = [
      ride(daysAgo(1), { distanceM: 20_000, movingTimeS: 3_600 }),
      // 150 m en 60 s: velocidad y distancia irrelevantes, pero cuenta como basura.
      ride(daysAgo(2), { distanceM: MIN_RIDE_DISTANCE_M - 50, movingTimeS: 5, elevGainM: 900 }),
    ];
    const r = performanceSummary(acts, NOW);
    expect(r.rides30).toBe(1);
    expect(r.speed.max).toBeCloseTo(20_000 / 3_600);
    expect(r.elevPerRide.max).toBe(200);
  });

  it('30-day window counts madrid calendar days across the dst change', () => {
    // NOW es el 6 de noviembre a las 13:00 CET. Treinta días antes, a la misma hora local,
    // es el 7 de octubre a las 13:00 CEST = 11:00Z (30 × 24 h darían las 12:00Z).
    const inside = ride(Date.parse('2026-10-07T11:30:00Z'));
    const onBoundary = ride(Date.parse('2026-10-07T11:00:00Z'));
    expect(performanceSummary([inside], NOW).rides30).toBe(1);
    expect(performanceSummary([onBoundary], NOW).rides30).toBe(0);
  });

  it('includes a ride exactly at now and ignores future rides', () => {
    const r = performanceSummary([ride(NOW), ride(NOW + DAY_MS)], NOW);
    expect(r.rides30).toBe(1);
  });

  it('sunday 23:30 madrid ride is inside the window', () => {
    // Domingo 8 de noviembre, 23:30 en Madrid; se consulta a las 23:45.
    const sundayNight = Date.parse('2026-11-08T22:30:00Z');
    const r = performanceSummary([ride(sundayNight)], Date.parse('2026-11-08T22:45:00Z'));
    expect(r.rides30).toBe(1);
  });
});
