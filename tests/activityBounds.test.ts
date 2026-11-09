import { db } from '../src/db/db';
import { countActivities, firstActivity, lastActivity, saveActivity } from '../src/db/repo';
import type { StoredActivity } from '../src/domain/types';

function ride(id: string, startTime: number, distanceM = 30_000): StoredActivity {
  return {
    id,
    startTime,
    sport: 'cycling',
    totals: { distanceM, movingTimeS: 3_600, elapsedTimeS: 3_600, elevGainM: 100, avgSpeedMs: 8, maxSpeedMs: 12 },
    hasTrack: false,
    source: 'fit',
    importedAt: 0,
  };
}

describe('count, first and last activity without reading them all', () => {
  beforeEach(async () => {
    await db.activities.clear();
    await db.tracks.clear();
  });

  it('empty database has no count, first or last', async () => {
    expect(await countActivities()).toBe(0);
    expect(await firstActivity()).toBeUndefined();
    expect(await lastActivity()).toBeUndefined();
  });

  it('first and last follow startTime, not insertion order', async () => {
    await saveActivity(ride('b', 2_000), []);
    await saveActivity(ride('c', 3_000), []);
    await saveActivity(ride('a', 1_000), []);
    expect(await countActivities()).toBe(3);
    expect((await firstActivity())?.id).toBe('a');
    expect((await lastActivity())?.id).toBe('c');
  });

  it('last skips the rides that do not pass the filter', async () => {
    await saveActivity(ride('ok', 1_000), []);
    await saveActivity(ride('blip', 2_000, 0), []);
    expect((await lastActivity((a) => a.totals.distanceM > 0))?.id).toBe('ok');
  });
});
