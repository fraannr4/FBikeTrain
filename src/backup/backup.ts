import { isValidGoal } from '../calendar/calendarRepo';
import { syncCalendar } from '../calendar/sync';
import { db } from '../db/db';
import { setLastBackupAt } from '../db/repo';
import type { Goal, PlannedWorkout, Settings } from '../domain/types';
import { loadSettings, saveSettings } from '../settings/settings';

const LAST_BACKUP_KEY = 'lastBackupAt';
/** La escribe el repositorio del calendario en cada cambio de entrenos u objetivos. */
const CALENDAR_CHANGED_KEY = 'calendarChangedAt';
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Copia de seguridad de lo que no se reconstruye reimportando: ajustes, calendario y objetivos.
 * Las salidas no van: se reimportan.
 */
export type BackupFile = {
  app: 'ciclismo';
  version: 1;
  exportedAt: string;
  settings: Omit<Settings, 'ors' | 'llm'> & { ors?: Settings['ors']; llm?: Settings['llm'] };
  calendar: PlannedWorkout[];
  goals: Goal[];
};

export class BackupError extends Error {
  constructor(public readonly reason: 'version' | 'format') {
    super(reason === 'version' ? 'Versión de copia no admitida' : 'El fichero no es una copia válida');
    this.name = 'BackupError';
  }
}

export async function exportBackup(opts: { includeKeys: boolean }): Promise<Blob> {
  const { ors, llm, ...rest } = await loadSettings();
  const [calendar, goals] = await Promise.all([db.calendar.toArray(), db.goals.toArray()]);
  const file: BackupFile = {
    app: 'ciclismo',
    version: 1,
    exportedAt: new Date().toISOString(),
    // Sin claves se omiten ors y llm enteros, para que ningún dato de conexión salga del navegador.
    settings: opts.includeKeys ? { ...rest, ors, llm } : rest,
    calendar,
    goals,
  };
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  await setLastBackupAt(Date.now());
  return blob;
}

/**
 * Restaura los ajustes y sustituye el calendario y los objetivos. Si la copia no trae claves,
 * se conservan las que ya hay en este navegador. Se valida todo antes de escribir nada.
 */
export async function restoreBackup(file: Blob): Promise<void> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new BackupError('format');
  }
  if (!isRecord(data) || data.app !== 'ciclismo') throw new BackupError('format');
  if (data.version !== 1) throw new BackupError('version');
  const s = data.settings;
  if (!isRecord(s) || typeof s.displayName !== 'string' || !isHome(s.home)) throw new BackupError('format');
  if (s.ors !== undefined && !isOrs(s.ors)) throw new BackupError('format');
  if (s.llm !== undefined && !isLlm(s.llm)) throw new BackupError('format');
  const { calendar, goals } = data;
  if (!Array.isArray(calendar) || !calendar.every(isWorkout)) throw new BackupError('format');
  if (!Array.isArray(goals) || !goals.every(isValidGoal)) throw new BackupError('format');

  const current = await loadSettings();
  const settings: Settings = {
    displayName: s.displayName,
    home: s.home,
    ors: s.ors ?? current.ors,
    llm: s.llm ?? current.llm,
  };
  await db.transaction('rw', db.settings, db.calendar, db.goals, async () => {
    await saveSettings(settings);
    await db.calendar.clear();
    await db.calendar.bulkPut(calendar);
    await db.goals.clear();
    await db.goals.bulkPut(goals);
  });
  // Se sincroniza antes de anotar la copia: las marcas que añada salen de las salidas, que se
  // reconstruyen reimportando, y no deben dejar el aviso de «cambios sin copia» recién restaurado.
  await syncCalendar();
  await setLastBackupAt(Date.now());
}

export async function getBackupMeta(): Promise<{ lastBackupAt?: number; calendarChangedAt?: number }> {
  const [backup, changed] = await Promise.all([db.meta.get(LAST_BACKUP_KEY), db.meta.get(CALENDAR_CHANGED_KEY)]);
  return {
    ...(backup ? { lastBackupAt: backup.value as number } : {}),
    ...(changed ? { calendarChangedAt: changed.value as number } : {}),
  };
}

/** Hay cambios en el calendario o los objetivos posteriores a la última copia (o nunca hubo copia). */
export function needsBackup(m: { lastBackupAt?: number; calendarChangedAt?: number }): boolean {
  if (m.calendarChangedAt === undefined) return false;
  return m.lastBackupAt === undefined || m.calendarChangedAt > m.lastBackupAt;
}

function isWorkout(v: unknown): v is PlannedWorkout {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.date === 'string' &&
    LOCAL_DATE_RE.test(v.date) &&
    typeof v.done === 'boolean' &&
    typeof v.manual === 'boolean'
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isHome(v: unknown): v is Settings['home'] {
  return v === null || (isRecord(v) && typeof v.lat === 'number' && typeof v.lng === 'number');
}

function isOrs(v: unknown): v is Settings['ors'] {
  return isRecord(v) && typeof v.apiKey === 'string';
}

function isLlm(v: unknown): v is Settings['llm'] {
  return isRecord(v) && typeof v.baseUrl === 'string' && typeof v.apiKey === 'string' && typeof v.model === 'string';
}
