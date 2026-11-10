import { db } from '../src/db/db';
import { saveActivity } from '../src/db/repo';
import type { Coord3, StoredActivity, TrackPoint } from '../src/domain/types';
import { EARTH_RADIUS_M } from '../src/import/summary';
import { buildVisitedCells } from '../src/metrics/grid';
import { difficulty, type UserReference } from '../src/metrics/reference';
import type { Target } from '../src/metrics/score';
import { AIM_FRACTION, INITIAL_ROAD_FACTOR, SEARCH_REQUEST_BUDGET, generateRoutes, type GenerateRequest } from '../src/routes/generator';
import { loadVisitedCells } from '../src/routes/history';
import { OrsError, type fetchRoundTrip, type OrsFeature } from '../src/routes/ors';

const START = { lat: 40.4168, lng: -3.7038 };
const TARGET: Target = { distanceM: 30000, elevGainM: null, preferNew: true };
const M_PER_DEG_LAT = (EARTH_RADIUS_M * Math.PI) / 180;

/** Recorrido recto de `distanceM` hacia el lado `side` (0 norte, 2 este...), que sube `gainM` hasta la mitad y baja después. */
function synthCoords(distanceM: number, gainM: number, side = 0): Coord3[] {
  const b = (side * 45 * Math.PI) / 180;
  const kx = Math.cos((START.lat * Math.PI) / 180);
  const at = (d: number, ele: number): Coord3 => [START.lng + (d * Math.sin(b)) / (M_PER_DEG_LAT * kx), START.lat + (d * Math.cos(b)) / M_PER_DEG_LAT, ele];
  return [at(0, 600), at(distanceM / 2, 600 + gainM), at(distanceM, 600)];
}

/** Feature de ORS sintética: asfalto y carretera secundaria, salvo `unpavedM` de grava. */
function feature(o: { distanceM: number; gainM?: number; unpavedM?: number; side?: number }): OrsFeature {
  const unpaved = o.unpavedM ?? 0;
  const surface = [{ value: 3, distance: o.distanceM - unpaved, amount: 100 - (unpaved / o.distanceM) * 100 }];
  if (unpaved > 0) surface.push({ value: 10, distance: unpaved, amount: (unpaved / o.distanceM) * 100 });
  return {
    geometry: { type: 'LineString', coordinates: synthCoords(o.distanceM, o.gainM ?? 200, o.side) },
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
  it('stops as soon as enough distinct routes have arrived', async () => {
    const ors = fakeOrs(seed => feature({ distanceM: 30000 + seed * 500, side: seed }));
    const res = await run({ count: 2 }, ors);
    expect(res.requestsUsed).toBe(2);
  });

  it('two routes towards the same side do not stop the search', async () => {
    const ors = fakeOrs(seed => feature({ distanceM: 30000 - seed * 500, side: seed < 2 ? 0 : 4 }));
    const res = await run({ count: 2 }, ors);
    expect(res.requestsUsed).toBe(3);
    expect(res.routes.map((r) => r.seed)).toEqual([0, 2]);
  });

  it('bounds even an unsuccessful search below the shared eight-call quota and preserves fallback', async () => {
    const ors = fakeOrs(() => feature({ distanceM: 30000, unpavedM: 500 }));
    const res = await run({}, ors);
    expect(res.requestsUsed).toBeLessThan(8);
    expect(res.routes).toHaveLength(1);
    expect(res.routes[0].warning).toBeDefined();
  });

  it('clamps an oversized explicit budget including no_route and 5xx responses', async () => {
    const ors = fakeOrs(seed => seed % 2 ? noRoute() : new OrsError('server', 'ORS 500'));
    await expect(run({ seeds: 100 }, ors)).rejects.toThrow('ORS 500');
    expect(ors).toHaveBeenCalledTimes(SEARCH_REQUEST_BUDGET);
  });

  it('duplicates do not count as sufficient routes', async () => {
    const res = await run({ count: 2 }, fakeOrs(seed => feature({ distanceM: seed < 3 ? 30000 : 31000, side: seed < 3 ? 0 : 2 })));
    expect(res.requestsUsed).toBe(4);
    expect(res.routes).toHaveLength(2);
  });

  it('prefers a simple loop to an equally long route with an out-and-back spur', async () => {
    const at = (x: number, y: number): Coord3 => [START.lng + x / (M_PER_DEG_LAT * Math.cos(START.lat * Math.PI / 180)), START.lat + y / M_PER_DEG_LAT, 600];
    const ors = fakeOrs(seed => {
      const f = feature({ distanceM: 30000 });
      f.geometry.coordinates = seed === 0
        ? [[0,0], [0,1000], [0,0], [7000,0], [7000,7000], [0,7000], [0,0]].map(([x,y]) => at(x,y))
        : [[0,0], [7500,0], [7500,7500], [0,7500], [0,0]].map(([x,y]) => at(x,y));
      return f;
    });
    const res = await run({ seeds: 2, count: 1 }, ors);
    expect(res.routes[0].seed).toBe(1);
  });

  it('preserves both the road and geometry warnings on a last-resort route', async () => {
    const ors = fakeOrs(() => {
      const f = feature({ distanceM: 30000, unpavedM: 500 });
      f.geometry.coordinates.push(...f.geometry.coordinates.slice(0, -1).reverse());
      return f;
    });
    const res = await run({ seeds: 1, target: { ...TARGET, distanceM: 60000 } }, ors);
    expect(res.routes).toHaveLength(1);
    expect(res.routes[0].warning).toContain('0,5 km');
    expect(res.routes[0].warning).toContain('ida y vuelta');
  });
  it('requests seeds sequentially with points 4 and corrects the length ORS overshoots', async () => {
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
    const calls = ors.mock.calls.map(([key, r]) => ({ key, seed: r.seed, points: r.points, lengthM: r.lengthM }));
    expect(calls.map((c) => [c.key, c.seed, c.points])).toEqual([['test-key', 10, 4], ['test-key', 11, 4], ['test-key', 12, 4]]);
    // Primera: 94 % de 30 km sobre el factor inicial; ORS se pasa, así que las siguientes piden menos.
    expect(calls[0].lengthM).toBeCloseTo((30000 * AIM_FRACTION) / INITIAL_ROAD_FACTOR, 6);
    expect(calls[1].lengthM).toBeLessThan(calls[0].lengthM);
  });

  it('aims a little under the target once the road factor is known', async () => {
    // Carretera real 1,4 veces el círculo pedido: la segunda vuelta ya cae en el objetivo rebajado.
    const ors = vi.fn<typeof fetchRoundTrip>(async (_k, r) => feature({ distanceM: Math.round(r.lengthM * 1.4) }));
    const res = await generateRoutes(
      { start: START, target: TARGET, count: 3, seeds: 3 },
      { apiKey: 'k', reference: null, visited: new Set(), seedBase: 0, fetchRoundTrip: ors },
    );
    const lengths = ors.mock.results.length;
    expect(lengths).toBe(3);
    for (const r of res.routes) expect(r.distanceM).toBeLessThanOrEqual(30000 * 1.08);
    // La mejor es una de las ya corregidas, por debajo de los 30 km.
    expect(res.routes[0].distanceM).toBeLessThan(30000);
    expect(res.routes[0].distanceM).toBeGreaterThan(30000 * 0.85);
  });

  it('proposes routes towards different sides before a second one on the same side', async () => {
    // Semillas 0 y 1 al norte (la 0 puntúa más); la 2 al este, algo peor de longitud.
    const ors = fakeOrs((seed) => feature({ distanceM: [28200, 28000, 26000][seed] ?? 1, side: seed === 2 ? 2 : 0 }));
    const res = await run({ count: 2, seeds: 3 }, ors);
    expect(res.routes.map((r) => Math.round(r.distanceM))).toEqual([28200, 26000]);
  });

  it('prefers a route slightly short over one slightly long', async () => {
    const ors = fakeOrs((seed) => feature({ distanceM: seed === 0 ? 31800 : 28200 }));
    const res = await generateRoutes(
      { start: START, target: TARGET, count: 2, seeds: 2 },
      { apiKey: 'k', reference: null, visited: new Set(), seedBase: 0, fetchRoundTrip: ors },
    );
    expect(res.routes.map((r) => Math.round(r.distanceM))).toEqual([28200, 31800]);
  });

  it('returns best count sorted by score', async () => {
    // Semillas 0 a 5, cada una hacia otro lado y 500 m más lejos del objetivo, por debajo de él.
    const ors = fakeOrs((seed) => feature({ distanceM: 30000 - seed * 500, side: seed }));
    const res = await run({}, ors);

    expect(ors).toHaveBeenCalledTimes(5);
    expect(res.requestsUsed).toBe(5);
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

  it('discards a loop that uses a motorway and keeps one on a primary road', async () => {
    const ors = fakeOrs((seed) => {
      const f = feature({ distanceM: 30000 + seed * 500 });
      // waycategory: campo de bits de ORS, 1 = autopista. La nacional (primary) no lleva ese bit.
      f.properties.extras.waycategory = { values: [[0, 1, 0], [1, 2, seed === 0 ? 1 : 0]], summary: [{ value: seed === 0 ? 1 : 0, distance: 1000, amount: 3 }] };
      if (seed === 1) f.properties.extras.waytypes = { values: [[0, 2, 1]], summary: [{ value: 1, distance: 3000, amount: 10 }, { value: 2, distance: 27500, amount: 90 }] };
      return f;
    });
    const res = await run({ seeds: 2 }, ors);

    expect(res.rejected).toEqual([{ seed: 0, reason: 'autopista' }]);
    expect(res.routes.map((r) => r.seed)).toEqual([1]);
  });

  it('dedupes identical loops', async () => {
    // 30.000 m y 30.020 m redondean a los mismos 100 m; 200 m y 203 m, a los mismos 10 m.
    const ors = fakeOrs((seed) => feature({ distanceM: 30000 + seed * 20, gainM: 200 + seed * 3 }));
    const res = await run({ seeds: 2 }, ors);

    expect(res.routes).toHaveLength(1);
  });

  it('sin ninguna limpia conserva el presupuesto y enseña la más cercana con aviso', async () => {
    const ors = fakeOrs(() => feature({ distanceM: 30000, unpavedM: 500 }));
    const res = await run({ seeds: 3 }, ors);

    expect(res.requestsUsed).toBe(3);
    expect(res.rejected).toHaveLength(3);
    expect(res.rejected[0]).toEqual({ seed: 0, reason: 'sin asfaltar' });
    expect(res.routes).toHaveLength(1); // tres iguales: una tras quitar duplicados
    expect(res.routes[0].warning).toBe('Incluye 0,5 km de pista o sin asfaltar.');
    expect(res.stoppedBy).toBeNull();
  });

  it('no enseña como último recurso vueltas con mucha pista', async () => {
    const res = await run({ seeds: 2 }, fakeOrs(() => feature({ distanceM: 30000, unpavedM: 3500 })));
    expect(res.routes).toEqual([]);
    expect(res.rejected).toHaveLength(2);
  });

  it('un fallo suelto del motor (5xx) no corta la búsqueda', async () => {
    const res = await run({ seeds: 3 }, fakeOrs((seed) => (seed === 0 ? new OrsError('server', 'ORS 500') : feature({ distanceM: 30000 + seed * 500 }))));
    expect(res.routes).toHaveLength(2);
    expect(res.routes.every((r) => r.warning === undefined)).toBe(true);
  });

  it('si todas las semillas fallan en el motor, lanza el error', async () => {
    await expect(run({ seeds: 2 }, fakeOrs(() => new OrsError('server', 'ORS 500')))).rejects.toThrow('ORS 500');
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
