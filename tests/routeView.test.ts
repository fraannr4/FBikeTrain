import type { Coord3, LatLng } from '../src/domain/types';
import type { UserReference } from '../src/metrics/reference';
import type { GeneratedRoute } from '../src/routes/generator';
import {
  defaultTarget,
  elevationFor,
  levelOf,
  nameRoutes,
  rejectSummary,
  renewsAt,
  routeName,
  toCardData,
} from '../src/ui/routes/routeView';

// Inicio sintético: la Puerta del Sol (punto público), nunca «Casa».
const SOL: LatLng = { lat: 40.4168, lng: -3.7038 };
const KM_LAT = 1 / 111.32;
const KM_LNG = 1 / (111.32 * Math.cos((SOL.lat * Math.PI) / 180));

/** Lazo de radio `r` km cuyo centro está a `dx`, `dy` km del inicio. */
function loop(dxKm: number, dyKm: number, rKm = 3, n = 60): Coord3[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const x = dxKm + Math.cos(t) * rKm;
    const y = dyKm + Math.sin(t) * rKm;
    return [SOL.lng + x * KM_LNG, SOL.lat + y * KM_LAT, 600 + i];
  });
}

function ref(over: Partial<UserReference> = {}): UserReference {
  return {
    source: 'history',
    weeks: 8,
    rides: 10,
    ridesPerWeek: 1.25,
    avgDistanceM: 50_000,
    avgElevGainM: 800,
    avgMovingTimeS: 7200,
    avgSpeedMs: 7,
    longestDistanceM: 90_000,
    maxElevGainM: 1600,
    ...over,
  };
}

function route(over: Partial<GeneratedRoute> = {}): GeneratedRoute {
  return {
    id: 'r1',
    seed: 1,
    coords: loop(0, 8),
    distanceM: 62_400,
    elevGainM: 849.6,
    unpavedM: 0,
    trackM: 0,
    mainRoadPct: 0,
    unknownSurfacePct: 0,
    motorway: false,
    steep: [{ fromM: 0, toM: 62_400, cls: 1 }],
    profile: [
      { dM: 0, ele: 600 },
      { dM: 62_400, ele: 640 },
    ],
    maxSteepCls: 1,
    newPct: 74.4,
    score: 0.8,
    difficulty: 'Media',
    estTimeS: 9000,
    ...over,
  };
}

describe('routeName', () => {
  it('names the loop by the side of the start where it goes', () => {
    expect(routeName(loop(0, 8), SOL)).toBe('Vuelta por el norte');
    expect(routeName(loop(8, 0), SOL)).toBe('Vuelta por el este');
    expect(routeName(loop(-6, -6), SOL)).toBe('Vuelta por el suroeste');
    expect(routeName(loop(6, 6), SOL)).toBe('Vuelta por el noreste');
  });

  it('a loop around the start is a loop around it', () => {
    expect(routeName(loop(0, 0, 6), SOL)).toBe('Vuelta alrededor del inicio');
  });

  it('two loops to the same side get a number', () => {
    const names = nameRoutes([route({ coords: loop(0, 8) }), route({ coords: loop(1, 9) }), route({ coords: loop(8, 0) })], SOL);
    expect(names).toEqual(['Vuelta por el norte', 'Vuelta por el norte 2', 'Vuelta por el este']);
  });
});

describe('toCardData', () => {
  it('passes figures, shape and profile to the card', () => {
    const c = toCardData(route(), 'Vuelta por el norte');
    expect(c).toMatchObject({
      id: 'r1',
      name: 'Vuelta por el norte',
      distanceM: 62_400,
      elevGainM: 849.6,
      estTimeS: 9000,
      difficulty: 'Media',
      newPct: 74.4,
      kind: 'circular',
    });
    expect(c.shape[0]).toEqual({ lat: SOL.lat + 8 * KM_LAT, lng: SOL.lng + 3 * KM_LNG });
    expect(c.profile).toHaveLength(2);
  });
});

describe('rejectSummary', () => {
  it('counts the reasons, most frequent first', () => {
    const rejected = [
      ...Array.from({ length: 3 }, (_, i) => ({ seed: i, reason: 'carretera principal' as const })),
      ...Array.from({ length: 5 }, (_, i) => ({ seed: 10 + i, reason: 'sin asfaltar' as const })),
    ];
    expect(rejectSummary(rejected)).toBe(
      'Ninguna candidata pasa el filtro de carretera: 5 sin asfaltar, 3 carretera principal. Prueba otra distancia u otro inicio.',
    );
  });

  it('names tracks and length in plain words', () => {
    expect(
      rejectSummary([
        { seed: 1, reason: 'pistas' },
        { seed: 2, reason: 'longitud' },
      ]),
    ).toBe('Ninguna candidata pasa el filtro de carretera: 1 con pistas, 1 de otra longitud. Prueba otra distancia u otro inicio.');
  });

  it('names motorways in plain words', () => {
    expect(rejectSummary([{ seed: 1, reason: 'autopista' }])).toBe(
      'Ninguna candidata pasa el filtro de carretera: 1 con autopista. Prueba otra distancia u otro inicio.',
    );
  });

  it('without candidates says that ORS found no roads', () => {
    expect(rejectSummary([])).toBe('ORS no encuentra carreteras desde ese punto. Mueve el inicio a una carretera.');
  });
});

describe('defaultTarget', () => {
  it('is the reference plus 10 %, in steps of 5 km', () => {
    expect(defaultTarget(ref()).distanceM).toBe(55_000);
    expect(defaultTarget(ref({ avgDistanceM: 74_000 })).distanceM).toBe(80_000);
  });

  it('stays between 10 and 200 km', () => {
    expect(defaultTarget(ref({ avgDistanceM: 4_000 })).distanceM).toBe(10_000);
    expect(defaultTarget(ref({ avgDistanceM: 250_000 })).distanceM).toBe(200_000);
  });

  it('asks for your average climbing and new road', () => {
    expect(defaultTarget(ref())).toEqual({ distanceM: 55_000, elevGainM: 800, preferNew: true });
  });

  it('without reference, 50 km of a medium ride', () => {
    expect(defaultTarget(null)).toEqual({ distanceM: 50_000, elevGainM: 700, preferNew: true });
  });
});

describe('levelOf and elevationFor', () => {
  it('with reference, the level is the one of the cards', () => {
    expect(levelOf({ distanceM: 40_000, elevGainM: 500 }, ref())).toBe('Suave');
    expect(levelOf({ distanceM: 50_000, elevGainM: 800 }, ref())).toBe('Media');
    expect(levelOf({ distanceM: 50_000, elevGainM: 1200 }, ref())).toBe('Dura');
  });

  it('without reference, metres per km decide', () => {
    expect(levelOf({ distanceM: 50_000, elevGainM: 500 }, null)).toBe('Suave');
    expect(levelOf({ distanceM: 50_000, elevGainM: 700 }, null)).toBe('Media');
    expect(levelOf({ distanceM: 50_000, elevGainM: 1000 }, null)).toBe('Dura');
  });

  it('choosing a level gives a climbing of that level', () => {
    for (const level of ['Suave', 'Media', 'Dura'] as const) {
      const elev = elevationFor(level, 50_000, ref());
      expect(levelOf({ distanceM: 40_000, elevGainM: elev }, ref())).toBe(level);
      const generic = elevationFor(level, 50_000, null);
      expect(levelOf({ distanceM: 50_000, elevGainM: generic }, null)).toBe(level);
    }
  });

  it('climbing stays between 0 and 4.000 m', () => {
    expect(elevationFor('Dura', 200_000, null)).toBe(4000);
  });
});

describe('renewsAt', () => {
  it('says when the daily quota comes back, 24 h after the first query', () => {
    // 01:00 y 09:40 en Madrid (UTC+1 en noviembre).
    // Si la renovación cae el mismo día de Madrid que ahora, solo la hora.
    expect(renewsAt(Date.parse('2026-11-06T00:00:00Z'), Date.parse('2026-11-06T23:30:00Z'))).toBe('a la 1:00');
    expect(renewsAt(Date.parse('2026-11-05T08:40:00Z'), Date.parse('2026-11-06T07:00:00Z'))).toBe('a las 9:40');
  });

  it('says tomorrow when the quota comes back on another day in Madrid', () => {
    // Cuota agotada a las 9:53 con la ventana abierta a las 8:47: vuelve mañana a las 8:47.
    const windowStart = Date.parse('2026-11-06T07:47:00Z');
    expect(renewsAt(windowStart, Date.parse('2026-11-06T08:53:00Z'))).toBe('mañana a las 8:47');
    // A las 23:30 de Madrid (22:30 UTC) la 1:00 de la renovación ya es de mañana.
    expect(renewsAt(Date.parse('2026-11-06T00:00:00Z'), Date.parse('2026-11-06T22:30:00Z'))).toBe('mañana a la 1:00');
  });
});
