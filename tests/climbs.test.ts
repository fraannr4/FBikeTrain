import {
  CLIMB_MIN_GRADE_PCT,
  CLIMB_MIN_LENGTH_M,
  CLIMB_SPLIT_DROP_M,
  SMOOTH_WINDOW_M,
  buildProfile,
  detectClimbs,
} from '../src/metrics/climbs';
import type { TrackPoint } from '../src/domain/types';
import { SYNTH_STEP_M, synthClimbTrack } from './helpers/synth';

describe('buildProfile', () => {
  it('keeps only points with position and elevation, with their track index', () => {
    const track = synthClimbTrack([{ lengthM: 300, gradePct: 0 }]);
    const holed: TrackPoint[] = track.map((p, i) => (i === 3 ? { ...p, ele: undefined } : i === 5 ? { t: p.t, ele: p.ele } : p));
    const profile = buildProfile(holed);
    expect(profile).toHaveLength(track.length - 2);
    expect(profile.map((p) => p.i)).not.toContain(3);
    expect(profile.map((p) => p.i)).not.toContain(5);
    expect(profile[0].distM).toBe(0);
    expect(profile[profile.length - 1].distM).toBeCloseTo(300, 0);
  });

  it('smooths elevation with the mean of the points within half the window', () => {
    const flat = synthClimbTrack([{ lengthM: 600, gradePct: 0 }]);
    const spiked = flat.map((p, i) => (i === 20 ? { ...p, ele: p.ele! + 70 } : p));
    const profile = buildProfile(spiked);
    // ±50 m con un punto cada 15 m: 7 puntos en la ventana, el pico se reparte entre ellos.
    const inWindow = Math.floor(SMOOTH_WINDOW_M / 2 / SYNTH_STEP_M) * 2 + 1;
    expect(profile[20].ele).toBeCloseTo(100 + 70 / inWindow, 6);
    expect(profile[0].ele).toBeCloseTo(100, 6);
  });

  it('empty track gives an empty profile', () => {
    expect(buildProfile([])).toEqual([]);
  });
});

describe('detectClimbs', () => {
  it('detects 2 km at 5 %', () => {
    const climbs = detectClimbs(
      synthClimbTrack([
        { lengthM: 1000, gradePct: 0 },
        { lengthM: 2000, gradePct: 5 },
        { lengthM: 1000, gradePct: 0 },
      ]),
    );
    expect(climbs).toHaveLength(1);
    expect(Math.abs(climbs[0].lengthM - 2000)).toBeLessThanOrEqual(60);
    expect(Math.abs(climbs[0].avgGradePct - 5)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(climbs[0].startDistM - 1000)).toBeLessThanOrEqual(60);
  });

  it('ignores 800 m at 8 %', () => {
    const lengthM = CLIMB_MIN_LENGTH_M * 0.8;
    expect(detectClimbs(synthClimbTrack([{ lengthM: 500, gradePct: 0 }, { lengthM, gradePct: 8 }, { lengthM: 500, gradePct: 0 }]))).toEqual([]);
  });

  it('ignores 3 km at 2 %', () => {
    const gradePct = CLIMB_MIN_GRADE_PCT - 1;
    expect(detectClimbs(synthClimbTrack([{ lengthM: 500, gradePct: 0 }, { lengthM: 3000, gradePct }, { lengthM: 500, gradePct: 0 }]))).toEqual([]);
  });

  it('short dip does not split', () => {
    // 100 m al -3 %: 3 m de bajada, por debajo de CLIMB_SPLIT_DROP_M.
    expect((100 * 3) / 100).toBeLessThan(CLIMB_SPLIT_DROP_M);
    const climbs = detectClimbs(
      synthClimbTrack([
        { lengthM: 1000, gradePct: 6 },
        { lengthM: 100, gradePct: -3 },
        { lengthM: 1000, gradePct: 6 },
      ]),
    );
    expect(climbs).toHaveLength(1);
    expect(climbs[0].lengthM).toBeGreaterThanOrEqual(1950);
  });

  it('drop over 10 m splits', () => {
    // 500 m al -5 %: 25 m de bajada, por encima de CLIMB_SPLIT_DROP_M.
    expect((500 * 5) / 100).toBeGreaterThan(CLIMB_SPLIT_DROP_M);
    const climbs = detectClimbs(
      synthClimbTrack([
        { lengthM: 1200, gradePct: 6 },
        { lengthM: 500, gradePct: -5 },
        { lengthM: 1200, gradePct: 6 },
      ]),
    );
    expect(climbs).toHaveLength(2);
    expect(climbs[0].startDistM).toBeLessThan(climbs[1].startDistM);
  });

  it('start does not depend on the approach', () => {
    const [a] = detectClimbs(synthClimbTrack([{ lengthM: 2000, gradePct: 1 }, { lengthM: 2000, gradePct: 6 }]));
    const [b] = detectClimbs(synthClimbTrack([{ lengthM: 1000, gradePct: -4 }, { lengthM: 2000, gradePct: 6 }]));
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(Math.abs(a.startDistM - 2000 - (b.startDistM - 1000))).toBeLessThan(50);
  });

  it('noise of ±2 m does not split or invent climbs', () => {
    const climbs = detectClimbs(
      synthClimbTrack(
        [
          { lengthM: 3000, gradePct: 0 },
          { lengthM: 2000, gradePct: 5 },
          { lengthM: 3000, gradePct: 0 },
        ],
        { noiseM: 2 },
      ),
    );
    expect(climbs).toHaveLength(1);
  });

  it('time speed and vam', () => {
    const climbs = detectClimbs(
      synthClimbTrack([
        { lengthM: 1000, gradePct: 0 },
        { lengthM: 2000, gradePct: 5, speedMs: 10 / 3 },
        { lengthM: 1000, gradePct: 0 },
      ]),
    );
    expect(climbs).toHaveLength(1);
    const [c] = climbs;
    expect(Math.abs(c.timeS - 600)).toBeLessThanOrEqual(20);
    expect(Math.abs(c.avgSpeedMs - 10 / 3)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(c.vamMh - 600)).toBeLessThanOrEqual(30);
    expect(c.vamMh).toBeCloseTo(c.gainM / (c.timeS / 3600), 9);
    expect(c.avgSpeedMs).toBeCloseTo(c.lengthM / c.timeS, 9);
  });

  it('elapsed time is epoch based, so a climb across the DST change keeps its duration', () => {
    const base = synthClimbTrack([
      { lengthM: 1000, gradePct: 0 },
      { lengthM: 2000, gradePct: 5, speedMs: 10 / 3 },
      { lengthM: 1000, gradePct: 0 },
    ]);
    // 2026-10-25 01:00 UTC: en Madrid las 03:00 CEST pasan a ser las 02:00 CET. La subida empieza 2 min antes.
    const shift = Date.UTC(2026, 9, 25, 0, 55) - base[0].t;
    const [shifted] = detectClimbs(base.map((p) => ({ ...p, t: p.t + shift })));
    const [plain] = detectClimbs(base);
    expect(shifted.timeS).toBe(plain.timeS);
  });

  it('track without elevation yields no climbs', () => {
    const track = synthClimbTrack([{ lengthM: 2000, gradePct: 6 }]).map(({ ele: _ele, ...p }) => p);
    expect(detectClimbs(track)).toEqual([]);
  });

  it('track without GPS yields no climbs', () => {
    const track = synthClimbTrack([{ lengthM: 2000, gradePct: 6 }]).map(({ t, ele }) => ({ t, ele }));
    expect(detectClimbs(track)).toEqual([]);
  });

  it('empty or single point track yields no climbs', () => {
    expect(detectClimbs([])).toEqual([]);
    expect(detectClimbs(synthClimbTrack([{ lengthM: 0, gradePct: 0 }]))).toEqual([]);
  });

  it('climb at the very end of the track is detected', () => {
    expect(detectClimbs(synthClimbTrack([{ lengthM: 1000, gradePct: 0 }, { lengthM: 1500, gradePct: 6 }]))).toHaveLength(1);
  });

  it('start and end indices point into the original track, gaps included', () => {
    const track = synthClimbTrack([
      { lengthM: 1000, gradePct: 0 },
      { lengthM: 2000, gradePct: 5 },
      { lengthM: 1000, gradePct: 0 },
    ]);
    // Los 10 primeros puntos sin altitud desplazan los índices del perfil respecto del track.
    const holed = track.map((p, i) => (i < 10 ? { ...p, ele: undefined } : p));
    const [c] = detectClimbs(holed);
    expect(c).toBeDefined();
    expect(holed[c.startIdx].lat).toBe(c.start.lat);
    expect(holed[c.startIdx].lng).toBe(c.start.lng);
    expect(holed[c.endIdx].lat).toBe(c.end.lat);
    expect(c.endIdx).toBeGreaterThan(c.startIdx);
  });
});
