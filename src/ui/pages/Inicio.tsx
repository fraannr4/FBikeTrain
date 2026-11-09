import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigationType } from 'react-router-dom';
import type { Goal, PlannedWorkout, StoredActivity, TrackPoint } from '../../domain/types';
import { countActivities, firstActivity, getMeta, getTrack, lastActivity, listActivities } from '../../db/repo';
import { listGoals, listWorkouts } from '../../calendar/calendarRepo';
import { loadSettings } from '../../settings/settings';
import { isTooShort } from '../../import/summary';
import { currentWeekVsAverage, type PeriodTotals } from '../../metrics/aggregate';
import { volumeProgress } from '../../metrics/calendar';
import { computeReference, difficulty } from '../../metrics/reference';
import type { Accent } from '../accent';
import { formatDuration, formatKm, formatMeters, formatCount, formatSpeed } from '../format';
import { Bike, Eye, Gauge, Mountain, RefreshCw, Route, Timer, TriangleAlert, Upload, type LucideIcon } from '../icons';
import { profileExtent, profileFromTrack } from '../profile';
import { DECOR_PROFILE } from '../scene/scene';
import { RideMapCard } from '../components/RideMapCard';
import { Skeleton } from '../components/Skeleton';
import { StateView } from '../components/StateView';
import { StravaHowTo } from '../components/StravaHowTo';
import { EventGoalRow, GoalGlance } from '../inicio/GoalGlance';
import { Hero } from '../inicio/Hero';
import { heroDate, heroSentence } from '../inicio/heroCopy';
import { lastData, rememberData, rememberScroll, savedScroll } from '../inicio/inicioMemory';
import { heroLead, pickGoals, pickUpcoming, volumeGlance, weekCaption, weekDeltas } from '../inicio/inicioPlan';
import { KpiCard } from '../inicio/KpiCard';
import { NextWorkout } from '../inicio/NextWorkout';
import { TrendCard } from '../inicio/TrendCard';
import { weeklyTrend } from '../inicio/trend';
import { YourData } from '../inicio/YourData';

const NO_POINTS: TrackPoint[] = [];
const DAY_MS = 86_400_000;
/**
 * La semana y sus 4 anteriores caben en 6 semanas hacia atrás (con margen por el cambio de hora).
 * Con miles de salidas, solo esas pasan por la conversión de zona horaria.
 */
const WEEK_WINDOW_MS = 6 * 7 * DAY_MS;
/**
 * Salidas que Inicio lee enteras: la tendencia (12 semanas y la actual), la referencia de nivel (hasta
 * 12 semanas) y el objetivo del mes, con margen. Leer de IndexedDB cuesta unos 0,2 ms por salida: con
 * 5.000, más de un segundo. Del resto del historial basta con contarlas y con la primera y la última.
 */
const RECENT_MS = 20 * 7 * DAY_MS;

/** La salida cuenta como «última» si no es de las demasiado cortas guardadas antes del filtro de importación. */
const isRealRide = (a: StoredActivity) => !isTooShort(a.totals);

type Data = {
  /** Salidas de los últimos RECENT_MS, por fecha. */
  acts: StoredActivity[];
  /** Todas las salidas guardadas. */
  total: number;
  firstStart?: number;
  lastRide?: StoredActivity;
  workouts: PlannedWorkout[];
  goals: Goal[];
  lastImportAt?: number;
  lastBackupAt?: number;
  displayName: string;
  now: number;
};

export function Inicio() {
  const { key: entry, pathname, search } = useLocation();
  const navType = useNavigationType();
  // Al volver atrás, la altura que tenía y los últimos datos leídos (inicioMemory).
  const [restore] = useState(() => (navType === 'POP' ? savedScroll(entry) : undefined));
  const [data, setData] = useState<Data | null>(() => (restore !== undefined ? lastData<Data>() : null));
  const [loadFailed, setLoadFailed] = useState(false);
  /** Sube para volver a leer la base: «Reintentar» o los datos de ejemplo recién guardados. */
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => {
    setLoadFailed(false);
    setVersion((v) => v + 1);
  }, []);

  // Tras «Ver con datos de ejemplo» el botón que tenía el foco desaparece: el foco pasa al título y
  // se anuncia la carga.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const demoLoaded = useRef(false);
  const [announce, setAnnounce] = useState('');
  const onDemoLoaded = useCallback(() => {
    demoLoaded.current = true;
    reload();
  }, [reload]);
  useEffect(() => {
    if (!demoLoaded.current || !data || data.total === 0) return;
    demoLoaded.current = false;
    titleRef.current?.focus();
    setAnnounce('Datos de ejemplo cargados');
  }, [data]);

  // Al irse a otra pantalla, antes de que esa suba al principio, se guarda la altura. Desmontar sin
  // cambiar de dirección (doble montaje de StrictMode) no cuenta.
  const leaving = useRef({ entry, href: '' });
  useLayoutEffect(() => {
    leaving.current = { entry, href: `#${pathname}${search}` };
  });
  useLayoutEffect(
    () => () => {
      const { entry: at, href } = leaving.current;
      if (window.location.hash !== href) rememberScroll(at, window.scrollY);
    },
    [],
  );
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restore === undefined || restored.current || !data) return;
    restored.current = true;
    window.scrollTo(0, restore);
  }, [restore, data]);

  useEffect(() => {
    let alive = true;
    const from = Date.now() - RECENT_MS;
    Promise.all([
      listActivities({ from, to: Number.MAX_SAFE_INTEGER }),
      countActivities(),
      firstActivity(),
      getMeta(),
      loadSettings(),
      listWorkouts(),
      listGoals(),
    ])
      .then(async ([acts, total, first, meta, settings, workouts, goals]) => {
        // La última salida casi siempre está entre las recientes; si no, se busca hacia atrás.
        const lastRide =
          acts.filter(isRealRide).at(-1) ?? (total > acts.length ? await lastActivity(isRealRide) : undefined);
        if (!alive) return;
        const next: Data = {
          acts,
          total,
          firstStart: first?.startTime,
          lastRide,
          workouts,
          goals,
          lastImportAt: meta.lastImportAt,
          lastBackupAt: meta.lastBackupAt,
          displayName: settings.displayName,
          now: Date.now(),
        };
        setData(rememberData(next));
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [version]);

  let body = <Loading />;
  if (data) body = <Dashboard data={data} onDemoLoaded={onDemoLoaded} />;
  else if (loadFailed)
    body = (
      <section className="card">
        <StateView
          tone="error"
          level={2}
          icon={TriangleAlert}
          title="Tus salidas no se han podido cargar"
          text="Los datos de este navegador no responden. Revisa que no estés en una ventana privada y vuelve a intentarlo; si sigue igual, restaura tu copia de seguridad."
          action={
            <div className="btn-row">
              <button type="button" className="btn btn--primary" onClick={reload}>
                <RefreshCw className="ic" aria-hidden="true" />
                Reintentar
              </button>
              <Link className="btn btn--ghost" to="/ajustes">
                Restaurar copia
              </Link>
            </div>
          }
        />
      </section>
    );

  return (
    <div className="home">
      <h1 className="sr-only" ref={titleRef} tabIndex={-1}>
        Inicio
      </h1>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {body}
    </div>
  );
}

/** Los esqueletos imitan la forma real (cifras, objetivo, próximo entreno) para que nada salte. */
function Loading() {
  return (
    <div role="status" className="home-loading">
      <span className="sr-only">Cargando salidas…</span>
      <div className="sk-hero" aria-hidden="true">
        <Skeleton width="44%" />
        <Skeleton variant="title" width="62%" />
        <Skeleton width="78%" />
      </div>
      <div className="kpis" aria-hidden="true">
        {[62, 56, 70, 64].map((w) => (
          <div className="kpi kpi--compact sk-kpi" key={w}>
            <Skeleton width={`${w}%`} />
            <Skeleton variant="fig" />
          </div>
        ))}
      </div>
      <div className="card sk-stack" aria-hidden="true">
        <Skeleton width="70%" />
        <Skeleton height={10} />
        <Skeleton width="55%" />
      </div>
      <div className="card sk-stack" aria-hidden="true">
        <Skeleton variant="title" width="60%" />
        <Skeleton width="80%" />
        <Skeleton variant="box" height={48} />
      </div>
    </div>
  );
}

/**
 * Track de la última salida, leído una sola vez para el hero y para «Tu última salida».
 * `null` mientras se lee; sin GPS (o si falla la lectura), vacío.
 */
function useLastTrack(ride: StoredActivity | undefined): TrackPoint[] | null {
  const [loaded, setLoaded] = useState<{ id: string; points: TrackPoint[] } | null>(null);
  const id = ride?.id;
  const hasTrack = ride?.hasTrack ?? false;

  useEffect(() => {
    if (!id || !hasTrack) return;
    let alive = true;
    getTrack(id).then(
      (points) => {
        if (alive) setLoaded({ id, points: points ?? [] });
      },
      // Sin track se ve la salida sin mapa ni cresta; el resto de Inicio sigue funcionando.
      () => {
        if (alive) setLoaded({ id, points: [] });
      },
    );
    return () => {
      alive = false;
    };
  }, [id, hasTrack]);

  if (!id || !hasTrack) return NO_POINTS;
  return loaded && loaded.id === id ? loaded.points : null;
}

type KpiDef = {
  accent: Accent;
  label: string;
  icon: LucideIcon;
  format: (w: PeriodTotals) => string;
};

const KPIS: KpiDef[] = [
  { accent: 'dist', label: 'Distancia', icon: Bike, format: (w) => formatKm(w.distanceM) },
  { accent: 'elev', label: 'Desnivel', icon: Mountain, format: (w) => formatMeters(w.elevGainM) },
  { accent: 'time', label: 'En movimiento', icon: Timer, format: (w) => formatDuration(w.movingTimeS, 'short') },
  {
    accent: 'speed',
    label: 'Velocidad media',
    icon: Gauge,
    format: (w) => (w.rides > 0 ? formatSpeed(w.avgSpeedMs) : 'Sin salidas'),
  },
];

const REF_SUMS = 'frente a tus semanas a estas alturas';
const REF_SPEED = 'frente a tu media';

function Dashboard({ data, onDemoLoaded }: { data: Data; onDemoLoaded: () => void }) {
  const { acts, total, firstStart, lastRide, workouts, goals, lastImportAt, lastBackupAt, displayName, now } = data;
  const [metric, setMetric] = useState<Accent>('dist');
  // La métrica de partida (Distancia) no se recalca con el borde de color hasta que eliges una.
  const [picked, setPicked] = useState(false);
  const pick = useCallback((m: Accent) => {
    setMetric(m);
    setPicked(true);
  }, []);

  const week = useMemo(
    () => currentWeekVsAverage(acts.filter((a) => a.startTime >= now - WEEK_WINDOW_MS), now),
    [acts, now],
  );
  const trend = useMemo(() => weeklyTrend(acts, now), [acts, now]);
  const track = useLastTrack(lastRide);
  const rideProfile = useMemo(() => profileFromTrack(track ?? NO_POINTS), [track]);
  const level = useMemo(() => {
    if (!lastRide) return null;
    const ref = computeReference(acts, now);
    return ref ? difficulty(lastRide.totals, ref) : null;
  }, [acts, lastRide, now]);
  const plan = useMemo(() => {
    const { event, volume } = pickGoals(goals, now);
    return {
      event,
      glances: volume.map((g) => ({ id: g.id, glance: volumeGlance(g, volumeProgress(g, acts, now)) })),
      upcoming: pickUpcoming(workouts, now),
    };
  }, [goals, workouts, acts, now]);

  const greeting = displayName ? `Hola, ${displayName}.` : 'Hola.';
  const date = heroDate(now);

  if (total === 0) return <Empty greeting={greeting} date={date} onLoaded={onDemoLoaded} />;

  const { current, avg } = week;
  const deltas = weekDeltas(trend, current.rides);
  const summit = profileExtent(rideProfile)?.summit;
  const month = plan.glances.find((g) => g.glance.month !== null)?.glance;
  const lead = heroLead(plan.upcoming[0], month ? { period: month.month!, word: month.word } : null, now);
  // Lo que toca y cómo vas, en palabras; sin plan, lo que llevas. Las diferencias están en las cifras.
  const sentence = lead ? { lead: lead.lead, figure: lead.name, tail: lead.tail } : heroSentence(current, null);
  const speedMean = trend.series.speed.mean;

  return (
    <>
      <Hero
        greeting={greeting}
        date={date}
        sentence={
          <>
            {sentence.lead}
            {sentence.figure ? <b>{sentence.figure}</b> : null}
            {sentence.tail}
          </>
        }
        profile={summit ? rideProfile : DECOR_PROFILE}
        summitLabel={
          summit ? { ele: formatMeters(summit.ele), km: formatCount(Math.round(summit.dM / 1000)) } : null
        }
        notices={[]}
        actions={
          <Link to="/rutas" className="round press hero-route" aria-label="Generar ruta">
            <Route size={20} strokeWidth={2} aria-hidden="true" />
          </Link>
        }
      >
        <section aria-labelledby="week-title" className="week">
          <h2 id="week-title" className="sr-only">
            Esta semana
          </h2>
          <ul className="kpis">
            {KPIS.map((k) => {
              let note: string | undefined;
              if (k.accent === 'speed' && current.rides === 0)
                note = avg.rides > 0 ? `Tu media: ${formatSpeed(avg.avgSpeedMs)}` : undefined;
              return (
                <li key={k.accent}>
                  <KpiCard
                    label={k.label}
                    icon={k.icon}
                    accent={k.accent}
                    value={k.format(current)}
                    delta={deltas[k.accent]}
                    deltaRef={k.accent === 'speed' ? REF_SPEED : REF_SUMS}
                    note={note}
                    selected={metric === k.accent}
                    quiet={!picked}
                    onSelect={() => pick(k.accent)}
                    controls="progreso"
                    describedBy="kpi-hint"
                  />
                </li>
              );
            })}
          </ul>
          <p className="week-cap">{weekCaption(current.rides, trend)}</p>
          <p id="kpi-hint" className="sr-only">
            Pulsa una cifra para verla en Tus últimas 12 semanas.
          </p>
        </section>
      </Hero>

      <div className="duo">
        {/* Un solo objetivo de volumen, el del mes si lo hay (como el prototipo): con los dos, «Próximo
            entreno» no asoma en el primer pantallazo del teléfono. El de la semana vive en Plan > Objetivos. */}
        {plan.glances.slice(0, 1).map(({ id, glance }) => (
          <GoalGlance key={id} id={`objetivo-${id}`} glance={glance} />
        ))}
        <NextWorkout items={plan.upcoming} now={now} kmh={speedMean} />
        {plan.event ? <EventGoalRow goal={plan.event} now={now} /> : null}
      </div>

      {lastRide ? (
        <RideMapCard activity={lastRide} track={track} profile={rideProfile} level={level} now={now} />
      ) : null}

      <TrendCard id="progreso" trend={trend} metric={metric} onMetricChange={pick} />

      <YourData
        rides={total}
        firstStart={firstStart ?? Infinity}
        lastImportAt={lastImportAt}
        lastBackupAt={lastBackupAt}
        now={now}
      />
    </>
  );
}

/**
 * Sin salidas: el saludo invita a importar y, para ver cómo queda, ofrece los datos de ejemplo
 * (sintéticos, con el prefijo `demo-`: se borran desde Ajustes sin tocar lo tuyo).
 */
function Empty({ greeting, date, onLoaded }: { greeting: string; date: string; onLoaded: () => void }) {
  const [demo, setDemo] = useState<'idle' | 'busy' | 'failed'>('idle');
  /** Análisis de las salidas de ejemplo, de 0 a 100: tarda unos segundos. */
  const [pct, setPct] = useState<number | null>(null);

  async function loadDemo() {
    setDemo('busy');
    setPct(null);
    try {
      // El generador solo se descarga si alguien lo pide.
      const { loadDemoData } = await import('../../demo/demoData');
      await loadDemoData(Date.now(), (done, total) => setPct(total > 0 ? Math.round((done / total) * 100) : null));
      onLoaded();
    } catch {
      setDemo('failed');
    }
  }

  return (
    <>
      <Hero
        empty
        greeting={greeting}
        date={date}
        sentence="Aún no hay salidas. Importa el archivo de Strava y verás aquí tu semana, tu objetivo y tu última salida, medidos contra tu propio nivel."
        action={
          <div className="hero-ctas">
            <Link to="/importar" className="btn btn--primary btn--lg press">
              <Upload className="ic" aria-hidden="true" />
              Importar salidas
            </Link>
            <button
              type="button"
              className="btn btn--secondary btn--lg press"
              onClick={loadDemo}
              disabled={demo === 'busy'}
              aria-describedby="demo-note"
            >
              <Eye className="ic" aria-hidden="true" />
              {demo === 'busy' ? `Preparando el ejemplo…${pct !== null ? ` ${pct} %` : ''}` : 'Ver con datos de ejemplo'}
            </button>
            <p id="demo-note" className="hero-demo-note" aria-live="polite">
              {demo === 'failed'
                ? 'No se han podido guardar los datos de ejemplo. Vuelve a intentarlo.'
                : 'Salidas inventadas para ver la app llena. Las borras en Ajustes.'}
            </p>
          </div>
        }
        profile={DECOR_PROFILE}
        summitLabel={null}
        notices={[]}
        actions={<></>}
      />
      <StravaHowTo />
    </>
  );
}
