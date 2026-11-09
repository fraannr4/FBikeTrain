import { readFileSync } from 'node:fs';
import { db } from '../src/db/db';
import { listActivities, saveActivity } from '../src/db/repo';
import { listWorkouts, saveWorkout, setWorkoutDone } from '../src/calendar/calendarRepo';
import { syncCalendar } from '../src/calendar/sync';
import { importFiles } from '../src/import/importService';
import type { LocalDate, PlannedWorkout, StoredActivity } from '../src/domain/types';

// El Blob de jsdom no trae arrayBuffer(); el del navegador y el del Worker, sí.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

/** Día de `tests/fixtures/ride.gpx` (2026-01-04T08:00:00Z). */
const RIDE_DAY = '2026-01-04';
const rideGpx = () => new File([readFileSync('tests/fixtures/ride.gpx', 'utf8')], 'ride.gpx');

const workout = (id: string, date: LocalDate, extra: Partial<PlannedWorkout> = {}): PlannedWorkout => ({
  id,
  date,
  title: 'Rodaje',
  done: false,
  manual: false,
  createdAt: 1,
  ...extra,
});

const activity: StoredActivity = {
  id: 'a1',
  startTime: Date.parse('2026-03-10T09:00:00Z'),
  sport: 'cycling',
  totals: { distanceM: 40_000, movingTimeS: 5_400, elapsedTimeS: 6_000, elevGainM: 300, avgSpeedMs: 7.4, maxSpeedMs: 12 },
  hasTrack: false,
  source: 'fit',
  importedAt: 1,
};

const getWorkout = async (id: string) => (await listWorkouts()).find((w) => w.id === id);

describe('syncCalendar', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('import marks workout of that day', async () => {
    await saveWorkout(workout('w1', RIDE_DAY));

    await importFiles([rideGpx()]);

    const [a] = await listActivities();
    expect(await getWorkout('w1')).toMatchObject({ done: true, activityId: a.id, manual: false });
  });

  it('past workout with ride is marked on sync', async () => {
    await saveActivity(activity, []);
    await saveWorkout(workout('w1', '2026-03-10'));

    expect(await syncCalendar()).toBe(1);
    expect(await getWorkout('w1')).toMatchObject({ done: true, activityId: 'a1', manual: false });
  });

  it('manual unmark survives sync', async () => {
    await saveActivity(activity, []);
    await saveWorkout(workout('w1', '2026-03-10'));
    await syncCalendar();
    await setWorkoutDone('w1', false);

    expect(await syncCalendar()).toBe(0);
    const w = await getWorkout('w1');
    expect(w).toMatchObject({ done: false, manual: true });
    expect(w?.activityId).toBeUndefined();
  });

  it('workout without ride stays pending', async () => {
    await saveActivity(activity, []);
    await saveWorkout(workout('w1', '2026-03-11'));

    expect(await syncCalendar()).toBe(0);
    expect(await getWorkout('w1')).toMatchObject({ done: false, manual: false });
    expect((await getWorkout('w1'))?.activityId).toBeUndefined();
  });
});
