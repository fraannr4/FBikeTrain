import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../../auth/AccountBoundary';
import { getBackupMeta } from '../../backup/backup';
import { listGoals, listWorkouts } from '../../calendar/calendarRepo';
import { getMeta, listActivities, listClimbEfforts, listRouteSigs } from '../../db/repo';
import { formatCount, formatKm } from '../format';
import {
  Archive,
  Bike,
  Calendar,
  Lock,
  Moon,
  Mountain,
  Repeat,
  SlidersHorizontal,
  Sun,
  Target,
  TriangleAlert,
  Upload,
  User,
} from '../icons';
import { Banner } from '../components/Banner';
import { List, ListRow } from '../components/ListRow';
import { Page } from '../components/Page';
import { Skeleton } from '../components/Skeleton';
import { StateView } from '../components/StateView';
import { masSummary, type MasData, type MasSummary } from '../mas/masSummary';
import { setTheme, useTheme } from '../theme/theme';

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; summary: MasSummary };

async function loadMasData(): Promise<MasData> {
  const [activities, efforts, sigs, workouts, goals, meta, backup] = await Promise.all([
    listActivities(),
    listClimbEfforts(),
    listRouteSigs(),
    listWorkouts(),
    listGoals(),
    getMeta(),
    getBackupMeta(),
  ]);
  return { activities, efforts, sigs, workouts, goals, lastImportAt: meta.lastImportAt, ...backup };
}

/** Botón de tema de la barra superior: el tema a un toque, como en el prototipo. */
function ThemeButton() {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const Icon = theme === 'dark' ? Sun : Moon;
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={next === 'light' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      onClick={() => setTheme(next)}
    >
      <Icon className="ic" aria-hidden="true" />
    </button>
  );
}

/**
 * Más: Explorar (las vistas de Historial y Plan, con lo que dice cada una) y Datos y ajustes
 * (Ajustes, Importar y la copia). Sin salidas, lo primero es importar; sin almacenamiento, solo queda
 * «Reintentar».
 */
export function Mas() {
  const account = useAccount();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setLoad({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    loadMasData().then(
      (d) => {
        if (alive) setLoad({ kind: 'ready', summary: masSummary(d, Date.now()) });
      },
      () => {
        if (alive) setLoad({ kind: 'error' });
      },
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  const s = load.kind === 'ready' ? load.summary : null;
  const loading = load.kind === 'loading';
  const off = load.kind === 'error';
  const empty = s !== null && s.rides === 0;
  /** Meta de una fila: esqueleto mientras carga; nada si no hay almacenamiento. */
  const meta = (text: ReactNode) => (loading ? <Skeleton /> : off ? undefined : text);
  /** Con error, las filas que dependen de los datos no llevan a ningún sitio. */
  const to = (path: string) => (off ? undefined : path);

  let lead: ReactNode = null;
  if (loading)
    lead = (
      <span className="lead-sk" aria-hidden="true">
        <Skeleton width="88%" />
        <Skeleton width="52%" />
      </span>
    );
  else if (empty) lead = 'Aún no hay salidas en este navegador.';
  else if (s)
    lead = (
      <>
        <b>{s.rides === 1 ? '1 salida' : `${formatCount(s.rides)} salidas`}</b> · <b>{formatKm(s.distanceM)}</b> en este
        navegador
      </>
    );

  const explorar = (
    <section className="section" aria-labelledby="s-explorar" key="explorar">
      <div className="section-h">
        <h2 className="section-title" id="s-explorar">
          Explorar
        </h2>
      </div>
      <List inset className={off ? 'list--off' : undefined}>
        <ListRow
          to={to('/historial/subidas')}
          icon={Mountain}
          accent="elev"
          title={<Where name="Subidas" tab="Historial" />}
          meta={meta(s?.climbs)}
        />
        <ListRow
          to={to('/historial/repetidas')}
          icon={Repeat}
          accent="time"
          title={<Where name="Repetidas" tab="Historial" />}
          meta={meta(s?.routes)}
        />
        <ListRow
          to={to('/plan')}
          icon={Calendar}
          accent="dist"
          title={<Where name="Calendario" tab="Plan" />}
          meta={meta(s?.calendar)}
        />
        <ListRow
          to={to('/plan/objetivos')}
          icon={Target}
          accent="elev"
          title={<Where name="Objetivos" tab="Plan" />}
          meta={meta(s?.goal.text)}
          value={s?.goal.pct !== undefined ? formatCount(s.goal.pct) : undefined}
          unit={s?.goal.pct !== undefined ? '%' : undefined}
        />
      </List>
    </section>
  );

  const backupWarn = s?.backup.warn === true;
  const datos = (
    <section className="section" aria-labelledby="s-datos" key="datos">
      <div className="section-h">
        <h2 className="section-title" id="s-datos">
          Datos y ajustes
        </h2>
      </div>
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
      <List inset className={off ? 'list--off' : undefined}>
        {account && <ListRow to="/perfil" icon={User} title="Tu perfil" meta="Nombre, privacidad y cuenta" />}
        <ListRow to="/ajustes" icon={SlidersHorizontal} title="Ajustes" meta="Nombre, Casa, claves y tema" />
        {empty ? null : (
          <ListRow to={to('/importar')} icon={Upload} accent="dist" title="Importar salidas" meta={meta(s?.import)} />
        )}
        {empty ? null : (
          <ListRow
            to={to('/ajustes?abrir=copia')}
            icon={Archive}
            leadTone={backupWarn ? 'warn' : undefined}
            title="Copia de seguridad"
            meta={meta(s?.backup.text)}
            trail={
              backupWarn ? (
                <>
                  <TriangleAlert className="trail-warn" aria-hidden="true" />
                  <span className="sr-only">Hay cambios sin copiar.</span>
                </>
              ) : undefined
            }
          />
        )}
      </List>
    </section>
  );

  return (
    <Page title="Más" variant="narrow" className="page--mas" lead={lead} actions={<ThemeButton />} busy={loading}>
      {loading ? (
        <span className="sr-only" role="status">
          Cargando tus datos
        </span>
      ) : null}
      {off ? (
        <Banner
          tone="error"
          action={
            <button type="button" className="btn btn--ghost" onClick={retry}>
              Reintentar
            </button>
          }
        >
          <b>No se pueden leer tus datos.</b> Este navegador bloquea el almacenamiento: pasa en modo privado o con el
          espacio lleno. Abre la app en una pestaña normal.
        </Banner>
      ) : null}
      {/* Sin salidas, lo primero es importar: «Datos y ajustes» sube por encima de Explorar. */}
      {empty ? [datos, explorar] : [explorar, datos]}
      <p className="page-note">
        <Lock className="ic" aria-hidden="true" />
        <span>{account ? 'Tus salidas están guardadas en este dispositivo para tu cuenta. La sincronización todavía no está disponible.' : 'Sin servidor: tus salidas solo están en este navegador y en las copias que descargues.'}</span>
      </p>
    </Page>
  );
}

/** «Subidas en Historial»: junto al nombre, en qué pestaña se abre; la meta queda para el dato. */
function Where({ name, tab }: { name: string; tab: string }) {
  return (
    <>
      {name} <span className="row-where">en {tab}</span>
    </>
  );
}
