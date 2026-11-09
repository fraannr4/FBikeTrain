import { db } from '../src/db/db';
import { cachedActivities, readActivities } from '../src/db/activityCache';
import { clearAllData, saveActivity } from '../src/db/repo';
import type { StoredActivity } from '../src/domain/types';

function ride(id: string, startTime: number): StoredActivity {
  return {
    id,
    startTime,
    sport: 'cycling',
    totals: { distanceM: 40_000, movingTimeS: 5_400, elapsedTimeS: 5_700, elevGainM: 300, avgSpeedMs: 7.4, maxSpeedMs: 14 },
    hasTrack: false,
    source: 'gpx',
    importedAt: 0,
  };
}

const ids = (acts: StoredActivity[] | undefined) => acts?.map((a) => a.id);

describe('caché de actividades', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('la segunda lectura sale de memoria, sin esperar a la base', async () => {
    await saveActivity(ride('a', 1), []);
    expect(cachedActivities()).toBeUndefined();
    const first = await readActivities();
    expect(ids(first)).toEqual(['a']);
    expect(cachedActivities()).toBe(first);
  });

  it('una salida importada vacía la caché y la siguiente lectura la trae', async () => {
    await saveActivity(ride('a', 1), []);
    await readActivities();
    await saveActivity(ride('b', 2), []);
    expect(cachedActivities()).toBeUndefined();
    expect(ids(await readActivities())).toEqual(['a', 'b']);
  });

  it('borrar todo vacía la caché', async () => {
    await saveActivity(ride('a', 1), []);
    await readActivities();
    await db.activities.clear();
    expect(cachedActivities()).toBeUndefined();
    expect(await readActivities()).toEqual([]);
  });

  it('una escritura en otra tabla no la vacía', async () => {
    await saveActivity(ride('a', 1), []);
    await readActivities();
    await db.meta.put({ key: 'x', value: 1 });
    expect(ids(cachedActivities())).toEqual(['a']);
  });

  it('una lectura que empezó antes de una escritura no queda guardada', async () => {
    await saveActivity(ride('a', 1), []);
    const stale = readActivities();
    await saveActivity(ride('b', 2), []);
    await stale;
    expect(cachedActivities()).toBeUndefined();
  });

  it('un error al leer no se guarda', async () => {
    db.close();
    await expect(readActivities()).rejects.toBeDefined();
    await db.open();
    await saveActivity(ride('a', 1), []);
    expect(ids(await readActivities())).toEqual(['a']);
  });
});

describe('activity cache per account', () => {
  it('drops the cached list when the app switches to another account database', async () => {
    const { useDatabase, db: before } = await import('../src/db/db');
    const { readActivities, cachedActivities } = await import('../src/db/activityCache');
    await readActivities();
    expect(cachedActivities()).toBeDefined();
    useDatabase('ciclismo-user-00000000-0000-0000-0000-0000000000aa');
    expect(cachedActivities()).toBeUndefined();
    const { db: after } = await import('../src/db/db');
    await after.delete();
    useDatabase(before.name);
  });
});
