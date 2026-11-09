import Dexie from 'dexie';
import { ANALYSIS_VERSION, analyzeActivity, ensureAnalysis, saveAnalysis } from '../src/analysis/analysis';
import { db, CyclingDb } from '../src/db/db';
import { getActivity, listActivities, listClimbEfforts, listRouteSigs, saveActivity } from '../src/db/repo';
import { importFiles } from '../src/import/importService';
import type { StoredActivity, TrackPoint } from '../src/domain/types';
import { SYNTH_START_T, synthClimbTrack, toGpx } from './helpers/synth';

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

const DAY_MS = 86_400_000;

function activity(i: number, hasTrack = true): StoredActivity {
  return {
    id: `a${i}`,
    startTime: SYNTH_START_T + i * DAY_MS,
    sport: 'cycling',
    totals: { distanceM: 3000, movingTimeS: 600, elapsedTimeS: 600, elevGainM: 100, avgSpeedMs: 5, maxSpeedMs: 6 },
    hasTrack,
    source: 'gpx',
    importedAt: 0,
  };
}

const climbTrack = (): TrackPoint[] => synthClimbTrack([{ lengthM: 1000, gradePct: 0 }, { lengthM: 2000, gradePct: 5 }]);
const flatTrack = (): TrackPoint[] => synthClimbTrack([{ lengthM: 100, gradePct: 0 }]);

async function clearAll() {
  await Promise.all([db.activities.clear(), db.tracks.clear(), db.meta.clear(), db.climbEfforts.clear(), db.routeSigs.clear()]);
}

describe('analysis', () => {
  // Va la primera: el `db` compartido aún no se ha abierto, así que la versión 1 se crea desde cero.
  it('migrates v1 database keeping activities', async () => {
    db.close();
    await Dexie.delete('ciclismo');
    const v1 = new Dexie('ciclismo');
    v1.version(1).stores({ activities: 'id, startTime', tracks: 'activityId', settings: 'key', meta: 'key' });
    await v1.table('activities').add(activity(1));
    v1.close();

    const v2 = new CyclingDb();
    expect(await v2.activities.get('a1')).toMatchObject({ id: 'a1' });
    expect(await v2.climbEfforts.count()).toBe(0);
    expect(await v2.routeSigs.count()).toBe(0);
    v2.close();
    await db.open();
  });

  describe('with a clean database', () => {
    beforeEach(clearAll);

    it('import stores efforts and route signature', async () => {
      const report = await importFiles([new File([toGpx(climbTrack())], 'subida.gpx')]);
      expect(report.added).toBe(1);

      const [a] = await listActivities();
      const efforts = await listClimbEfforts();
      expect(efforts).toHaveLength(1);
      expect(efforts[0].activityId).toBe(a.id);
      const sigs = await listRouteSigs();
      expect(sigs).toHaveLength(1);
      expect(sigs[0].activityId).toBe(a.id);
      expect(await getActivity(a.id)).toEqual(a);
    });

    it('activity without track gets no analysis', async () => {
      await saveActivity(activity(1, false), []);
      expect(await ensureAnalysis()).toBe(0);
      expect(await db.climbEfforts.count()).toBe(0);
      expect(await db.routeSigs.count()).toBe(0);
    });

    it('ensureAnalysis analyzes only missing or outdated', async () => {
      const acts = [activity(1), activity(2), activity(3)];
      for (const a of acts) await saveActivity(a, climbTrack());
      await saveAnalysis(analyzeActivity(acts[0], climbTrack()));
      const outdated = analyzeActivity(acts[1], climbTrack());
      await saveAnalysis({ ...outdated, sig: { ...outdated.sig, analysisVersion: 0 } });

      expect(await ensureAnalysis()).toBe(2);
      const rows = await db.routeSigs.toArray();
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.analysisVersion === ANALYSIS_VERSION)).toBe(true);
      expect(await ensureAnalysis()).toBe(0);
    });

    it('reports progress in batches', async () => {
      for (let i = 0; i < 120; i++) await saveActivity(activity(i), flatTrack());
      const calls: [number, number][] = [];
      expect(await ensureAnalysis((done, total) => calls.push([done, total]))).toBe(120);
      expect(calls).toEqual([
        [50, 120],
        [100, 120],
        [120, 120],
      ]);
    });

    it('reanalysis replaces efforts', async () => {
      const a = activity(1);
      const result = analyzeActivity(a, climbTrack());
      expect(result.efforts.map((e) => e.id)).toEqual(['a1_0']);
      expect(result.efforts[0]).toMatchObject({ activityId: 'a1', activityStart: a.startTime });

      await saveAnalysis(result);
      await saveAnalysis(result);
      expect(await db.climbEfforts.count()).toBe(1);
      expect(await db.routeSigs.count()).toBe(1);
    });
  });
});
