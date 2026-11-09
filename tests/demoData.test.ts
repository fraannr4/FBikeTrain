import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { clearAllData, saveActivity } from '../src/db/repo';
import { clearDemoData, DEMO_PREFIX, generateDemo, hasDemoData, loadDemoData, type DemoData } from '../src/demo/demoData';
import { computeTotals } from '../src/import/summary';
import { localDay, periodStartOf } from '../src/metrics/calendar';
import { detectClimbs } from '../src/metrics/climbs';
import { groupClimbs } from '../src/metrics/climbGroups';
import { groupRoutes, routeCells } from '../src/metrics/routes';
import type { ClimbEffort, StoredActivity } from '../src/domain/types';

// Viernes 6 de noviembre de 2026, 18:00 en Madrid (17:00 UTC).
const NOW = Date.UTC(2026, 10, 6, 17, 0);
const DAY = 86_400_000;

let demo: DemoData;
beforeAll(() => {
  demo = generateDemo(NOW);
});

describe('generateDemo', () => {
  it('es determinista: la misma fecha da los mismos datos', () => {
    const again = generateDemo(NOW);
    expect(again.activities).toEqual(demo.activities);
    expect(again.tracks[5]).toEqual(demo.tracks[5]);
    expect(again.workouts).toEqual(demo.workouts);
    expect(again.goals).toEqual(demo.goals);
  });

  it('genera unas 200 salidas en los 14 meses anteriores, la última ayer o antes de ayer', () => {
    const acts = demo.activities;
    expect(acts.length).toBeGreaterThanOrEqual(180);
    expect(acts.length).toBeLessThanOrEqual(230);
    const times = acts.map((a) => a.startTime);
    const first = Math.min(...times);
    const last = Math.max(...times);
    expect(last).toBeLessThan(NOW);
    expect(NOW - last).toBeLessThan(2 * DAY);
    expect(NOW - first).toBeGreaterThan(395 * DAY);
    expect(NOW - first).toBeLessThan(430 * DAY);
  });

  it('marca todo como demo y no repite ids', () => {
    const ids = [...demo.activities.map((a) => a.id), ...demo.workouts.map((w) => w.id), ...demo.goals.map((g) => g.id)];
    expect(ids.every((id) => id.startsWith(DEMO_PREFIX))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('da cifras de ciclismo de carretera creíbles, sin pulso, potencia ni cadencia', () => {
    for (const a of demo.activities) {
      const km = a.totals.distanceM / 1000;
      const kmh = a.totals.avgSpeedMs * 3.6;
      expect(km).toBeGreaterThan(20);
      expect(km).toBeLessThan(170);
      expect(kmh).toBeGreaterThan(16);
      expect(kmh).toBeLessThan(34);
      expect(a.totals.elapsedTimeS).toBeGreaterThanOrEqual(a.totals.movingTimeS - 0.001);
      expect(a.totals.maxSpeedMs).toBeLessThan(25);
      expect(a.totals).not.toHaveProperty('avgHr');
      expect(a.totals).not.toHaveProperty('avgPower');
      expect(a.totals).not.toHaveProperty('avgCadence');
      expect(a.sport).toBe('cycling');
    }
  });

  it('las salidas con GPS traen track con altura, y sus totales salen de ese track', () => {
    const withTrack = demo.activities.filter((a) => a.hasTrack);
    expect(withTrack.length).toBe(demo.tracks.length);
    expect(demo.activities.length - withTrack.length).toBeGreaterThanOrEqual(2);
    const byId = new Map(demo.tracks.map((t) => [t.activityId, t.points]));
    for (const a of withTrack.slice(0, 20)) {
      const pts = byId.get(a.id)!;
      expect(pts.length).toBeGreaterThan(200);
      expect(pts.every((p) => p.ele !== undefined && p.lat !== undefined && p.lng !== undefined)).toBe(true);
      const t = computeTotals(pts);
      expect(a.totals.distanceM).toBeCloseTo(t.distanceM, 3);
      expect(a.totals.elevGainM).toBeCloseTo(t.elevGainM, 3);
    }
  });

  it('las coordenadas son sintéticas, dentro de una zona acotada del interior', () => {
    let latMin = 90;
    let latMax = -90;
    let lngMin = 180;
    let lngMax = -180;
    for (const t of demo.tracks) {
      for (const p of t.points) {
        latMin = Math.min(latMin, p.lat!);
        latMax = Math.max(latMax, p.lat!);
        lngMin = Math.min(lngMin, p.lng!);
        lngMax = Math.max(lngMax, p.lng!);
      }
    }
    expect(latMin).toBeGreaterThan(41.6);
    expect(latMax).toBeLessThan(42.3);
    expect(lngMin).toBeGreaterThan(1.6);
    expect(lngMax).toBeLessThan(2.6);
  });

  it('hay rutas repetidas y subidas que se repiten', () => {
    const tracked = demo.activities.filter((a) => a.hasTrack);
    const byId = new Map(demo.tracks.map((t) => [t.activityId, t.points]));
    const sigs = tracked.map((a) => ({
      activityId: a.id,
      activityStart: a.startTime,
      distanceM: a.totals.distanceM,
      cells: routeCells(byId.get(a.id)!),
    }));
    const groups = groupRoutes(sigs).filter((g) => g.activityIds.length >= 3);
    expect(groups.length).toBeGreaterThanOrEqual(5);

    const efforts: ClimbEffort[] = tracked.slice(-60).flatMap((a) =>
      detectClimbs(byId.get(a.id)!).map((c, n) => ({ ...c, id: `${a.id}_${n}`, activityId: a.id, activityStart: a.startTime })),
    );
    const climbs = groupClimbs(efforts).filter((g) => g.efforts.length >= 3);
    expect(climbs.length).toBeGreaterThanOrEqual(4);
  });

  it('en un mismo puerto los tiempos se parecen: cambia la forma, no se para a mitad de subida', () => {
    const byId = new Map(demo.tracks.map((t) => [t.activityId, t.points]));
    const efforts: ClimbEffort[] = demo.activities
      .filter((a) => a.hasTrack)
      .flatMap((a) =>
        detectClimbs(byId.get(a.id)!).map((c, n) => ({ ...c, id: `${a.id}_${n}`, activityId: a.id, activityStart: a.startTime })),
      );
    const climbs = groupClimbs(efforts).filter((g) => g.efforts.length >= 5);
    expect(climbs.length).toBeGreaterThanOrEqual(4);
    for (const g of climbs) {
      const times = g.efforts.map((e) => e.timeS);
      const best = Math.min(...times);
      const mean = times.reduce((s, t) => s + t, 0) / times.length;
      expect(Math.max(...times) / best).toBeLessThan(1.3);
      expect(mean / best).toBeLessThan(1.2); // antes, 30:12 de media frente a 20:49 de mejor
    }
  }, 60_000);

  it('trae objetivos de semana, de mes y una marcha futura', () => {
    const today = localDay(NOW);
    const week = demo.goals.find((g) => g.kind === 'volume' && g.period === 'week');
    const month = demo.goals.find((g) => g.kind === 'volume' && g.period === 'month');
    const event = demo.goals.find((g) => g.kind === 'event');
    expect(week && week.kind === 'volume' && week.start).toBe(periodStartOf('week', today));
    expect(month && month.kind === 'volume' && month.start).toBe(periodStartOf('month', today));
    expect(event && event.kind === 'event' && event.date > today).toBe(true);
  });

  it('trae entrenos hechos (enlazados a la salida de ese día), alguno perdido y uno pendiente para mañana', () => {
    const today = localDay(NOW);
    const tomorrow = localDay(NOW + DAY);
    const acts = new Map(demo.activities.map((a) => [a.id, a]));
    const done = demo.workouts.filter((w) => w.done);
    expect(done.length).toBeGreaterThanOrEqual(3);
    for (const w of done) {
      const a = acts.get(w.activityId!);
      expect(a).toBeDefined();
      expect(localDay(a!.startTime)).toBe(w.date);
    }
    expect(demo.workouts.some((w) => !w.done && w.date < today)).toBe(true);
    expect(demo.workouts.some((w) => !w.done && w.date === tomorrow)).toBe(true);
  });
});

describe('loadDemoData y clearDemoData', () => {
  const mine: StoredActivity = {
    id: 'mia-1',
    startTime: NOW - 3 * DAY,
    sport: 'cycling',
    name: 'Salida propia',
    totals: { distanceM: 40_000, movingTimeS: 5400, elapsedTimeS: 5600, elevGainM: 400, avgSpeedMs: 7.4, maxSpeedMs: 15 },
    hasTrack: false,
    source: 'gpx',
    importedAt: NOW,
  };

  beforeEach(async () => {
    await clearAllData();
    await saveActivity(mine, []);
  });

  it('guarda los datos de demo, los analiza y no toca los datos propios ni la fecha de importación', async () => {
    expect(await hasDemoData()).toBe(false);
    const n = await loadDemoData(NOW);
    expect(n).toBe(demo.activities.length);
    expect(await hasDemoData()).toBe(true);
    expect(await db.activities.count()).toBe(demo.activities.length + 1);
    expect(await db.routeSigs.count()).toBe(demo.tracks.length);
    expect(await db.climbEfforts.count()).toBeGreaterThan(50);
    expect(await db.calendar.count()).toBe(demo.workouts.length);
    expect(await db.goals.count()).toBe(demo.goals.length);
    expect(await db.activities.get('mia-1')).toEqual(mine);
    expect(await db.meta.count()).toBe(0);

    // Cargar dos veces no duplica.
    await loadDemoData(NOW);
    expect(await db.activities.count()).toBe(demo.activities.length + 1);
  }, 120_000);

  it('clearDemoData borra solo lo de demo, en todas las tablas', async () => {
    await loadDemoData(NOW);
    await clearDemoData();
    expect(await hasDemoData()).toBe(false);
    expect(await db.activities.toArray()).toEqual([mine]);
    expect(await db.tracks.count()).toBe(0);
    expect(await db.routeSigs.count()).toBe(0);
    expect(await db.climbEfforts.count()).toBe(0);
    expect(await db.calendar.count()).toBe(0);
    expect(await db.goals.count()).toBe(0);
  }, 120_000);
});
