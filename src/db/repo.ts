import type { ClimbEffort, RouteSig, StoredActivity, TrackPoint } from '../domain/types';
import { db } from './db';

const LAST_IMPORT_KEY = 'lastImportAt';
const LAST_BACKUP_KEY = 'lastBackupAt';

/** Actividades ordenadas por inicio. `range` en epoch ms, ambos extremos incluidos. */
export function listActivities(range?: { from: number; to: number }): Promise<StoredActivity[]> {
  return range
    ? db.activities.where('startTime').between(range.from, range.to, true, true).toArray()
    : db.activities.orderBy('startTime').toArray();
}

/** Cuántas salidas hay, sin leerlas: con miles, leerlas todas cuesta más de un segundo. */
export function countActivities(): Promise<number> {
  return db.activities.count();
}

/** La primera salida por fecha de inicio. */
export function firstActivity(): Promise<StoredActivity | undefined> {
  return db.activities.orderBy('startTime').first();
}

/** La última salida por fecha de inicio que cumple `keep` (todas, sin filtro). */
export function lastActivity(keep?: (a: StoredActivity) => boolean): Promise<StoredActivity | undefined> {
  const desc = db.activities.orderBy('startTime').reverse();
  return (keep ? desc.filter(keep) : desc).first();
}

export function getActivity(id: string): Promise<StoredActivity | undefined> {
  return db.activities.get(id);
}

export async function getTrack(id: string): Promise<TrackPoint[] | undefined> {
  return (await db.tracks.get(id))?.points;
}

/** Esfuerzos en subidas; con `activityIds`, solo los de esas salidas (por el índice `activityId`). */
export function listClimbEfforts(activityIds?: string[]): Promise<ClimbEffort[]> {
  return activityIds ? db.climbEfforts.where('activityId').anyOf(activityIds).toArray() : db.climbEfforts.toArray();
}

export function listRouteSigs(): Promise<RouteSig[]> {
  return db.routeSigs.toArray();
}

export async function getMeta(): Promise<{ lastImportAt?: number; lastBackupAt?: number }> {
  const [imported, backup] = await Promise.all([db.meta.get(LAST_IMPORT_KEY), db.meta.get(LAST_BACKUP_KEY)]);
  return {
    ...(imported ? { lastImportAt: imported.value as number } : {}),
    ...(backup ? { lastBackupAt: backup.value as number } : {}),
  };
}

/** Guarda la actividad y, si trae puntos, su track, en una sola transacción. */
export async function saveActivity(activity: StoredActivity, track: TrackPoint[]): Promise<void> {
  await db.transaction('rw', db.activities, db.tracks, async () => {
    await db.activities.add(activity);
    if (track.length > 0) await db.tracks.add({ activityId: activity.id, points: track });
  });
}

export async function setLastImportAt(t: number): Promise<void> {
  await db.meta.put({ key: LAST_IMPORT_KEY, value: t });
}

export async function setLastBackupAt(t: number): Promise<void> {
  await db.meta.put({ key: LAST_BACKUP_KEY, value: t });
}

/** «Borrar todo»: vacía todas las tablas de la base en una sola transacción. */
export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.tables, () => Promise.all(db.tables.map((t) => t.clear())));
}
