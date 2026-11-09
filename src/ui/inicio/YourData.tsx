import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { TZ } from '../../metrics/aggregate';
import { List, ListRow } from '../components/ListRow';
import { daysAgoLabel, formatCount } from '../format';
import { Archive, Upload } from '../icons';
import { IMPORT_REMINDER_DAYS } from './inicioNotices';

const DAY_MS = 86_400_000;
const TITLE_ID = 'inicio-datos';

type Props = {
  rides: number;
  /** Inicio de la primera salida guardada. */
  firstStart: number;
  lastImportAt?: number;
  lastBackupAt?: number;
  now: number;
};

const daysSince = (now: number, t: number) => Math.max(0, Math.floor((now - t) / DAY_MS));

/**
 * Tus datos: importar y hacer copia, con lo que pasó la última vez. La fila pasa a tono de aviso
 * cuando toca hacerlo (más de una semana sin importar, o salidas sin copiar).
 */
export function YourData({ rides, firstStart, lastImportAt, lastBackupAt, now }: Props) {
  const since = format(new TZDate(firstStart, TZ), "MMMM 'de' yyyy", { locale: es });
  const count = `${formatCount(rides)} ${rides === 1 ? 'salida' : 'salidas'} desde ${since}.`;

  const importDays = lastImportAt === undefined ? null : daysSince(now, lastImportAt);
  const importStale = importDays !== null && importDays > IMPORT_REMINDER_DAYS;
  const importMeta =
    importDays === null
      ? count
      : `Importaste ${daysAgoLabel(importDays)}${importStale ? ': toca traer las nuevas' : ''}. ${count}`;

  const backupStale = lastBackupAt === undefined || (lastImportAt !== undefined && lastImportAt > lastBackupAt);
  const backupMeta =
    lastBackupAt === undefined
      ? 'Aún no has hecho ninguna'
      : `La última, ${daysAgoLabel(daysSince(now, lastBackupAt))}${
          lastImportAt !== undefined && lastImportAt > lastBackupAt ? ', anterior a la última importación' : ''
        }`;

  return (
    <section className="section" aria-labelledby={TITLE_ID}>
      <div className="section-h">
        <h2 className="section-title" id={TITLE_ID}>
          Tus datos
        </h2>
      </div>
      <List inset>
        <ListRow
          to="/importar"
          icon={Upload}
          accent="dist"
          leadTone={importStale ? 'warn' : undefined}
          title="Importar salidas"
          meta={importMeta}
        />
        <ListRow
          to="/ajustes"
          icon={Archive}
          leadTone={backupStale ? 'warn' : undefined}
          title="Hacer copia de seguridad"
          meta={backupMeta}
        />
      </List>
    </section>
  );
}
