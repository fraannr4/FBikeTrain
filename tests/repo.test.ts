import { db } from '../src/db/db';
import { clearAllData, getMeta, saveActivity, setLastBackupAt, setLastImportAt } from '../src/db/repo';
import { DEFAULT_SETTINGS, saveSettings } from '../src/settings/settings';
import type { StoredActivity } from '../src/domain/types';

const START = Date.UTC(2026, 0, 4, 8, 0, 0);

const ride: StoredActivity = {
  id: 'r1',
  startTime: START,
  sport: 'cycling',
  totals: { distanceM: 20_000, movingTimeS: 3600, elapsedTimeS: 3700, elevGainM: 100, avgSpeedMs: 5.6, maxSpeedMs: 10 },
  hasTrack: true,
  source: 'gpx',
  importedAt: START,
};

describe('repo', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('getMeta returns lastBackupAt', async () => {
    await setLastImportAt(1);
    await setLastBackupAt(2);
    expect(await getMeta()).toEqual({ lastImportAt: 1, lastBackupAt: 2 });
  });

  it('clearAllData empties every table', async () => {
    await saveActivity(ride, [{ t: START, lat: 41, lng: 2.5 }]);
    await setLastImportAt(1);
    await saveSettings({ ...DEFAULT_SETTINGS, displayName: 'Ana' });
    await db.calendar.put({ id: 'w1', date: '2026-11-03', title: 'Rodaje', done: false, manual: false, createdAt: 1 });

    await clearAllData();

    const counts = await Promise.all(db.tables.map((t) => t.count()));
    expect(counts.every((c) => c === 0)).toBe(true);
  });
});
