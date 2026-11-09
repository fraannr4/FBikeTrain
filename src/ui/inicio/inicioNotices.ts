import { daysAgoLabel, formatCount } from '../format';

const DAY_MS = 86_400_000;
/** A partir de cuántos días sin importar se recuerda hacerlo (el mismo umbral que `.notice`). */
export const IMPORT_REMINDER_DAYS = 7;

export type Notice = { id: 'import' | 'backup'; text: string; action: string; href: string };

const daysSince = (now: number, t: number) => Math.floor((now - t) / DAY_MS);

/**
 * Avisos locales de Inicio en F1, calculados con lo que hay en la base. Nada se inventa.
 * Sin salidas no hay avisos: el estado vacío ya invita a importar.
 */
export function inicioNotices({
  now,
  rides,
  lastImportAt,
  lastBackupAt,
}: {
  now: number;
  rides: number;
  lastImportAt?: number;
  lastBackupAt?: number;
}): Notice[] {
  if (rides === 0) return [];
  const out: Notice[] = [];

  if (lastImportAt !== undefined) {
    const days = daysSince(now, lastImportAt);
    if (days > IMPORT_REMINDER_DAYS)
      out.push({
        id: 'import',
        text: `Última importación hace ${formatCount(days)} días.`,
        action: 'Importar salidas nuevas',
        href: '#/importar',
      });
  }

  const backup = { id: 'backup', action: 'Hacer copia', href: '#/ajustes' } as const;
  if (lastBackupAt === undefined) {
    out.push({ ...backup, text: 'Aún no has hecho ninguna copia de seguridad.' });
  } else if (lastImportAt !== undefined && lastImportAt > lastBackupAt) {
    out.push({
      ...backup,
      text: `Tienes salidas importadas después de tu última copia, de ${daysAgoLabel(daysSince(now, lastBackupAt))}.`,
    });
  }
  return out;
}
