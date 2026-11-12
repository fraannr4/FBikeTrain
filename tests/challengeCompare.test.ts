import type { StoredActivity } from '../src/domain/types';
import type { ChallengeResult } from '../src/social/challenges';
import { compare, resultFromActivity, shortRideWarning } from '../src/social/challengeCompare';

function ride(over: Partial<StoredActivity['totals']> & { startTime?: number } = {}): StoredActivity {
  const { startTime = Date.parse('2026-11-10T10:00:00+01:00'), ...totals } = over;
  return {
    id: 's1', startTime, sport: 'cycling', name: 'Salida sintética', hasTrack: true, source: 'gpx', importedAt: 0,
    totals: { distanceM: 42_012.4, movingTimeS: 5_400.4, elapsedTimeS: 6_000, elevGainM: 612.3, avgSpeedMs: 7.7799, maxSpeedMs: 15, ...totals },
  };
}

const result = (over: Partial<ChallengeResult> = {}): ChallengeResult => ({
  activity_date: '2026-11-10', moving_time_s: 5400, distance_m: 42000, avg_speed_ms: 7.78, elev_gain_m: 600, vam_mh: 400, ...over,
});

describe('resultFromActivity', () => {
  it('saca solo cifras redondeadas y la VAM en m/h', () => {
    expect(resultFromActivity(ride())).toEqual({
      activity_date: '2026-11-10', moving_time_s: 5400, distance_m: 42012, avg_speed_ms: 7.78, elev_gain_m: 612, vam_mh: 408,
    });
  });

  it('cuenta la fecha en Madrid: las 00:30 del día 11 en Madrid son las 23:30 del 10 en UTC', () => {
    expect(resultFromActivity(ride({ startTime: Date.parse('2026-11-10T23:30:00Z') })).activity_date).toBe('2026-11-11');
  });

  it('sin desnivel no hay VAM', () => {
    expect(resultFromActivity(ride({ elevGainM: Number.NaN }))).toMatchObject({ elev_gain_m: null, vam_mh: null });
  });
});

describe('compare', () => {
  it('gana el menor tiempo en movimiento y marca la mejor cifra de cada fila', () => {
    const out = compare(result({ moving_time_s: 5400 }), result({ moving_time_s: 5700, avg_speed_ms: 7.4, vam_mh: 380, elev_gain_m: 610 }));
    expect(out.winner).toBe('mine');
    expect(out.rows).toEqual([
      { label: 'Tiempo en movimiento', mine: '1:30:00', theirs: '1:35:00', better: 'mine' },
      { label: 'Velocidad media', mine: '28,0 km/h', theirs: '26,6 km/h', better: 'mine' },
      { label: 'Distancia', mine: '42,0 km', theirs: '42,0 km', better: null },
      { label: 'Desnivel', mine: '600 m', theirs: '610 m', better: null },
      { label: 'VAM', mine: '400 m/h', theirs: '380 m/h', better: 'mine' },
    ]);
  });

  it('pierde con más tiempo', () => {
    expect(compare(result({ moving_time_s: 6000 }), result()).winner).toBe('theirs');
  });

  it('empata con el mismo tiempo y no marca filas iguales', () => {
    const out = compare(result(), result());
    expect(out.winner).toBe('tie');
    expect(out.rows.every((r) => r.better === null)).toBe(true);
  });

  it('sin desnivel escribe un guion y no compara la VAM', () => {
    const vam = compare(result({ elev_gain_m: null, vam_mh: null }), result()).rows.find((r) => r.label === 'VAM')!;
    expect(vam).toEqual({ label: 'VAM', mine: '–', theirs: '400 m/h', better: null });
  });
});

describe('shortRideWarning', () => {
  it('avisa por debajo del 75 % de la ruta', () => {
    expect(shortRideWarning(ride({ distanceM: 31_000 }), 42_000)).toBe(true);
    expect(shortRideWarning(ride({ distanceM: 31_500 }), 42_000)).toBe(false);
    expect(shortRideWarning(ride({ distanceM: 50_000 }), 42_000)).toBe(false);
  });
});
