import {
  buildLevelSummary,
  climbsInWindow,
  DECLARED_REFERENCE_KEY,
  loadDeclaredReference,
  referenceFromAnswers,
  resolveReference,
  saveDeclaredReference,
  type InitialAnswers,
  type LevelSummary,
} from '../src/ai/levelSummary';
import { db } from '../src/db/db';
import type { ClimbEffort, StoredActivity } from '../src/domain/types';
import { LONG_WINDOW_WEEKS, MIN_RIDES, SHORT_WINDOW_WEEKS, type UserReference } from '../src/metrics/reference';

const DAY_MS = 86_400_000;
// Viernes 6 de noviembre de 2026, 12:00 en Madrid (UTC+1, ya en horario de invierno).
const NOW = Date.parse('2026-11-06T11:00:00Z');

function historyRef(over: Partial<UserReference> = {}): UserReference {
  return {
    source: 'history',
    weeks: SHORT_WINDOW_WEEKS,
    rides: MIN_RIDES,
    ridesPerWeek: MIN_RIDES / SHORT_WINDOW_WEEKS,
    avgDistanceM: 48_237,
    avgElevGainM: 512.6,
    avgMovingTimeS: 7_062,
    avgSpeedMs: 6.83,
    longestDistanceM: 91_449,
    maxElevGainM: 1_403.4,
    ...over,
  };
}

let effortSeq = 0;
function effort(over: Partial<ClimbEffort> = {}): ClimbEffort {
  effortSeq += 1;
  return {
    id: `a${effortSeq}_0`,
    activityId: `a${effortSeq}`,
    activityStart: NOW - DAY_MS,
    startIdx: 0,
    endIdx: 10,
    start: { lat: 41.1, lng: 2.1 },
    end: { lat: 41.2, lng: 2.2 },
    startDistM: 0,
    lengthM: 2_000,
    gainM: 120,
    avgGradePct: 6,
    timeS: 480,
    avgSpeedMs: 4.2,
    vamMh: 900,
    ...over,
  };
}

let rideSeq = 0;
function ride(startTime: number, hasTrack = true): StoredActivity {
  rideSeq += 1;
  return {
    id: `r${rideSeq}`,
    startTime,
    sport: 'cycling',
    name: 'Salida sintética',
    totals: {
      distanceM: 40_000,
      movingTimeS: 5_000,
      elapsedTimeS: 5_000,
      elevGainM: 400,
      avgSpeedMs: 8,
      maxSpeedMs: 15,
    },
    hasTrack,
    source: 'gpx',
    importedAt: 0,
  };
}

const ANSWERS: InitialAnswers = { kmPorSalida: 40, desnivelPorSalidaM: 400, velocidadMediaKmh: 22 };

const SUMMARY_KEYS: (keyof LevelSummary)[] = [
  'fuente',
  'semanas',
  'salidas',
  'salidasPorSemana',
  'distanciaMediaKm',
  'desnivelMedioM',
  'tiempoMedioMin',
  'velocidadMediaKmh',
  'distanciaMaxKm',
  'desnivelMaxM',
  'vamMediaMh',
  'subidaMasLarga',
];

describe('buildLevelSummary', () => {
  it('summary rounds figures', () => {
    const s = buildLevelSummary(historyRef(), []);
    expect(s.distanciaMediaKm).toBe(48.2);
    expect(s.velocidadMediaKmh).toBe(24.6);
    expect(s.desnivelMedioM).toBe(513);
    expect(s.tiempoMedioMin).toBe(118);
    expect(s.distanciaMaxKm).toBe(91.4);
    expect(s.desnivelMaxM).toBe(1_403);
    expect(s.salidas).toBe(MIN_RIDES);
    expect(s.salidasPorSemana).toBe(0.6);
    expect(s.semanas).toBe(SHORT_WINDOW_WEEKS);
    expect(s.fuente).toBe('historial');
  });

  it('summary has no coordinates', () => {
    const s = buildLevelSummary(historyRef(), [effort(), effort({ lengthM: 5_000 })]);
    const json = JSON.stringify(s);
    for (const word of ['lat', 'lng', 'lon', 'coord']) expect(json).not.toContain(word);
    expect(Object.keys(s).sort()).toEqual([...SUMMARY_KEYS].sort());
  });

  it('vam and longest climb from climbs', () => {
    const s = buildLevelSummary(historyRef(), [
      effort({ vamMh: 800, lengthM: 3_250, avgGradePct: 5.44 }),
      effort({ vamMh: 1_000, lengthM: 1_200, avgGradePct: 8.1 }),
    ]);
    expect(s.vamMediaMh).toBe(900);
    expect(s.subidaMasLarga).toEqual({ km: 3.3, pendienteMediaPct: 5.4 });
  });

  it('no climbs gives nulls', () => {
    const s = buildLevelSummary(historyRef(), []);
    expect(s.vamMediaMh).toBeNull();
    expect(s.subidaMasLarga).toBeNull();
  });

  it('declared reference gives declared source and null weeks', () => {
    const s = buildLevelSummary(referenceFromAnswers(ANSWERS), []);
    expect(s.fuente).toBe('declarado');
    expect(s.semanas).toBeNull();
    expect(s.salidas).toBe(0);
    expect(s.salidasPorSemana).toBe(0);
    expect(s.distanciaMediaKm).toBe(40);
    expect(s.velocidadMediaKmh).toBe(22);
    expect(s.tiempoMedioMin).toBe(109);
  });
});

describe('climbsInWindow', () => {
  // 8 semanas antes de NOW en Madrid: viernes 11 de septiembre, 12:00 en horario de verano (UTC+2).
  // Entre medias está el cambio de hora del 25 de octubre.
  const FROM_8W = Date.parse('2026-09-11T10:00:00Z');
  const FROM_12W = Date.parse('2026-08-14T10:00:00Z');

  it('keeps efforts from the reference window across the DST change', () => {
    const atStart = effort({ activityStart: FROM_8W });
    const before = effort({ activityStart: FROM_8W - 1 });
    const atNow = effort({ activityStart: NOW });
    const future = effort({ activityStart: NOW + 1 });
    expect(climbsInWindow([before, atStart, atNow, future], historyRef(), NOW)).toEqual([atStart, atNow]);
  });

  it('uses the long window when the reference uses it', () => {
    const inLong = effort({ activityStart: FROM_12W });
    const beforeLong = effort({ activityStart: FROM_12W - 1 });
    const ref = historyRef({ weeks: LONG_WINDOW_WEEKS });
    expect(climbsInWindow([beforeLong, inLong], ref, NOW)).toEqual([inLong]);
  });

  it('declared reference uses the long window', () => {
    const inLong = effort({ activityStart: FROM_12W });
    const beforeLong = effort({ activityStart: FROM_12W - 1 });
    expect(climbsInWindow([beforeLong, inLong], referenceFromAnswers(ANSWERS), NOW)).toEqual([inLong]);
  });

  it('no efforts gives empty list', () => {
    expect(climbsInWindow([], historyRef(), NOW)).toEqual([]);
  });
});

describe('referenceFromAnswers', () => {
  it('declared reference from answers', () => {
    const r = referenceFromAnswers(ANSWERS);
    expect(r.source).toBe('declared');
    expect(r.weeks).toBeNull();
    expect(r.rides).toBe(0);
    expect(r.ridesPerWeek).toBe(0);
    expect(r.avgDistanceM).toBe(40_000);
    expect(r.avgElevGainM).toBe(400);
    expect(r.avgSpeedMs).toBeCloseTo(6.11, 2);
    expect(r.avgMovingTimeS).toBeCloseTo(40_000 / (22 / 3.6), 6);
    expect(r.longestDistanceM).toBe(r.avgDistanceM);
    expect(r.maxElevGainM).toBe(r.avgElevGainM);
  });

  it('zero speed gives zero time instead of Infinity', () => {
    const r = referenceFromAnswers({ ...ANSWERS, velocidadMediaKmh: 0 });
    expect(r.avgSpeedMs).toBe(0);
    expect(r.avgMovingTimeS).toBe(0);
  });
});

describe('declared reference storage', () => {
  beforeEach(async () => {
    await db.meta.clear();
  });

  it('nothing saved gives null', async () => {
    expect(await loadDeclaredReference()).toBeNull();
  });

  it('save and load round-trip under the meta key', async () => {
    await saveDeclaredReference(ANSWERS);
    expect(await db.meta.get(DECLARED_REFERENCE_KEY)).toBeDefined();
    expect(await loadDeclaredReference()).toEqual(referenceFromAnswers(ANSWERS));
  });

  it('saving again replaces the answers', async () => {
    await saveDeclaredReference(ANSWERS);
    const next = { ...ANSWERS, kmPorSalida: 60 };
    await saveDeclaredReference(next);
    expect(await loadDeclaredReference()).toEqual(referenceFromAnswers(next));
  });
});

describe('resolveReference', () => {
  beforeEach(async () => {
    await db.meta.clear();
  });

  const ridesInLastWeeks = (n: number, hasTrack = true) =>
    Array.from({ length: n }, (_, i) => ride(NOW - (i + 1) * 7 * DAY_MS, hasTrack));

  it('history wins over declared', async () => {
    await saveDeclaredReference(ANSWERS);
    const r = await resolveReference(ridesInLastWeeks(MIN_RIDES), NOW);
    expect(r?.source).toBe('history');
    expect(r?.weeks).toBe(SHORT_WINDOW_WEEKS);
  });

  it('rides without GPS count toward the history reference', async () => {
    await saveDeclaredReference(ANSWERS);
    const r = await resolveReference(ridesInLastWeeks(MIN_RIDES, false), NOW);
    expect(r?.source).toBe('history');
  });

  it('declared used below 5 rides', async () => {
    await saveDeclaredReference(ANSWERS);
    const r = await resolveReference(ridesInLastWeeks(MIN_RIDES - 1), NOW);
    expect(r).toEqual(referenceFromAnswers(ANSWERS));
  });

  it('single ride and nothing declared gives null', async () => {
    expect(await resolveReference([ride(NOW - DAY_MS)], NOW)).toBeNull();
  });

  it('no rides and nothing declared gives null', async () => {
    expect(await resolveReference([], NOW)).toBeNull();
  });
});
