import type { TrackPoint } from '../src/domain/types';
import { haversineM } from '../src/import/summary';
import { profileExtent, profileFromTrack } from '../src/ui/profile';

const T0 = Date.UTC(2026, 10, 5, 8);

describe('profileFromTrack', () => {
  it('uses dist when present', () => {
    const track: TrackPoint[] = [
      { t: T0, lat: 41, lng: 2.5, ele: 100, dist: 0 },
      { t: T0 + 1, lat: 41.001, lng: 2.5, ele: 120, dist: 500 },
      { t: T0 + 2, lat: 41.002, lng: 2.5, ele: 110, dist: 1_300 },
    ];
    expect(profileFromTrack(track)).toEqual([
      { dM: 0, ele: 100 },
      { dM: 500, ele: 120 },
      { dM: 1_300, ele: 110 },
    ]);
  });

  it('falls back to haversine', () => {
    const track: TrackPoint[] = [
      { t: T0, lat: 41, lng: 2.5, ele: 100 },
      { t: T0 + 1, lat: 41.01, lng: 2.5, ele: 120 },
      { t: T0 + 2, lat: 41.02, lng: 2.5, ele: 110 },
    ];
    const p = profileFromTrack(track);
    const step = haversineM(41, 2.5, 41.01, 2.5);
    expect(p).toHaveLength(3);
    expect(p[0].dM).toBe(0);
    expect(p[1].dM).toBeCloseTo(step, 6);
    expect(p[2].dM).toBeCloseTo(step + haversineM(41.01, 2.5, 41.02, 2.5), 6);
  });

  it('drops points without ele', () => {
    const track: TrackPoint[] = [
      { t: T0, lat: 41, lng: 2.5, ele: 100, dist: 0 },
      { t: T0 + 1, lat: 41.001, lng: 2.5, dist: 200 },
      { t: T0 + 2, lat: 41.002, lng: 2.5, ele: 130, dist: 400 },
    ];
    expect(profileFromTrack(track)).toEqual([
      { dM: 0, ele: 100 },
      { dM: 400, ele: 130 },
    ]);
  });

  it('returns [] with fewer than 2 points with ele', () => {
    expect(profileFromTrack([])).toEqual([]);
    expect(
      profileFromTrack([
        { t: T0, lat: 41, lng: 2.5, ele: 100, dist: 0 },
        { t: T0 + 1, lat: 41.001, lng: 2.5, dist: 200 },
      ]),
    ).toEqual([]);
  });

  it('reduces to max points and keeps the highest one', () => {
    const track: TrackPoint[] = Array.from({ length: 5_000 }, (_, i) => ({
      t: T0 + i,
      ele: i === 3_333 ? 999 : 100 + (i % 50),
      dist: i * 10,
    }));
    const p = profileFromTrack(track, 240);
    expect(p.length).toBeLessThanOrEqual(240);
    expect(p[0].dM).toBe(0);
    expect(p.at(-1)?.dM).toBe(49_990);
    expect(profileExtent(p)?.summit).toEqual({ dM: 33_330, ele: 999 });
  });
});

describe('profileExtent', () => {
  it('gives min, max and the summit', () => {
    expect(
      profileExtent([
        { dM: 0, ele: 120 },
        { dM: 1_400, ele: 410 },
        { dM: 2_800, ele: 180 },
      ]),
    ).toEqual({ min: 120, max: 410, summit: { dM: 1_400, ele: 410 } });
  });

  it('is null for an empty profile', () => {
    expect(profileExtent([])).toBeNull();
  });
});
