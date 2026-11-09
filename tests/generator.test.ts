import { db } from '../src/db/db';
import { saveActivity } from '../src/db/repo';
import type { Coord3, StoredActivity, TrackPoint } from '../src/domain/types';
import { EARTH_RADIUS_M } from '../src/import/summary';
import { buildVisitedCells } from '../src/metrics/grid';
import { difficulty, type UserReference } from '../src/metrics/reference';
import type { Target } from '../src/metrics/score';
import { generateRoutes, type GenerateRequest } from '../src/routes/generator';
import { loadVisitedCells } from '../src/routes/history';
import { OrsError, type fetchRoundTrip, type OrsFeature } from '../src/routes/ors';

const START = { lat: 40.4168, lng: -3.7038 };
const TARGET: Target = { distanceM: 30000, elevGainM: null, preferNew: true };
const M_PER_DEG_LAT = (EARTH_RADIUS_M * Math.PI) / 180;

/** Recorrido recto hacia el norte de `distanceM`, que sube `gainM` hasta la mitad y baja después. */
function synthCoords(distanceM: number, gainM: number): Coord3[] {
  const at = (d: number, ele: number): Coord3 => [START.lng, START.lat + d / M_PER_DEG_LAT, ele];
  return [at(0, 600), at(distanceM / 2, 600 + gainM), at(distanceM, 600)];
}

/** Feature de ORS sintética: asfalto y carretera secundaria, salvo `unpavedM` de grava. */
function feature(o: { distanceM: number; gainM?: number; unpavedM?: number }): OrsFeature {
  const unpaved = o.unpavedM ?? 0;
  const surface = [{ value: 3, distance: o.distanceM - unpaved, amount: 100 - (unpaved / o.distanceM) * 100 }];
  if (unpaved > 0) surface.push({ value: 10, distance: unpaved, amount: (unpaved / o.distanceM) * 100 });
  return {
    geometry: { type: 'LineString', coordinates: synthCoords(o.distanceM, o.gainM ?? 200) },
    properties: {
      summary: { distance: o.distanceM, duration: 3600 },
      extras: {
        surface: { values: [[0, 2, 3]], summary: surface },
        waytypes: { values: [[0, 2, 2]], summary: [{ value: 2, distance: o.distanceM, amount: 100 }] },
        steepness: { values: [[0, 2, 0]], summary: [{ value: 0, distance: o.distanceM, amount: 100 }] },
      },
    },
  };
}

const noRoute = () => new OrsError('no_route', 'sin ruta', 2009);

/** `fetchRoundTrip` simulado: la respuesta de cada semilla sale de `bySeed` (feature o error). */
function fakeOrs(bySeed: (seed: number) => OrsFeature | Error) {
  return vi.fn<typeof fetchRoundTrip>(async (_key, r) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const out = bySeed(r.seed);
    if (out instanceof Error) throw out;
    return out;
  });
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

function run(req: Partial<GenerateRequest>, ors: ReturnType<typeof fakeOrs>, extra: { reference?: UserReference; visited?: Set<string> } = {}) {
  return generateRoutes(
    { start: START, target: TARGET, ...req },
    {
      apiKey: 'test-key',
      reference: extra.reference ?? null,
      visited: extra.visited ?? new Set(),
      seedBase: 0,
      fetchRoundTrip: ors,
    },
  );
}

describe('generateRoutes', () => {
  it('requests seeds sequentially with points 4', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const ors = vi.fn<typeof fetchRoundTrip>(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return feature({ distanceM: 30000 });
    });

    await generateRoutes(
      { start: START, target: TARGET, seeds: 3 },
      { apiKey: 'test-key', reference: null, visited: new Set(), seedBase: 10, fetchRoundTrip: ors },
    );

    expect(maxInFlight).toBe(1);
    expect(ors.mock.calls.map(([key, r]) => [key, r])).toEqual([
      ['test-key', { start: START, lengthM: 30000, points: 4, seed: 10 }],
      ['test-key', { start: START, lengthM: 30000, points: 4, seed: 11 }],
      ['test-key', { start: START, lengthM: 30000, points: 4, seed: 12 }],
    ]);
  });

  it('returns best count sorted by score', async () => {
    // Semillas 0 a 7: de 30 km a 33,5 km, cada una 500 m más lejos del objetivo.
    const ors = fakeOrs((seed) => feature({ distanceM: 30000 + seed * 500 }));
    const res = await run({}, ors);

    expect(ors).toHaveBeenCalledTimes(8);
    expect(res.requestsUsed).toBe(8);
    expect(res.routes.map((r) => r.seed)).toEqual([0, 1, 2, 3, 4]);
    const scores = res.routes.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(res.routes[0].newPct).toBe(100);
    expect(res.stoppedBy).toBeNull();
  });

  it('filters and reports rejected', async () => {
    const ors = fakeOrs((seed) => feature({ distanceM: 30000 + seed * 500, unpavedM: seed === 0 ? 300 : 0 }));
    const res = await run({ seeds: 3 }, ors);

    expect(res.rejected).toEqual([{ seed: 0, reason: 'sin asfaltar' }]);
    expect(res.routes.map((r) => r.seed)).toEqual([1, 2]);
  });

  it('dedupes identical loops', async () => {
    // 30.000 m y 30.020 m redondean a los mismos 100 m; 200 m y 203 m, a los mismos 10 m.
    const ors = fakeOrs((seed) => feature({ distanceM: 30000 + seed * 20, gainM: 200 + seed * 3 }));
    const res = await run({ seeds: 2 }, ors);

    expect(res.routes).toHaveLength(1);
  });

  it('all rejected returns no routes with reasons', async () => {
    const ors = fakeOrs(() => feature({ distanceM: 30000, unpavedM: 500 }));
    const res = await run({ seeds: 3 }, ors);

    expect(res.routes).toEqual([]);
    expect(res.rejected).toEqual([
      { seed: 0, reason: 'sin asfaltar' },
      { seed: 1, reason: 'sin asfaltar' },
      { seed: 2, reason: 'sin asfaltar' },
    ]);
    expect(res.stoppedBy).toBeNull();
  });

  it('rate limit mid-search keeps partial routes', async () => {
    const ors = fakeOrs((seed) =>
      seed === 2 ? new OrsError('rate_minute', 'minuto') : feature({ distanceM: 30000 + seed * 500 }),
    );
    const res = await run({ seeds: 5 }, ors);

    expect(ors).toHaveBeenCalledTimes(3);
    expect(res.routes.map((r) => r.seed)).toEqual([0, 1]);
    expect(res.stoppedBy?.kind).toBe('rate_minute');
    expect(res.requestsUsed).toBe(3);
  });

  it('error on first call throws', async () => {
    const ors = fakeOrs(() => new OrsError('unreachable', 'no responde'));
    await expect(run({ seeds: 3 }, ors)).rejects.toMatchObject({ kind: 'unreachable' });
    expect(ors).toHaveBeenCalledTimes(1);
  });

  it('no_route skips seed and continues', async () => {
    const ors = fakeOrs((seed) => (seed === 1 ? noRoute() : feature({ distanceM: 30000 + seed * 500 })));
    const res = await run({ seeds: 3 }, ors);

    expect(ors).toHaveBeenCalledTimes(3);
    expect(res.routes.map((r) => r.seed)).toEqual([0, 2]);
    expect(res.stoppedBy).toBeNull();
  });

  it('difficulty and time null without reference', async () => {
    const ors = fakeOrs(() => feature({ distanceM: 30000 }));
    const res = await run({ seeds: 1 }, ors);

    expect(res.routes[0].difficulty).toBeNull();
    expect(res.routes[0].estTimeS).toBeNull();
  });

  it('difficulty and time from reference', async () => {
    const ors = fakeOrs(() => feature({ distanceM: 30000, gainM: 400 }));
    const res = await run({ seeds: 1 }, ors, { reference });
    const route = res.routes[0];

    expect(route.difficulty).toBe(difficulty(route, reference));
    expect(route.difficulty).toBe('Dura');
    expect(route.estTimeS).toBeCloseTo(route.distanceM / reference.avgSpeedMs, 6);
  });

  it('new road percentage uses visited cells', async () => {
    const f = feature({ distanceM: 30000 });
    const track: TrackPoint[] = f.geometry.coordinates.map(([lng, lat], i) => ({ t: i, lat, lng }));
    const res = await run({ seeds: 1 }, fakeOrs(() => f), { visited: buildVisitedCells([track]) });

    expect(res.routes[0].newPct).toBe(0);
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
