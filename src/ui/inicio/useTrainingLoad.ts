import { useEffect, useMemo, useState } from 'react';
import { getTrack } from '../../db/repo';
import type { RiderThresholds, StoredActivity } from '../../domain/types';
import { isTooShort } from '../../import/summary';
import { rideLoad } from '../../metrics/load';
import { LOAD_WINDOW_DAYS, type LoadItem } from './loadModel';

const DAY_MS = 86_400_000;
const BATCH = 8;

/** El track solo cambia el resultado si hay un umbral que use el sensor que la salida trae. */
function needsTrack(a: StoredActivity, t: RiderThresholds): boolean {
  if (!a.hasTrack) return false;
  return ((t.ftpW ?? 0) > 0 && (a.totals.avgPower ?? 0) > 0) || (((t.maxHr ?? 0) > 0 || (t.thresholdHr ?? 0) > 0) && (a.totals.avgHr ?? 0) > 0);
}

export type TrainingLoad = { status: 'loading' } | { status: 'ready'; items: LoadItem[] };

/**
 * Carga de cada salida de los últimos `LOAD_WINDOW_DAYS`. Lee el track solo de las salidas que lo
 * necesitan, de ocho en ocho, y recalcula si cambian las salidas o los umbrales.
 */
export function useTrainingLoad(acts: StoredActivity[], thresholds: RiderThresholds, now: number): TrainingLoad {
  const [done, setDone] = useState<{ key: string; items: LoadItem[] } | null>(null);
  const key = useMemo(() => `${acts.length}:${acts.at(-1)?.id ?? ''}:${now}:${JSON.stringify(thresholds)}`, [acts, now, thresholds]);

  useEffect(() => {
    let alive = true;
    const from = now - LOAD_WINDOW_DAYS * DAY_MS;
    const rides = acts.filter((a) => a.startTime >= from && a.startTime <= now && !isTooShort(a.totals));
    (async () => {
      const items: LoadItem[] = [];
      for (let i = 0; i < rides.length; i += BATCH) {
        const batch = rides.slice(i, i + BATCH);
        const loaded = await Promise.all(
          batch.map(async (a) => {
            let track;
            if (needsTrack(a, thresholds)) {
              try {
                track = await getTrack(a.id);
              } catch {
                track = undefined; // sin track se usa la media de la salida
              }
            }
            const l = rideLoad(a.totals, track, thresholds);
            return { startTime: a.startTime, tss: l.tss, source: l.source };
          }),
        );
        items.push(...loaded);
      }
      if (alive) setDone({ key, items });
    })();
    return () => {
      alive = false;
    };
  }, [acts, thresholds, now, key]);

  return done && done.key === key ? { status: 'ready', items: done.items } : { status: 'loading' };
}
