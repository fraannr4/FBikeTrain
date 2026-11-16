import { db } from '../src/db/db';
import { saveActivity } from '../src/db/repo';
import type { Coord3, StoredActivity, TrackPoint } from '../src/domain/types';
import { EARTH_RADIUS_M } from '../src/import/summary';
import { buildVisitedCells } from '../src/metrics/grid';
import { difficulty, type UserReference } from '../src/metrics/reference';
import type { Target } from '../src/metrics/score';
import { analyzeRoute } from '../src/routes/analyze';
import { rateCandidate } from '../src/routes/generator';
import { loadVisitedCells } from '../src/routes/history';
import type { OrsFeature } from '../src/routes/ors';

// Casos de `rateCandidate` que ya cubría `generator.test.ts`, ahora sobre la función directamente.
const START = { lat: 40.4168, lng: -3.7038 };
const TARGET: Target = { distanceM: 30000, elevGainM: null, preferNew: true };
const M_PER_DEG_LAT = (EARTH_RADIUS_M * Math.PI) / 180;

/** Recorrido recto de `distanceM` hacia el norte, que sube `gainM` hasta la mitad y baja después. */
function synthCoords(distanceM: number, gainM: number): Coord3[] {
  const at = (d: number, ele: number): Coord3 => [START.lng, START.lat + d / M_PER_DEG_LAT, ele];
  return [at(0, 600), at(distanceM / 2, 600 + gainM), at(distanceM, 600)];
}

/** Feature de ORS sintética: asfalto y carretera secundaria, salvo `mainM` de carretera principal. */
function feature(o: { distanceM: number; gainM?: number; mainM?: number }): OrsFeature {
  const main = o.mainM ?? 0;
  const waytypes = [{ value: 2, distance: o.distanceM - main, amount: 100 - (main / o.distanceM) * 100 }];
  if (main > 0) waytypes.push({ value: 1, distance: main, amount: (main / o.distanceM) * 100 });
  return {
    geometry: { type: 'LineString', coordinates: synthCoords(o.distanceM, o.gainM ?? 200) },
    properties: {
      summary: { distance: o.distanceM, duration: 3600 },
      extras: {
        surface: { values: [[0, 2, 3]], summary: [{ value: 3, distance: o.distanceM, amount: 100 }] },
        waytypes: { values: [[0, 2, 2]], summary: waytypes },
        steepness: { values: [[0, 2, 0]], summary: [{ value: 0, distance: o.distanceM, amount: 100 }] },
      },
    },
  };
}

const reference: UserReference = {
  source: 'history',
  weeks: 8,
  rides: 6,
  ridesPerWeek: 0.75,
  avgDistanceM: 30000,
  avgElevGainM: 300,
  avgMovingTimeS: 4000,
  avgSpeedMs: 7.5,
  longestDistanceM: 50000,
  maxElevGainM: 800,
};

describe('rateCandidate', () => {
  it('puntúa una candidata con la carretera nueva y la referencia', () => {
    const c = analyzeRoute(feature({ distanceM: 30000 }), 0);
    const rated = rateCandidate(c, TARGET, { reference, visited: new Set() });
    expect(rated.newPct).toBe(100);
    expect(rated.score).toBeGreaterThan(0.9);
    expect(rated.estTimeS).toBeCloseTo(30000 / reference.avgSpeedMs);
  });

  it('sin referencia, sin dificultad ni tiempo', () => {
    const rated = rateCandidate(analyzeRoute(feature({ distanceM: 30000 }), 0), TARGET, { reference: null, visited: new Set() });
    expect(rated.difficulty).toBeNull();
    expect(rated.estTimeS).toBeNull();
  });

  it('dificultad y tiempo según la referencia', () => {
    const rated = rateCandidate(analyzeRoute(feature({ distanceM: 30000, gainM: 400 }), 0), TARGET, { reference, visited: new Set() });
    expect(rated.difficulty).toBe(difficulty(rated, reference));
    expect(rated.difficulty).toBe('Dura');
    expect(rated.estTimeS).toBeCloseTo(rated.distanceM / reference.avgSpeedMs, 6);
  });

  it('la carretera nueva usa las celdas ya recorridas', () => {
    const f = feature({ distanceM: 30000 });
    const track: TrackPoint[] = f.geometry.coordinates.map(([lng, lat], i) => ({ t: i, lat, lng }));
    expect(rateCandidate(analyzeRoute(f, 0), TARGET, { reference: null, visited: buildVisitedCells([track]) }).newPct).toBe(0);
  });

  it('prefiere menos carretera principal entre dos candidatas parecidas', () => {
    const deps = { reference: null, visited: new Set<string>() };
    const main = rateCandidate(analyzeRoute(feature({ distanceM: 30000, mainM: 5700 }), 0), TARGET, deps);
    const quiet = rateCandidate(analyzeRoute(feature({ distanceM: 30000, mainM: 300 }), 1), TARGET, deps);
    expect(quiet.score).toBeGreaterThan(main.score);
  });

  it('avisa y penaliza un tramo de ida y vuelta frente a una vuelta simple igual de larga', () => {
    const at = (x: number, y: number): Coord3 => [START.lng + x / (M_PER_DEG_LAT * Math.cos(START.lat * Math.PI / 180)), START.lat + y / M_PER_DEG_LAT, 600];
    const spur = feature({ distanceM: 30000 });
    spur.geometry.coordinates = [[0, 0], [0, 1000], [0, 0], [7000, 0], [7000, 7000], [0, 7000], [0, 0]].map(([x, y]) => at(x, y));
    const loop = feature({ distanceM: 30000 });
    loop.geometry.coordinates = [[0, 0], [7500, 0], [7500, 7500], [0, 7500], [0, 0]].map(([x, y]) => at(x, y));
    const deps = { reference: null, visited: new Set<string>() };
    const ratedSpur = rateCandidate(analyzeRoute(spur, 0), TARGET, deps);
    const ratedLoop = rateCandidate(analyzeRoute(loop, 1), TARGET, deps);
    expect(ratedSpur.warning).toMatch(/ida y vuelta/);
    expect(ratedLoop.warning).toBeUndefined();
    expect(ratedLoop.score).toBeGreaterThan(ratedSpur.score);
  });
});

describe('loadVisitedCells', () => {
  beforeEach(async () => {
    await db.activities.clear();
    await db.tracks.clear();
  });

  const activity = (id: string, hasTrack: boolean): StoredActivity => ({
    id,
    startTime: Date.UTC(2026, 9, 1),
    sport: 'cycling',
    totals: { distanceM: 1000, movingTimeS: 200, elapsedTimeS: 200, elevGainM: 0, avgSpeedMs: 5, maxSpeedMs: 6 },
    hasTrack,
    source: 'gpx',
    importedAt: 0,
  });

  it('is empty without history', async () => {
    expect((await loadVisitedCells()).size).toBe(0);
  });

  it('collects cells of every stored track', async () => {
    const a: TrackPoint[] = [
      { t: 0, lat: 40.4168, lng: -3.7038 },
      { t: 1, lat: 40.4268, lng: -3.7038 },
    ];
    const b: TrackPoint[] = [
      { t: 0, lat: 41.0, lng: 2.0 },
      { t: 1, lat: 41.0, lng: 2.01 },
    ];
    await saveActivity(activity('a', true), a);
    await saveActivity(activity('b', true), b);
    await saveActivity(activity('c', false), []);

    expect(await loadVisitedCells()).toEqual(buildVisitedCells([a, b]));
  });
});
