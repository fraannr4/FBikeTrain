import {
  computeTotals,
  ELEVATION_HYSTERESIS_M,
  GPS_SPIKE_SPEED_MS,
  isTooShort,
  INDOOR_MIN_MOVING_TIME_S,
  MIN_RIDE_DISTANCE_M,
  MIN_RIDE_MOVING_TIME_S,
  MOVING_SPEED_THRESHOLD_MS,
} from '../src/import/summary';
import type { TrackPoint } from '../src/domain/types';

const T0 = Date.UTC(2026, 10, 6, 8, 0, 0);
const s = (seconds: number) => T0 + seconds * 1000;

describe('computeTotals', () => {
  it('distance from lat/lng with haversine', () => {
    const points: TrackPoint[] = [
      { t: s(0), lat: 41.0, lng: 2.0 },
      { t: s(200), lat: 41.009, lng: 2.0 },
    ];
    const totals = computeTotals(points);
    expect(totals.distanceM).toBeGreaterThanOrEqual(995);
    expect(totals.distanceM).toBeLessThanOrEqual(1005);
  });

  it('uses dist from points instead of haversine', () => {
    const points: TrackPoint[] = [
      { t: s(0), lat: 41.0, lng: 2.0, dist: 0 },
      { t: s(100), lat: 41.009, lng: 2.0, dist: 800 },
    ];
    expect(computeTotals(points).distanceM).toBe(800);
  });

  it('moving time excludes stops', () => {
    const points: TrackPoint[] = [
      { t: s(0), dist: 0 },
      { t: s(100), dist: 600 }, // 6 m/s
      { t: s(400), dist: 600 + 0.5 * 300 }, // 0,5 m/s durante 300 s
      { t: s(500), dist: 750 + 600 }, // 6 m/s
    ];
    const totals = computeTotals(points);
    expect(totals.movingTimeS).toBe(200);
    expect(totals.elapsedTimeS).toBe(500);
  });

  it('segment exactly at the moving threshold counts as moving', () => {
    const points: TrackPoint[] = [
      { t: s(0), dist: 0 },
      { t: s(10), dist: MOVING_SPEED_THRESHOLD_MS * 10 },
    ];
    expect(computeTotals(points).movingTimeS).toBe(10);
  });

  it('avg speed is distance over moving time and max speed is the fastest segment', () => {
    const points: TrackPoint[] = [
      { t: s(0), dist: 0 },
      { t: s(100), dist: 500 }, // 5 m/s
      { t: s(200), dist: 500 }, // parado
      { t: s(300), dist: 1500 }, // 10 m/s
    ];
    const totals = computeTotals(points);
    expect(totals.distanceM).toBe(1500);
    expect(totals.movingTimeS).toBe(200);
    expect(totals.avgSpeedMs).toBe(7.5);
    expect(totals.maxSpeedMs).toBe(10);
  });

  it('elevation gain uses 3 m hysteresis', () => {
    const at = (eles: number[]): TrackPoint[] => eles.map((ele, i) => ({ t: s(i), ele }));
    expect(computeTotals(at([100, 101, 100, 102, 100])).elevGainM).toBe(0);
    expect(computeTotals(at([100, 104, 108])).elevGainM).toBe(8);
  });

  it('elevation gain counts a rise of exactly the hysteresis', () => {
    const points: TrackPoint[] = [
      { t: s(0), ele: 100 },
      { t: s(1), ele: 100 + ELEVATION_HYSTERESIS_M },
    ];
    expect(computeTotals(points).elevGainM).toBe(ELEVATION_HYSTERESIS_M);
  });

  it('elevation gain restarts from the bottom after a descent', () => {
    const points: TrackPoint[] = [100, 110, 95, 105].map((ele, i) => ({ t: s(i), ele }));
    expect(computeTotals(points).elevGainM).toBe(20);
  });

  it('avg cadence ignores zeros', () => {
    const points: TrackPoint[] = [0, 80, 90].map((cad, i) => ({ t: s(i), cad }));
    expect(computeTotals(points).avgCadence).toBe(85);
  });

  it('avgHr undefined when no hr', () => {
    const points: TrackPoint[] = [
      { t: s(0), lat: 41.0, lng: 2.0 },
      { t: s(10), lat: 41.001, lng: 2.0 },
    ];
    const totals = computeTotals(points);
    expect(totals.avgHr).toBeUndefined();
    expect(totals.avgPower).toBeUndefined();
    expect(totals.avgCadence).toBeUndefined();
  });

  it('averages hr and power when present', () => {
    const points: TrackPoint[] = [
      { t: s(0), hr: 120, power: 0 },
      { t: s(1), hr: 140, power: 200 },
      { t: s(2) },
    ];
    const totals = computeTotals(points);
    expect(totals.avgHr).toBe(130);
    expect(totals.avgPower).toBe(100);
  });

  it('empty track gives zero totals without NaN', () => {
    expect(computeTotals([])).toEqual({
      distanceM: 0,
      movingTimeS: 0,
      elapsedTimeS: 0,
      elevGainM: 0,
      avgSpeedMs: 0,
      maxSpeedMs: 0,
    });
  });

  it('single point gives zero totals', () => {
    const totals = computeTotals([{ t: s(0), lat: 41, lng: 2, ele: 100, hr: 110 }]);
    expect(totals.distanceM).toBe(0);
    expect(totals.elapsedTimeS).toBe(0);
    expect(totals.avgSpeedMs).toBe(0);
    expect(totals.avgHr).toBe(110);
  });

  it('ride without gps or distance has elapsed time but no distance', () => {
    const points: TrackPoint[] = [
      { t: s(0), hr: 100 },
      { t: s(600), hr: 120 },
    ];
    const totals = computeTotals(points);
    expect(totals.distanceM).toBe(0);
    expect(totals.movingTimeS).toBe(0);
    expect(totals.elapsedTimeS).toBe(600);
    expect(totals.avgSpeedMs).toBe(0);
    expect(totals.maxSpeedMs).toBe(0);
  });

  it('indoor ride with wheel sensor dist counts distance and moving time', () => {
    const points: TrackPoint[] = [
      { t: s(0), dist: 0 },
      { t: s(600), dist: 5000 },
    ];
    const totals = computeTotals(points);
    expect(totals.distanceM).toBe(5000);
    expect(totals.movingTimeS).toBe(600);
  });

  describe('max speed ignores GPS spikes', () => {
    /** Un punto por segundo con la distancia acumulada de cada tramo (m/s). */
    const bySpeed = (speeds: number[]): TrackPoint[] => {
      let dist = 0;
      return [{ t: s(0), dist: 0 }, ...speeds.map((v, i) => ({ t: s(i + 1), dist: (dist += v) }))];
    };
    const cruise = (n: number) => Array<number>(n).fill(8);

    it('an isolated 300 m/s spike does not change max speed', () => {
      expect(computeTotals(bySpeed([...cruise(10), 300, ...cruise(10)])).maxSpeedMs).toBe(8);
    });

    it('a GPS jump out and back (two spike segments) does not change max speed', () => {
      const points: TrackPoint[] = Array.from({ length: 21 }, (_, i) => ({ t: s(i), lat: 41 + i * 0.00007, lng: 2.5 }));
      points[10] = { ...points[10], lat: points[10].lat! + 0.0027 }; // ~300 m fuera y vuelta
      expect(computeTotals(points).maxSpeedMs).toBeLessThan(GPS_SPIKE_SPEED_MS);
    });

    it('a sustained 20 m/s descent counts', () => {
      expect(computeTotals(bySpeed([...cruise(10), ...Array<number>(30).fill(20), ...cruise(10)])).maxSpeedMs).toBe(20);
    });

    it('a sustained descent above the spike threshold counts', () => {
      const fast = GPS_SPIKE_SPEED_MS + 1;
      expect(computeTotals(bySpeed([...cruise(10), ...Array<number>(10).fill(fast), ...cruise(10)])).maxSpeedMs).toBe(fast);
    });

    it('device speeds are used and filtered the same way', () => {
      const points = bySpeed(cruise(21)).map((p, i) => ({ ...p, speed: i === 11 ? 300 : 9 }));
      expect(computeTotals(points).maxSpeedMs).toBe(9);
    });
  });
});

describe('isTooShort', () => {
  it('rides under the minimum distance or moving time are too short', () => {
    expect(isTooShort({ distanceM: 0, movingTimeS: 2 })).toBe(true);
    expect(isTooShort({ distanceM: MIN_RIDE_DISTANCE_M - 1, movingTimeS: INDOOR_MIN_MOVING_TIME_S - 1 })).toBe(true);
    expect(isTooShort({ distanceM: 5000, movingTimeS: MIN_RIDE_MOVING_TIME_S - 1 })).toBe(true);
  });

  it('an indoor trainer ride without distance is kept when it lasts long enough', () => {
    expect(isTooShort({ distanceM: 0, movingTimeS: 3_600 })).toBe(false);
    expect(isTooShort({ distanceM: 0, movingTimeS: INDOOR_MIN_MOVING_TIME_S })).toBe(false);
  });

  it('a ride exactly at both minimums is kept', () => {
    expect(isTooShort({ distanceM: MIN_RIDE_DISTANCE_M, movingTimeS: MIN_RIDE_MOVING_TIME_S })).toBe(false);
  });
});
