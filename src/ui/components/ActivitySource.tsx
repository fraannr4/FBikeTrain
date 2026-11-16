import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../../db/db';
import type { StoredActivity } from '../../domain/types';

/** Atribución textual de los originales recibidos por la API oficial de Garmin. */
export function ActivitySource({ activity }: { activity: StoredActivity }) {
  if (activity.origin !== 'garmin-connect') return null;
  const device = activity.sourceDevice?.trim();
  const label = !device ? 'Garmin' : /garmin/i.test(device) ? device.replace(/garmin/i, 'Garmin') : `Garmin ${device}`;
  return <span className="activity-source">{label}</span>;
}

const GarminContext = createContext(false);
export function GarminAttributionProvider({ children }: { children: ReactNode }) {
  const [hasGarmin, setHasGarmin] = useState(false);
  const database = db;
  useEffect(() => {
    setHasGarmin(false);
    const subscription = liveQuery(() => database.activities.filter(a => a.origin === 'garmin-connect').first()).subscribe({
      next: activity => setHasGarmin(!!activity),
      error: () => setHasGarmin(false),
    });
    return () => subscription.unsubscribe();
  }, [database]);
  return <GarminContext.Provider value={hasGarmin}>{children}</GarminContext.Provider>;
}

export function GarminHistoryAttribution() {
  return useContext(GarminContext) ? <p className="garmin-history-attribution">Tu historial incluye datos de dispositivos Garmin.</p> : null;
}
