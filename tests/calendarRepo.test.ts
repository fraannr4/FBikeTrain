import Dexie from 'dexie';
import { db, CyclingDb } from '../src/db/db';
import {
  deleteGoal,
  deleteWorkout,
  goalSortDate,
  isValidGoal,
  listGoals,
  listWorkouts,
  newId,
  saveGoal,
  saveWorkout,
  setWorkoutDone,
} from '../src/calendar/calendarRepo';
import type { EventGoal, PlannedWorkout, StoredActivity, VolumeGoal } from '../src/domain/types';

const activity: StoredActivity = {
  id: 'a1',
  startTime: Date.UTC(2026, 10, 2, 9),
  sport: 'cycling',
  totals: { distanceM: 3000, movingTimeS: 600, elapsedTimeS: 600, elevGainM: 100, avgSpeedMs: 5, maxSpeedMs: 6 },
  hasTrack: true,
  source: 'gpx',
  importedAt: 0,
};

function workout(id: string, date: string, extra: Partial<PlannedWorkout> = {}): PlannedWorkout {
  return { id, date, title: `Entreno ${id}`, done: false, manual: false, createdAt: 1, ...extra };
}

const eventGoal = (extra: Partial<EventGoal> = {}): EventGoal => ({
  kind: 'event',
  id: 'e1',
  title: 'Marcha',
  date: '2026-12-14',
  distanceM: 120_000,
  elevGainM: 2000,
  createdAt: 1,
  ...extra,
});

const volumeGoal = (extra: Partial<VolumeGoal> = {}): VolumeGoal => ({
  kind: 'volume',
  id: 'v1',
  title: '400 km en noviembre',
  period: 'month',
  start: '2026-11-01',
  distanceM: 400_000,
  createdAt: 2,
  ...extra,
});

async function clearAll() {
  await Promise.all([db.calendar.clear(), db.goals.clear(), db.meta.clear()]);
}

describe('calendarRepo', () => {
  // Va la primera: el `db` compartido aún no se ha abierto, así que la versión 2 se crea desde cero.
  it('migrates v2 database keeping activities and analysis', async () => {
    db.close();
    await Dexie.delete('ciclismo');
    const v2 = new Dexie('ciclismo');
    v2.version(1).stores({ activities: 'id, startTime', tracks: 'activityId', settings: 'key', meta: 'key' });
    v2.version(2).stores({ climbEfforts: 'id, activityId', routeSigs: 'activityId, distanceM' });
    await v2.table('activities').add(activity);
    await v2.table('climbEfforts').add({ id: 'a1_0', activityId: 'a1', activityStart: activity.startTime });
    await v2.table('routeSigs').add({ activityId: 'a1', activityStart: activity.startTime, distanceM: 3000, cells: ['x'], analysisVersion: 1 });
    v2.close();

    const v3 = new CyclingDb();
    expect(await v3.activities.get('a1')).toMatchObject({ id: 'a1' });
    expect(await v3.climbEfforts.get('a1_0')).toMatchObject({ activityId: 'a1' });
    expect(await v3.routeSigs.get('a1')).toMatchObject({ cells: ['x'] });
    expect(await v3.calendar.count()).toBe(0);
    expect(await v3.goals.count()).toBe(0);
    v3.close();
    await db.open();
  });

  describe('with a clean database', () => {
    beforeEach(clearAll);

    it('lists workouts of a month ordered by date', async () => {
      await saveWorkout(workout('w3', '2026-11-20'));
      await saveWorkout(workout('w4', '2026-12-01'));
      await saveWorkout(workout('w1', '2026-11-01'));
      await saveWorkout(workout('w2', '2026-11-30'));

      const nov = await listWorkouts({ from: '2026-11-01', to: '2026-11-30' });
      expect(nov.map((w) => w.id)).toEqual(['w1', 'w3', 'w2']);
      expect((await listWorkouts()).map((w) => w.id)).toEqual(['w1', 'w3', 'w2', 'w4']);
    });

    it('deleteWorkout removes it', async () => {
      await saveWorkout(workout('w1', '2026-11-01'));
      await deleteWorkout('w1');
      expect(await listWorkouts()).toEqual([]);
    });

    it('setWorkoutDone false clears activity and marks manual', async () => {
      await saveWorkout(workout('w1', '2026-11-02', { done: true, activityId: 'a1' }));
      await setWorkoutDone('w1', false);
      const [w] = await listWorkouts();
      expect(w.done).toBe(false);
      expect(w.manual).toBe(true);
      expect(w.activityId).toBeUndefined();
    });

    it('setWorkoutDone true marks manual and keeps activity', async () => {
      await saveWorkout(workout('w1', '2026-11-02', { activityId: 'a1' }));
      await setWorkoutDone('w1', true);
      const [w] = await listWorkouts();
      expect(w).toMatchObject({ done: true, manual: true, activityId: 'a1' });
    });

    it('goals ordered by date or period start', async () => {
      await saveGoal(eventGoal());
      await saveGoal(volumeGoal());
      await saveGoal(volumeGoal({ id: 'v0', start: '2026-11-01', createdAt: 0 }));
      expect((await listGoals()).map((g) => g.id)).toEqual(['v0', 'v1', 'e1']);
    });

    it('deleteGoal removes it', async () => {
      await saveGoal(eventGoal());
      await deleteGoal('e1');
      expect(await listGoals()).toEqual([]);
    });

    it('saveGoal rejects invalid goal', async () => {
      await expect(saveGoal(volumeGoal({ start: '2026-11-02' }))).rejects.toThrow('invalid goal');
      expect(await db.goals.count()).toBe(0);
    });

    it('writes update calendarChangedAt', async () => {
      const writes: (() => Promise<void>)[] = [
        () => saveWorkout(workout('w1', '2026-11-02')),
        () => setWorkoutDone('w1', true),
        () => deleteWorkout('w1'),
        () => saveGoal(eventGoal()),
        () => deleteGoal('e1'),
      ];
      let t = 1000;
      const spy = vi.spyOn(Date, 'now').mockImplementation(() => t);
      try {
        for (const write of writes) {
          t += 1000;
          await write();
          expect((await db.meta.get('calendarChangedAt'))?.value).toBe(t);
        }
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('goalSortDate uses date or start', () => {
    expect(goalSortDate(eventGoal())).toBe('2026-12-14');
    expect(goalSortDate(volumeGoal())).toBe('2026-11-01');
  });

  it('newId gives distinct ids', () => {
    const a = newId();
    expect(typeof a).toBe('string');
    expect(a).not.toBe(newId());
  });

  it('isValidGoal accepts event and volume goals', () => {
    expect(isValidGoal(eventGoal({ distanceM: undefined, elevGainM: 2000 }))).toBe(true);
    expect(
      isValidGoal(volumeGoal({ period: 'week', start: '2026-11-30', distanceM: undefined, movingTimeS: 36_000 })),
    ).toBe(true);
    expect(isValidGoal(volumeGoal({ period: 'month', start: '2026-11-01' }))).toBe(true);
  });

  it('isValidGoal rejects bad event goals', () => {
    expect(isValidGoal(eventGoal({ distanceM: undefined, elevGainM: undefined }))).toBe(false);
    expect(isValidGoal(eventGoal({ distanceM: 0, elevGainM: undefined }))).toBe(false);
    expect(isValidGoal(eventGoal({ date: '14/12/2026' }))).toBe(false);
    expect(isValidGoal(eventGoal({ id: '' }))).toBe(false);
    expect(isValidGoal(eventGoal({ title: '' }))).toBe(false);
    expect(isValidGoal({ ...eventGoal(), createdAt: '1' })).toBe(false);
    expect(isValidGoal(null)).toBe(false);
    expect(isValidGoal('goal')).toBe(false);
  });

  it('isValidGoal rejects bad volume goals', () => {
    expect(isValidGoal(volumeGoal({ period: 'week', start: '2026-11-04' }))).toBe(false);
    expect(isValidGoal(volumeGoal({ period: 'month', start: '2026-11-02' }))).toBe(false);
    expect(isValidGoal(volumeGoal({ distanceM: undefined }))).toBe(false);
    expect(isValidGoal({ ...volumeGoal(), period: 'year' })).toBe(false);
    const { kind: _kind, ...noKind } = volumeGoal();
    expect(isValidGoal(noKind)).toBe(false);
    expect(isValidGoal({ ...eventGoal(), kind: 'other' })).toBe(false);
  });
});
