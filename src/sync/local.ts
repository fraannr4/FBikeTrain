import { isValidGoal } from '../calendar/calendarRepo';
import { db } from '../db/db';
import type { Goal, PlannedWorkout, RiderThresholds, Settings, StoredActivity, TrackPoint } from '../domain/types';
import type { ReferenceRoute } from '../routes/library';
import { loadSettings, saveSettings } from '../settings/settings';

/**
 * Qué datos locales entran en la copia entre dispositivos y cómo se leen y se escriben.
 * No entran: los datos de demostración, las rutas del catálogo precargado (se vuelven a descargar),
 * las claves de servicio propias ni lo que se recalcula a partir de las salidas (subidas, firmas).
 */
export const SYNC_KINDS = ['activity', 'track', 'workout', 'goal', 'route', 'settings'] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];
export const SETTINGS_ID = 'app';

export const syncKey = (kind: SyncKind, id: string) => `${kind}:${id}`;
export function parseSyncKey(key: string): { kind: SyncKind; id: string } | null {
  const at = key.indexOf(':');
  const kind = key.slice(0, at) as SyncKind;
  return at > 0 && SYNC_KINDS.includes(kind) ? { kind, id: key.slice(at + 1) } : null;
}

/** Ajustes que viajan: nombre, Casa y umbrales. Las claves de ORS y de IA se quedan en el dispositivo. */
type SyncedSettings = { displayName: string; home: Settings['home']; thresholds?: RiderThresholds };
const syncedSettings = (s: Settings): SyncedSettings => ({
  displayName: s.displayName,
  home: s.home,
  ...(s.thresholds ? { thresholds: s.thresholds } : {}),
});

/** Huella corta del contenido (FNV-1a de 32 bits sobre el JSON): basta para saber si algo cambió. */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length.toString(36)}.${(hash >>> 0).toString(36)}`;
}

/** Las salidas y los tracks no cambian una vez guardados: basta con saber que están. */
const PRESENT = '1';
/** El mismo prefijo que `DEMO_PREFIX` de la demo, que se carga aparte y no debe entrar en este módulo. */
const isDemo = (id: string) => id.startsWith('demo-');

export type LocalEntry = {
  hash: string;
  /** Fecha propia del dato, para la primera vez que este dispositivo lo anota. */
  stamp: number;
  /** Rutas: hay que leerla para saber si es del catálogo (y entonces no se sincroniza). */
  unknownRoute?: boolean;
};

/**
 * Estado actual de lo sincronizable, sin leer lo pesado: de salidas, tracks y rutas solo las claves.
 * `known` dice si una ruta ya está anotada con esa misma fecha, para no volver a leerla.
 */
export async function scanLocal(known: (key: string, hash: string) => boolean): Promise<Map<string, LocalEntry>> {
  const out = new Map<string, LocalEntry>();
  const [activityIds, trackIds, workouts, goals, settings] = await Promise.all([
    db.activities.toCollection().primaryKeys(),
    db.tracks.toCollection().primaryKeys(),
    db.calendar.toArray(),
    db.goals.toArray(),
    db.settings.get('app'),
  ]);
  for (const id of activityIds) if (!isDemo(id)) out.set(syncKey('activity', id), { hash: PRESENT, stamp: 0 });
  for (const id of trackIds) if (!isDemo(id)) out.set(syncKey('track', id), { hash: PRESENT, stamp: 0 });
  for (const w of workouts) if (!isDemo(w.id)) out.set(syncKey('workout', w.id), { hash: fingerprint(w), stamp: w.createdAt });
  for (const g of goals) if (!isDemo(g.id)) out.set(syncKey('goal', g.id), { hash: fingerprint(g), stamp: g.createdAt });
  if (settings) out.set(syncKey('settings', SETTINGS_ID), { hash: fingerprint(syncedSettings(settings.value)), stamp: 0 });

  const routes: Array<{ id: string; updatedAt: number }> = [];
  await db.referenceRoutes.orderBy('updatedAt').eachKey((updatedAt, cursor) => {
    routes.push({ id: cursor.primaryKey, updatedAt: updatedAt as number });
  });
  for (const r of routes) {
    const key = syncKey('route', r.id);
    const hash = String(r.updatedAt);
    out.set(key, { hash, stamp: r.updatedAt, unknownRoute: !known(key, hash) });
  }
  return out;
}

/** ¿Es una ruta del catálogo precargado? Esas no se suben. */
export async function isCatalogRoute(id: string): Promise<boolean> {
  return Boolean((await db.referenceRoutes.get(id))?.catalog);
}

/** Contenido que se sube; `undefined` si el dato ya no existe. */
export async function readLocal(kind: SyncKind, id: string): Promise<unknown> {
  switch (kind) {
    case 'activity': return db.activities.get(id);
    case 'track': return (await db.tracks.get(id))?.points;
    case 'workout': return db.calendar.get(id);
    case 'goal': return db.goals.get(id);
    case 'route': return db.referenceRoutes.get(id);
    case 'settings': {
      const row = await db.settings.get('app');
      return row ? syncedSettings(row.value) : undefined;
    }
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isActivity(v: unknown, id: string): v is StoredActivity {
  return isRecord(v) && v.id === id && isFiniteNumber(v.startTime) && v.sport === 'cycling' && isRecord(v.totals)
    && typeof v.hasTrack === 'boolean' && typeof v.source === 'string' && isFiniteNumber(v.importedAt);
}
function isTrack(v: unknown): v is TrackPoint[] {
  return Array.isArray(v) && v.every((p) => isRecord(p) && isFiniteNumber(p.t));
}
function isWorkout(v: unknown, id: string): v is PlannedWorkout {
  return isRecord(v) && v.id === id && typeof v.title === 'string' && typeof v.date === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(v.date) && typeof v.done === 'boolean' && typeof v.manual === 'boolean' && isFiniteNumber(v.createdAt);
}
function isRoute(v: unknown, id: string): v is ReferenceRoute {
  return isRecord(v) && v.id === id && typeof v.name === 'string' && (v.format === 'gpx' || v.format === 'tcx')
    && typeof v.originalXml === 'string' && Array.isArray(v.points) && Array.isArray(v.originalPoints)
    && isRecord(v.summary) && isFiniteNumber(v.createdAt) && isFiniteNumber(v.updatedAt) && !v.catalog;
}
function isSyncedSettings(v: unknown): v is SyncedSettings {
  if (!isRecord(v) || typeof v.displayName !== 'string') return false;
  const home = v.home;
  if (home !== null && !(isRecord(home) && isFiniteNumber(home.lat) && isFiniteNumber(home.lng))) return false;
  return v.thresholds === undefined || isRecord(v.thresholds);
}

export class SyncDataError extends Error {
  constructor(key: string) {
    super(`Dato sincronizado no válido: ${key}`);
    this.name = 'SyncDataError';
  }
}

/**
 * Escribe en local un dato llegado de otro dispositivo y devuelve su huella (la de lo que queda guardado). Valida la forma antes
 * de escribir: un contenido que no encaja se rechaza entero.
 */
export async function writeLocal(kind: SyncKind, id: string, value: unknown, keepLocal = false): Promise<string> {
  const bad = () => new SyncDataError(syncKey(kind, id));
  switch (kind) {
    case 'activity':
      if (!isActivity(value, id)) throw bad();
      await db.activities.put(value);
      return PRESENT;
    case 'track':
      if (!isTrack(value)) throw bad();
      // El análisis guardado se hizo, si acaso, sin este track: se descarta para repetirlo.
      await db.transaction('rw', db.tracks, db.climbEfforts, db.routeSigs, async () => {
        await db.tracks.put({ activityId: id, points: value });
        await db.climbEfforts.where('activityId').equals(id).delete();
        await db.routeSigs.delete(id);
      });
      return PRESENT;
    case 'workout':
      if (!isWorkout(value, id)) throw bad();
      await db.calendar.put(value);
      return fingerprint(value);
    case 'goal':
      if (!isValidGoal(value) || (value as Goal).id !== id) throw bad();
      await db.goals.put(value as Goal);
      return fingerprint(value);
    case 'route':
      if (!isRoute(value, id)) throw bad();
      await db.referenceRoutes.put(value);
      return String(value.updatedAt);
    case 'settings': {
      if (id !== SETTINGS_ID || !isSyncedSettings(value)) throw bad();
      const current = await loadSettings();
      const { thresholds: _old, ...rest } = current;
      // `keepLocal`: primera vez que se cruzan los ajustes de dos dispositivos. Lo que este tiene se
      // conserva y solo se rellena lo que le falta.
      const remote = value.thresholds;
      const thresholds: RiderThresholds | undefined = keepLocal && current.thresholds
        ? {
            ftpW: current.thresholds.ftpW ?? remote?.ftpW ?? null,
            maxHr: current.thresholds.maxHr ?? remote?.maxHr ?? null,
            thresholdHr: current.thresholds.thresholdHr ?? remote?.thresholdHr ?? null,
          }
        : remote;
      const next: Settings = {
        ...rest,
        displayName: keepLocal && current.displayName ? current.displayName : value.displayName,
        home: keepLocal && current.home ? current.home : value.home,
        ...(thresholds ? { thresholds } : {}),
      };
      await saveSettings(next);
      return fingerprint(syncedSettings(next));
    }
  }
}

/** Borra en local un dato borrado en otro dispositivo. Una salida se lleva su track y su análisis. */
export async function removeLocal(kind: SyncKind, id: string): Promise<void> {
  switch (kind) {
    case 'activity':
      await db.transaction('rw', db.activities, db.tracks, db.climbEfforts, db.routeSigs, async () => {
        await db.activities.delete(id);
        await db.tracks.delete(id);
        await db.climbEfforts.where('activityId').equals(id).delete();
        await db.routeSigs.delete(id);
      });
      return;
    case 'track': await db.tracks.delete(id); return;
    case 'workout': await db.calendar.delete(id); return;
    case 'goal': await db.goals.delete(id); return;
    case 'route': await db.referenceRoutes.delete(id); return;
    // Los ajustes no se borran: el dispositivo conserva los suyos.
    case 'settings': return;
  }
}
