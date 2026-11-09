import { readFileSync } from 'node:fs';
import type { OrsExtra, OrsFeature } from '../src/routes/ors';
import { analyzeRoute, rejectReason, type RouteCandidate } from '../src/routes/analyze';

const extra = (summary: [value: number, distance: number, amount: number][] = [], values: [number, number, number][] = []): OrsExtra => ({
  values,
  summary: summary.map(([value, distance, amount]) => ({ value, distance, amount })),
});

/** Tres puntos separados 0,009° de latitud (~1 km cada tramo), alturas 100, 104 y 108. */
function feature(extras: Partial<OrsFeature['properties']['extras']> = {}): OrsFeature {
  return {
    geometry: {
      type: 'LineString',
      coordinates: [
        [-3.7, 40.0, 100],
        [-3.7, 40.009, 104],
        [-3.7, 40.018, 108],
      ],
    },
    properties: {
      summary: { distance: 9999, duration: 600, ascent: 999 },
      extras: { surface: extra(), waytypes: extra(), steepness: extra(), ...extras },
    },
  };
}

const candidate = (over: Partial<RouteCandidate>): RouteCandidate => ({ ...analyzeRoute(feature(), 1), ...over });

describe('analyzeRoute', () => {
  it('distance and gain computed from coords', () => {
    const c = analyzeRoute(feature(), 4);
    expect(c.distanceM).toBeGreaterThan(1990);
    expect(c.distanceM).toBeLessThan(2010);
    expect(c.elevGainM).toBe(8);
    expect(c.seed).toBe(4);
    expect(c.id).toBe(`4-${Math.round(c.distanceM)}`);
  });

  it('gain ignores noise below hysteresis', () => {
    const f = feature();
    f.geometry.coordinates = [
      [-3.7, 40.0, 100],
      [-3.7, 40.001, 102],
      [-3.7, 40.002, 100],
      [-3.7, 40.003, 102],
    ];
    expect(analyzeRoute(f, 1).elevGainM).toBe(0);
  });

  it('unpaved meters from surface summary', () => {
    const c = analyzeRoute(feature({ surface: extra([[3, 1850, 92.5], [10, 150, 7.5]]) }), 1);
    expect(c.unpavedM).toBe(150);
    expect(rejectReason(c, c.distanceM)).toBe('sin asfaltar');
  });

  it('cobblestone and unknown are not unpaved', () => {
    const c = analyzeRoute(feature({ surface: extra([[5, 500, 25], [0, 300, 15], [3, 1200, 60]]) }), 1);
    expect(c.unpavedM).toBe(0);
    expect(c.unknownSurfacePct).toBe(15);
    expect(rejectReason(c, c.distanceM)).toBeNull();
  });

  it('state road over 20 % rejected', () => {
    const over = analyzeRoute(feature({ waytypes: extra([[1, 500, 25], [2, 1500, 75]]) }), 1);
    expect(over.mainRoadPct).toBe(25);
    expect(rejectReason(over, over.distanceM)).toBe('carretera principal');

    const limit = analyzeRoute(feature({ waytypes: extra([[1, 400, 20], [2, 1600, 80]]) }), 1);
    expect(rejectReason(limit, limit.distanceM)).toBeNull();
  });

  it('track over 100 m rejected as pistas', () => {
    const c = analyzeRoute(feature({ waytypes: extra([[5, 120, 6], [2, 1880, 94]]) }), 1);
    expect(c.trackM).toBe(120);
    expect(rejectReason(c, c.distanceM)).toBe('pistas');

    const limit = analyzeRoute(feature({ waytypes: extra([[5, 100, 5], [2, 1900, 95]]) }), 1);
    expect(rejectReason(limit, limit.distanceM)).toBeNull();
  });

  it('unpaved at 100 m is still accepted', () => {
    expect(rejectReason(candidate({ unpavedM: 100 }), candidate({}).distanceM)).toBeNull();
  });

  it('rejects candidate 30% longer than target', () => {
    expect(rejectReason(candidate({ distanceM: 39_000 }), 30_000)).toBe('longitud');
    expect(rejectReason(candidate({ distanceM: 21_000 }), 30_000)).toBe('longitud');
    expect(rejectReason(candidate({ distanceM: 37_500 }), 30_000)).toBeNull();
  });

  it('steep segments map point indices to meters', () => {
    const c = analyzeRoute(feature({ steepness: extra([], [[0, 1, 0], [1, 2, 3]]) }), 1);
    expect(c.steep).toHaveLength(2);
    expect(c.steep[0]).toEqual({ fromM: 0, toM: c.profile[1].dM, cls: 0 });
    expect(c.steep[1]).toEqual({ fromM: c.profile[1].dM, toM: c.distanceM, cls: 3 });
    expect(c.maxSteepCls).toBe(3);
  });

  it('profile has cumulative distance and elevation per point', () => {
    const c = analyzeRoute(feature(), 1);
    expect(c.profile.map((p) => p.ele)).toEqual([100, 104, 108]);
    expect(c.profile[0].dM).toBe(0);
    expect(c.profile[2].dM).toBe(c.distanceM);
    expect(c.coords).toHaveLength(3);
  });
});

describe('analyzeRoute with fixture', () => {
  it('fixture analyzes without NaN', () => {
    const fc = JSON.parse(readFileSync('tests/fixtures/ors/round-trip-ok.json', 'utf8')) as { features: OrsFeature[] };
    const c = analyzeRoute(fc.features[0], 1);
    const numbers = [
      c.distanceM,
      c.elevGainM,
      c.unpavedM,
      c.trackM,
      c.mainRoadPct,
      c.unknownSurfacePct,
      c.maxSteepCls,
      ...c.steep.flatMap((s) => [s.fromM, s.toM, s.cls]),
      ...c.profile.flatMap((p) => [p.dM, p.ele]),
    ];
    expect(numbers.every(Number.isFinite)).toBe(true);
    expect(c.profile.length).toBe(c.coords.length);
    expect(c.steep.length).toBeGreaterThan(0);
    expect(rejectReason(c, 30_000)).toBeNull();
  });
});
