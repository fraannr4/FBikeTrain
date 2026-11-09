import { db } from '../src/db/db';
import { getMeta } from '../src/db/repo';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/settings/settings';
import { BackupError, exportBackup, getBackupMeta, needsBackup, restoreBackup } from '../src/backup/backup';
import { listGoals, listWorkouts, saveGoal, saveWorkout } from '../src/calendar/calendarRepo';
import type { EventGoal, PlannedWorkout, Settings, StoredActivity, VolumeGoal } from '../src/domain/types';

const TEST_KEY = 'clave-de-prueba-123';

const sample: Settings = {
  displayName: 'Ana',
  home: { lat: 41.0, lng: 2.5 },
  ors: { apiKey: TEST_KEY },
  llm: { baseUrl: 'https://example.test/v1', apiKey: 'llm-' + TEST_KEY, model: 'modelo-x' },
};

function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value)], { type: 'application/json' });
}

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected rejection');
}

const doneWorkout: PlannedWorkout = {
  id: 'w1',
  date: '2026-11-03',
  title: 'Rodaje suave',
  distanceM: 60000,
  done: true,
  activityId: 'act-1',
  manual: false,
  createdAt: 1,
};

const eventGoal: EventGoal = {
  kind: 'event',
  id: 'g1',
  title: 'Marcha',
  date: '2026-12-14',
  distanceM: 120000,
  elevGainM: 2000,
  createdAt: 2,
};

const weekGoal: VolumeGoal = {
  kind: 'volume',
  id: 'g2',
  title: 'Semana larga',
  period: 'week',
  start: '2026-11-30',
  distanceM: 200000,
  createdAt: 3,
};

/** Copia válida de F3 sin calendario ni objetivos, para variar solo lo que prueba cada caso. */
function backupWith(extra: { calendar?: unknown[]; goals?: unknown[] }): Blob {
  return jsonBlob({
    app: 'ciclismo',
    version: 1,
    exportedAt: '2026-11-06T10:00:00.000Z',
    settings: { displayName: 'Ana', home: null },
    calendar: [],
    goals: [],
    ...extra,
  });
}

async function clearAll() {
  await Promise.all([db.settings.clear(), db.calendar.clear(), db.goals.clear(), db.meta.clear(), db.activities.clear()]);
}

describe('backup', () => {
  beforeEach(clearAll);

  it('round trip restores settings', async () => {
    await saveSettings(sample);
    const blob = await exportBackup({ includeKeys: true });
    await db.settings.clear();
    await restoreBackup(blob);
    expect(await loadSettings()).toEqual(sample);
  });

  it('exports the BackupFile shape', async () => {
    await saveSettings(sample);
    const data = JSON.parse(await (await exportBackup({ includeKeys: true })).text());
    expect(data).toMatchObject({ app: 'ciclismo', version: 1, calendar: [], goals: [] });
    expect(Number.isNaN(Date.parse(data.exportedAt))).toBe(false);
  });

  it('keys excluded by default', async () => {
    await saveSettings(sample);
    const text = await (await exportBackup({ includeKeys: false })).text();
    expect(text).not.toContain(TEST_KEY);
    expect(JSON.parse(text).settings.displayName).toBe('Ana');
  });

  it('restore without keys keeps the keys already in this browser', async () => {
    await saveSettings(sample);
    const blob = await exportBackup({ includeKeys: false });
    await saveSettings({ ...DEFAULT_SETTINGS, ors: { apiKey: 'local-ors' } });
    await restoreBackup(blob);
    const s = await loadSettings();
    expect(s.displayName).toBe('Ana');
    expect(s.home).toEqual({ lat: 41.0, lng: 2.5 });
    expect(s.ors.apiKey).toBe('local-ors');
  });

  it('rejects other version', async () => {
    const err = await rejection(
      restoreBackup(jsonBlob({ app: 'ciclismo', version: 2, exportedAt: '', settings: {}, calendar: [], goals: [] })),
    );
    expect(err).toBeInstanceOf(BackupError);
    expect((err as BackupError).reason).toBe('version');
  });

  it('rejects non-json', async () => {
    const err = await rejection(restoreBackup(new Blob(['esto no es json'])));
    expect(err).toBeInstanceOf(BackupError);
    expect((err as BackupError).reason).toBe('format');
  });

  it('rejects json from another app', async () => {
    const err = await rejection(restoreBackup(jsonBlob({ foo: 1 })));
    expect(err).toBeInstanceOf(BackupError);
    expect((err as BackupError).reason).toBe('format');
  });

  it('failed restore leaves settings untouched', async () => {
    await saveSettings(sample);
    await rejection(restoreBackup(jsonBlob({ app: 'ciclismo', version: 1, settings: { displayName: 3 } })));
    expect(await loadSettings()).toEqual(sample);
  });

  it('round trip restores calendar and goals', async () => {
    await saveSettings(sample);
    await saveWorkout(doneWorkout);
    await saveGoal(eventGoal);
    await saveGoal(weekGoal);
    const blob = await exportBackup({ includeKeys: false });
    await clearAll();
    await restoreBackup(blob);
    expect(await listWorkouts()).toEqual([doneWorkout]);
    expect(await listGoals()).toEqual([weekGoal, eventGoal]);
  });

  it('restore replaces existing calendar', async () => {
    await saveWorkout({ ...doneWorkout, id: 'old' });
    await restoreBackup(backupWith({ calendar: [doneWorkout] }));
    expect((await listWorkouts()).map((w) => w.id)).toEqual(['w1']);
  });

  it('invalid workout rejects and leaves calendar untouched', async () => {
    await saveWorkout(doneWorkout);
    const { date: _date, ...noDate } = doneWorkout;
    const err = await rejection(restoreBackup(backupWith({ calendar: [{ ...doneWorkout, id: 'w2' }, noDate] })));
    expect(err).toBeInstanceOf(BackupError);
    expect((err as BackupError).reason).toBe('format');
    expect(await listWorkouts()).toEqual([doneWorkout]);
  });

  it('invalid volume goal rejects and leaves goals untouched', async () => {
    await saveGoal(eventGoal);
    const { distanceM: _d, ...noTarget } = weekGoal;
    const badMonth: VolumeGoal = { ...weekGoal, id: 'g3', period: 'month', start: '2026-11-02' };
    for (const bad of [noTarget, badMonth]) {
      const err = await rejection(restoreBackup(backupWith({ goals: [weekGoal, bad] })));
      expect(err).toBeInstanceOf(BackupError);
      expect((err as BackupError).reason).toBe('format');
    }
    expect(await listGoals()).toEqual([eventGoal]);
  });

  it('f1 backup with empty arrays restores', async () => {
    await saveWorkout(doneWorkout);
    await restoreBackup(backupWith({}));
    expect((await loadSettings()).displayName).toBe('Ana');
    expect(await listWorkouts()).toEqual([]);
    expect(await listGoals()).toEqual([]);
  });

  it('export records lastBackupAt', async () => {
    const before = Date.now();
    await exportBackup({ includeKeys: false });
    const { lastBackupAt } = await getBackupMeta();
    expect(lastBackupAt).toBeGreaterThanOrEqual(before);
    expect(lastBackupAt).toBeLessThanOrEqual(Date.now());
  });

  it('export records lastBackupAt for getMeta', async () => {
    await exportBackup({ includeKeys: false });
    const { lastBackupAt } = await getBackupMeta();
    expect(lastBackupAt).toBeDefined();
    expect((await getMeta()).lastBackupAt).toBe(lastBackupAt);
  });

  // F3 hace que restoreBackup anote la hora (ver «restore clears the reminder»); aquí solo se exige
  // que la restauración no borre lastBackupAt ni lo haga retroceder.
  it('restore keeps lastBackupAt', async () => {
    const blob = await exportBackup({ includeKeys: false });
    const exported = (await getMeta()).lastBackupAt;
    expect(exported).toBeDefined();
    await restoreBackup(blob);
    expect((await getMeta()).lastBackupAt).toBeGreaterThanOrEqual(exported!);
  });

  it('needsBackup when calendar changed after last export', () => {
    expect(needsBackup({ calendarChangedAt: 2, lastBackupAt: 1 })).toBe(true);
    expect(needsBackup({ calendarChangedAt: 1, lastBackupAt: 2 })).toBe(false);
    expect(needsBackup({})).toBe(false);
    expect(needsBackup({ calendarChangedAt: 1 })).toBe(true);
  });

  it('restore clears the reminder', async () => {
    await saveWorkout(doneWorkout);
    expect(needsBackup(await getBackupMeta())).toBe(true);
    await restoreBackup(backupWith({ calendar: [doneWorkout] }));
    expect(needsBackup(await getBackupMeta())).toBe(false);
  });

  it('restore that marks a workout from a stored ride clears the reminder', async () => {
    const ride: StoredActivity = {
      id: 'act-1',
      startTime: Date.parse('2026-11-03T09:00:00Z'),
      sport: 'cycling',
      totals: { distanceM: 40_000, movingTimeS: 5_400, elapsedTimeS: 6_000, elevGainM: 300, avgSpeedMs: 7.4, maxSpeedMs: 12 },
      hasTrack: false,
      source: 'fit',
      importedAt: 1,
    };
    await db.activities.put(ride);
    const { activityId: _a, ...pending } = doneWorkout;
    await restoreBackup(backupWith({ calendar: [{ ...pending, done: false }] }));
    expect((await listWorkouts())[0]).toMatchObject({ done: true, activityId: 'act-1' });
    expect(needsBackup(await getBackupMeta())).toBe(false);
  });
});
