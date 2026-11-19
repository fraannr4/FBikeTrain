import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBackupMeta } from '../../backup/backup';
import { countActivities, getMeta } from '../../db/repo';
import { Archive, Bike, Lock, SlidersHorizontal, TriangleAlert, Upload } from '../icons';
import { List, ListRow } from '../components/ListRow';
import { Skeleton } from '../components/Skeleton';
import { StateView } from '../components/StateView';
import { backupSummary, importText, type MasSummary } from '../mas/masSummary';

type Datos = { rides: number; import: string; backup: MasSummary['backup'] };

async function loadDatos(): Promise<Datos> {
  const [rides, meta, backup] = await Promise.all([countActivities(), getMeta(), getBackupMeta()]);
  const now = Date.now();
  return { rides, import: importText(meta.lastImportAt, now), backup: backupSummary(backup, now) };
}

/**
 * Lo de este dispositivo en «Tú», antes de la ficha: Importar salidas, Ajustes, Copia de seguridad
 * (con el aviso de cambios sin copiar) y Privacidad. Sin salidas, primero la tarjeta para importar.
 * Si el almacenamiento falla, las filas siguen sin su dato.
 */
export function DatosYAjustes() {
  const [datos, setDatos] = useState<Datos | 'error' | null>(null);

  useEffect(() => {
    let alive = true;
    loadDatos().then(
      (d) => { if (alive) setDatos(d); },
      () => { if (alive) setDatos('error'); },
    );
    return () => { alive = false; };
  }, []);

  const d = datos === 'error' ? null : datos;
  const meta = (text: string | undefined) => (datos === null ? <Skeleton /> : text);
  const empty = d?.rides === 0;
  const warn = d?.backup.warn === true;

  return (
    <>
      {empty ? (
        <div className="card start-card">
          <StateView
            icon={Bike}
            title="Empieza por tu archivo de Strava"
            text="Con él verás tu progresión, tus subidas y tus rutas repetidas."
            action={
              <>
                <Link className="btn btn--primary btn--block" to="/importar">
                  <Upload className="ic" aria-hidden="true" />
                  Importar salidas
                </Link>
                <Link className="btn btn--ghost btn--block" to="/ajustes?abrir=restaurar">
                  ¿Vienes de otro teléfono? Restaurar una copia
                </Link>
              </>
            }
          />
        </div>
      ) : null}
      <List inset label="Tus datos y ajustes">
        {empty ? null : <ListRow to="/importar" icon={Upload} accent="dist" title="Importar salidas" meta={meta(d?.import)} />}
        <ListRow to="/ajustes" icon={SlidersHorizontal} title="Ajustes" meta="Zona, punto de salida y tema" />
        {empty ? null : (
          <ListRow
            to="/ajustes?abrir=copia"
            icon={Archive}
            leadTone={warn ? 'warn' : undefined}
            title="Copia de seguridad"
            meta={meta(d?.backup.text)}
            trail={
              warn ? (
                <>
                  <TriangleAlert className="trail-warn" aria-hidden="true" />
                  <span className="sr-only">Hay cambios sin copiar.</span>
                </>
              ) : undefined
            }
          />
        )}
        <ListRow href="#/privacidad" icon={Lock} title="Privacidad" meta="Qué se guarda y quién lo ve" />
      </List>
    </>
  );
}
