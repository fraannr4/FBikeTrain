import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getActivity, getTrack, listActivities, listClimbEfforts, listRouteSigs } from '../../db/repo';
import type { ClimbEffort, ClimbGroup, LatLng, StoredActivity, TrackPoint } from '../../domain/types';
import { groupClimbs } from '../../metrics/climbGroups';
import type { ProfilePoint } from '../../metrics/climbs';
import { computeReference, difficulty } from '../../metrics/reference';
import { groupRoutes } from '../../metrics/routes';
import { gradeClass } from '../charts/grade';
import { climbTime } from '../climbView';
import { AppBar } from '../components/AppBar';
import { Banner } from '../components/Banner';
import { Chip, DifficultyChip } from '../components/Chip';
import { ElevationProfile, type ProfileClimb } from '../components/ElevationProfile';
import { List, ListRow } from '../components/ListRow';
import { Page } from '../components/Page';
import { RideMap, type MapClimb } from '../components/RideMap';
import { Sheet } from '../components/Sheet';
import { Skeleton, SkeletonRows } from '../components/Skeleton';
import { StateView } from '../components/StateView';
import {
  formatClimb,
  formatCount,
  formatDeltaPct,
  formatDuration,
  formatKm,
  formatMeters,
  formatNumber,
  formatSpeed,
  formatVam,
  NO_FIGURE,
} from '../format';
import { RideThumb } from '../historial/RideThumb';
import {
  ArrowDown,
  ArrowUp,
  Bike,
  ChartColumn,
  ChevronRight,
  CircleAlert,
  Clock,
  Flag,
  Gauge,
  Maximize,
  Mountain,
  Repeat,
  Sparkles,
  Timer,
  TrendingUp,
  type LucideIcon,
} from '../icons';
import { compareRide, shortDate, similarRides, swarm, whenLabel, type CompareRow, type MetricKey } from '../salida/model';
import { useAnalysis } from '../useAnalysis';

const UNTITLED = 'Salida sin nombre';
/** Espacio fino entre cifra y unidad. */
const NNB = ' ';

type GpsPoint = TrackPoint & LatLng;
const hasGps = (p: TrackPoint): p is GpsPoint => p.lat !== undefined && p.lng !== undefined;

type Base = { ride: StoredActivity; track: TrackPoint[]; acts: StoredActivity[]; now: number };

/** Una subida de esta salida, con su número y su grupo (la misma subida en otras salidas). */
type ClimbHere = { n: number; e: ClimbEffort; group: ClimbGroup | undefined };

type RouteHere = { groupId: string; times: number; rank: number; me: number; best: number };
type SimilarHere = { act: StoredActivity; share: number };
type Analysed = { climbs: ClimbHere[]; route: RouteHere | null; similar: SimilarHere[] };

/**
 * Detalle de una salida (`/historial/:id`), como `salida.html` del prototipo: el mapa a todo el ancho
 * bajo la barra, el nombre, cuándo y las cuatro cifras; el perfil por pendiente que se recorre con el
 * dedo y mueve un punto en el mapa; las subidas de la salida; la comparación con tus salidas de 12
 * meses y las rutas parecidas. Sin GPS, solo cabecera, cifras y comparación.
 */
export function Salida() {
  const { id = '' } = useParams<{ id: string }>();
  const analysis = useAnalysis();
  const [base, setBase] = useState<Base | 'missing' | 'failed' | null>(null);
  const [analysed, setAnalysed] = useState<{ id: string; data: Analysed } | null>(null);
  const [cursor, setCursor] = useState<LatLng | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setBase(null);
    setCursor(null);
    Promise.all([getActivity(id), getTrack(id), listActivities()]).then(
      ([ride, track, acts]) => {
        if (!alive) return;
        setBase(ride ? { ride, track: track ?? [], acts, now: Date.now() } : 'missing');
      },
      () => alive && setBase('failed'),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  const ready = analysis.status === 'ready';
  const loaded = typeof base === 'object' && base !== null ? base : null;

  useEffect(() => {
    if (!ready || !loaded) return;
    let alive = true;
    Promise.all([listClimbEfforts(), listRouteSigs()]).then(
      ([efforts, sigs]) => alive && setAnalysed({ id: loaded.ride.id, data: analyse(loaded, efforts, sigs) }),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [ready, loaded]);

  const onCursor = useCallback((p: ProfilePoint | null) => setCursor(p ? { lat: p.lat, lng: p.lng } : null), []);

  const gps = useMemo(() => (loaded ? loaded.track.filter(hasGps) : []), [loaded]);
  const here = analysed && loaded && analysed.id === loaded.ride.id ? analysed.data : null;
  const mapClimbs = useMemo<MapClimb[] | undefined>(
    () =>
      here && loaded
        ? here.climbs.map(({ n, e }) => ({
            n,
            cls: gradeClass(e.avgGradePct),
            path: loaded.track.slice(e.startIdx, e.endIdx + 1).filter(hasGps),
          }))
        : undefined,
    [here, loaded],
  );
  const profileClimbs = useMemo<ProfileClimb[]>(
    () => (here ? here.climbs.map(({ e }) => ({ startDistM: e.startDistM, lengthM: e.lengthM, avgGradePct: e.avgGradePct })) : []),
    [here],
  );
  const level = useMemo(() => {
    if (!loaded) return null;
    const ref = computeReference(loaded.acts, loaded.now);
    return ref ? difficulty({ distanceM: loaded.ride.totals.distanceM, elevGainM: loaded.ride.totals.elevGainM }, ref) : null;
  }, [loaded]);
  const compare = useMemo(() => (loaded ? compareRide(loaded.ride, loaded.acts, loaded.now) : null), [loaded]);

  if (base === 'missing' || base === 'failed') {
    return (
      <Page title="Salida" back="/historial" className="ride ride--plain">
        <div className="card">
          <StateView
            icon={CircleAlert}
            tone="error"
            level={2}
            title={base === 'missing' ? 'No se encuentra la salida' : 'No se ha podido leer la salida'}
            text={
              base === 'missing'
                ? 'Puede que se borrara al volver a importar el archivo de Strava. Búscala en el historial por su nombre.'
                : 'El almacenamiento del navegador no responde. Recarga la página.'
            }
            action={
              <Link className="btn btn--primary" to="/historial">
                <ChartColumn className="ic" aria-hidden="true" />
                Ir al historial
              </Link>
            }
          />
        </div>
      </Page>
    );
  }

  if (!loaded) return <Loading />;

  const { ride, track } = loaded;
  const name = ride.name?.trim() || UNTITLED;
  const withMap = ride.hasTrack && gps.length > 1;
  const hasProfile = withMap && gps.some((p) => p.ele !== undefined);

  return (
    <div className={withMap ? 'ride-screen ride-screen--map' : 'ride-screen'}>
      <AppBar title={name} back="/historial" />
      <div className={withMap ? 'page ride' : 'page ride ride--plain'}>
        <div className="ride-top">
          {withMap ? (
            <div className="ride-hero">
              <RideMap points={gps} label="Mapa de la salida" climbs={mapClimbs} cursor={cursor} interactive={false} className="ride-hero-map" />
              <p className="map-attr">© OpenStreetMap, CyclOSM</p>
              <button
                type="button"
                className="icon-btn icon-btn--glass map-max"
                aria-label="Ver el mapa a pantalla completa"
                aria-haspopup="dialog"
                onClick={() => setMapOpen(true)}
              >
                <Maximize className="ic" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <div className="ride-head">
            <RideTitle name={name} />
            <p className="ride-when">{whenLabel(ride.startTime, loaded.now)}</p>
            {level || (here?.route && here.route.rank <= 3) ? (
              <div className="cluster ride-chips">
                {level ? <DifficultyChip level={level} /> : null}
                {here?.route && here.route.rank <= 3 ? <RouteRankChip rank={here.route.rank} /> : null}
              </div>
            ) : null}
          </div>
          <Figures ride={ride} />
        </div>

        {!ride.hasTrack ? (
          <Banner tone="warn">
            <b>Esta salida no tiene GPS, así que no tiene mapa.</b> Tampoco tiene perfil ni subidas, pero sus cifras cuentan en tu
            historial y en tus objetivos.
          </Banner>
        ) : null}

        {hasProfile ? (
          <section className="section" aria-labelledby="s-perfil">
            <ElevationProfile
              points={track}
              climbs={profileClimbs}
              onCursor={onCursor}
              heading={
                <h2 className="section-title" id="s-perfil">
                  Perfil
                </h2>
              }
            />
          </section>
        ) : null}

        {ride.hasTrack ? <ClimbsSection analysis={analysis} climbs={here?.climbs ?? null} now={loaded.now} /> : null}

        {compare ? <CompareSection rows={compare} /> : null}

        {here && (here.route || here.similar.length > 0) ? <SimilarSection route={here.route} similar={here.similar} /> : null}
      </div>

      {withMap ? (
        <Sheet open={mapOpen} onClose={() => setMapOpen(false)} title="Recorrido" closeLabel="Cerrar el mapa" className="sheet--map">
          <RideMap points={gps} label="Mapa ampliado de la salida" climbs={mapClimbs} className="ride-map--big" />
        </Sheet>
      ) : null}
    </div>
  );
}

/** Subidas de la salida con su grupo; la misma ruta y las parecidas. */
function analyse(base: Base, efforts: ClimbEffort[], sigs: Awaited<ReturnType<typeof listRouteSigs>>): Analysed {
  const { ride, acts } = base;
  const groups = groupClimbs(efforts);
  const groupOf = new Map<string, ClimbGroup>();
  for (const g of groups) for (const e of g.efforts) groupOf.set(e.id, g);
  const climbs = efforts
    .filter((e) => e.activityId === ride.id)
    .sort((a, b) => a.startDistM - b.startDistM)
    .map((e, i) => ({ n: i + 1, e, group: groupOf.get(e.id) }));

  const byId = new Map(acts.map((a) => [a.id, a]));
  const routeGroups = groupRoutes(sigs);
  const mine = routeGroups.find((g) => g.activityIds.includes(ride.id));
  let route: RouteHere | null = null;
  if (mine) {
    const times = mine.activityIds.map((id) => byId.get(id)?.totals.movingTimeS).filter((s): s is number => s !== undefined && s > 0);
    const me = ride.totals.movingTimeS;
    route = {
      groupId: mine.id,
      times: mine.activityIds.length,
      rank: times.filter((s) => s < me).length + 1,
      me,
      best: Math.min(me, ...times),
    };
  }
  const sig = sigs.find((s) => s.activityId === ride.id);
  const similar = sig
    ? similarRides(sig, sigs, routeGroups)
        .map((s) => ({ act: byId.get(s.activityId), share: s.share }))
        .filter((s): s is SimilarHere => s.act !== undefined)
    : [];
  return { climbs, route, similar };
}

function Loading() {
  return (
    <div className="ride-screen">
      <AppBar title="" back="/historial" />
      <div className="page ride" aria-busy="true">
        <span className="sr-only">Cargando la salida…</span>
        <div className="ride-top" aria-hidden="true">
          <div className="ride-hero">
            <Skeleton variant="box" className="sk-map" />
          </div>
          <div className="ride-head">
            <Skeleton variant="title" width="70%" height={34} />
            <Skeleton width="58%" />
          </div>
          <div className="sk-figs">
            <Skeleton variant="fig" />
            <Skeleton variant="fig" />
            <Skeleton variant="fig" />
            <Skeleton variant="fig" />
          </div>
        </div>
        <div className="section" aria-hidden="true">
          <Skeleton variant="title" width="30%" />
          <Skeleton variant="box" height={150} />
        </div>
      </div>
    </div>
  );
}

/** Nombre de Strava: si pasa de tres líneas, se recorta y un toque lo despliega. */
function RideTitle({ name }: { name: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [clamp, setClamp] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    setClamp(false);
    setOpen(false);
  }, [name]);
  useLayoutEffect(() => {
    const h = ref.current;
    if (!h || clamp) return;
    const lh = parseFloat(getComputedStyle(h).lineHeight) || 36;
    if (h.scrollHeight > lh * 3 + 4) setClamp(true);
  }, [name, clamp]);
  return (
    <h1 ref={ref} className={name.length > 40 ? 'page-title is-long' : 'page-title'} dir="auto">
      {clamp ? (
        <button type="button" className="title-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="title-txt">{name}</span>
        </button>
      ) : (
        name
      )}
    </h1>
  );
}

function RouteRankChip({ rank }: { rank: number }) {
  return rank === 1 ? (
    <Chip tone="done" icon={Flag}>
      Tu mejor tiempo en esta ruta
    </Chip>
  ) : (
    <Chip tone="done" icon={TrendingUp}>
      Tu {rank}.º mejor tiempo en esta ruta
    </Chip>
  );
}

function Unit({ children }: { children: string }) {
  return <span className="u">{`${NNB}${children}`}</span>;
}

/** Las cuatro cifras: distancia (la titular, en cursiva), desnivel, tiempo en movimiento y media. */
const Figures = memo(function Figures({ ride }: { ride: StoredActivity }) {
  const t = ride.totals;
  const min = Math.round(Math.max(0, t.movingTimeS) / 60);
  const h = Math.floor(min / 60);
  const kmh = t.avgSpeedMs > 0 ? t.avgSpeedMs * 3.6 : NaN;
  return (
    <div className="ride-figs-wrap" role="group" aria-label="Cifras de la salida">
      <dl className="salida-figs">
        <div data-m="dist">
          <dt>
            <Bike className="ic" aria-hidden="true" />
            Distancia
          </dt>
          <dd className="fig-i">
            {formatNumber(t.distanceM / 1000, 1)}
            <Unit>km</Unit>
          </dd>
        </div>
        <div data-m="elev">
          <dt>
            <Mountain className="ic" aria-hidden="true" />
            Desnivel
          </dt>
          <dd>
            {formatCount(t.elevGainM)}
            <Unit>m</Unit>
          </dd>
        </div>
        <div data-m="time">
          <dt>
            <Timer className="ic" aria-hidden="true" />
            Tiempo
          </dt>
          <dd>
            {h > 0 ? (
              <>
                {formatCount(h)}
                <span className="u">{`${NNB}h${NNB}`}</span>
                {String(min % 60).padStart(2, '0')}
              </>
            ) : (
              <>
                {formatCount(min)}
                <Unit>min</Unit>
              </>
            )}
          </dd>
        </div>
        <div data-m="speed">
          <dt>
            <Gauge className="ic" aria-hidden="true" />
            Media
          </dt>
          <dd>
            {Number.isFinite(kmh) ? formatNumber(kmh, 1) : NO_FIGURE}
            <Unit>km/h</Unit>
          </dd>
        </div>
      </dl>
    </div>
  );
});

/* ---------- Subidas ---------- */

type AnalysisState = ReturnType<typeof useAnalysis>;

const ClimbsSection = memo(function ClimbsSection({
  analysis,
  climbs,
  now,
}: {
  analysis: AnalysisState;
  climbs: ClimbHere[] | null;
  now: number;
}) {
  let body: ReactNode;
  if (analysis.status === 'error') {
    body = (
      <Banner tone="error">
        <b>No se han podido analizar tus salidas.</b> Recarga la página para volver a intentarlo.
      </Banner>
    );
  } else if (analysis.status === 'running' || climbs === null) {
    body = (
      <>
        <p className="section-sub" role="status">
          {analysis.status === 'running' && analysis.total > 0
            ? `Analizando salidas: ${formatCount(analysis.done)} de ${formatCount(analysis.total)}`
            : 'Buscando las subidas de esta salida…'}
        </p>
        <SkeletonRows rows={2} label="Cargando las subidas" />
      </>
    );
  } else if (climbs.length === 0) {
    body = <p className="section-sub">Esta salida no tiene subidas de 1 km o más al 3 %.</p>;
  } else {
    body = (
      <>
        <p className="section-sub">Las mismas cifras que en el perfil y en el mapa.</p>
        <ul className="list list--inset climbs">
          {climbs.map((c) => (
            <ClimbRow key={c.e.id} c={c} now={now} />
          ))}
        </ul>
      </>
    );
  }
  return (
    <section className="section" aria-labelledby="s-subidas">
      <div className="section-h">
        <h2 className="section-title" id="s-subidas">
          Subidas de esta salida
        </h2>
        {climbs && climbs.length > 0 ? (
          <Link className="card-link" to="/historial/subidas">
            Todas
            <ChevronRight className="ic" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {body}
    </section>
  );
});

function ClimbRow({ c, now }: { c: ClimbHere; now: number }) {
  const { n, e, group } = c;
  const passes = group?.efforts.length ?? 1;
  const isBest = passes > 1 && group?.best.id === e.id;
  let BestIcon: LucideIcon = Sparkles;
  let best = 'La primera vez';
  if (isBest) {
    BestIcon = Flag;
    best = `Tu mejor tiempo en ${formatCount(passes)} pasadas`;
  } else if (passes > 1 && group) {
    BestIcon = Clock;
    best = `Tu mejor en ${formatCount(passes)} pasadas: ${climbTime(group.best.timeS)} (${shortDate(group.best.activityStart, now)})`;
  }
  const from = e.startDistM / 1000;
  return (
    <li>
      <Link className="row" to={`/historial/subidas/${encodeURIComponent(group?.id ?? e.id)}`}>
        <span className="row-lead climb-n" style={{ '--pin': `var(--g${gradeClass(e.avgGradePct)})` } as CSSProperties}>
          <span className="sr-only">Subida </span>
          {n}
        </span>
        <span className="row-main">
          <span className="row-title">
            Del km {formatNumber(from, 1)} al {formatNumber(from + e.lengthM / 1000, 1)}
          </span>
          <span className="row-meta">
            {formatClimb(e.lengthM, e.avgGradePct)}, a {formatSpeed(e.avgSpeedMs)}
          </span>
          <span className={isBest ? 'row-meta climb-best is-best' : 'row-meta climb-best'}>
            <BestIcon className="ic" aria-hidden="true" />
            <span>{best}</span>
          </span>
        </span>
        <span className="row-trail">
          <span className="row-figs">
            <span className="row-val">{climbTime(e.timeS)}</span>
            {e.timeS >= 180 ? <span className="row-sub">VAM {formatVam(e.vamMh)}</span> : null}
          </span>
          <ChevronRight className="chev" aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}

/* ---------- Frente a tu media ---------- */

const METRIC: Record<MetricKey, { label: string; icon: LucideIcon; fmt: (v: number) => string }> = {
  dist: { label: 'Distancia', icon: Bike, fmt: (v) => formatKm(v, 1) },
  elev: { label: 'Desnivel', icon: Mountain, fmt: formatMeters },
  time: { label: 'Tiempo en movimiento', icon: Timer, fmt: (v) => formatDuration(v, 'short') },
  speed: { label: 'Velocidad media', icon: Gauge, fmt: formatSpeed },
};

/** Más del triple (+200 %) ya no se lee como porcentaje. */
const deltaText = (pct: number) => (pct > 200 ? 'Más del triple' : formatDeltaPct(pct));

const CompareSection = memo(function CompareSection({ rows }: { rows: CompareRow[] }) {
  return (
    <section className="section" aria-labelledby="s-media">
      <div className="section-h">
        <h2 className="section-title" id="s-media">
          Frente a tu media
        </h2>
      </div>
      <div className="card cmp">
        <p className="legend cmp-legend" aria-hidden="true">
          <span>
            <i className="k-dot" />
            Tus salidas de los últimos 12 meses
          </span>
          <span>
            <i className="k-mean" />
            Tu media
          </span>
          <span>
            <i className="k-me" />
            Esta salida
          </span>
        </p>
        {rows.map((r) => (
          <CompareRowView key={r.key} r={r} />
        ))}
      </div>
    </section>
  );
});

function CompareRowView({ r }: { r: CompareRow }) {
  const m = METRIC[r.key];
  const Icon = m.icon;
  const up = Math.round(r.deltaPct) >= 0;
  const lo = Math.min(r.me, ...r.others);
  const hi = Math.max(r.me, ...r.others);
  const X = (v: number) => (((v - lo) / (hi - lo || 1)) * 100).toFixed(2);
  const dots = swarm(r.others, lo, hi);
  const tail = `de tus ${formatCount(r.total)} salidas en 12 meses.`;
  return (
    <div className="cmp-row" data-m={r.key}>
      <div className="cmp-h">
        <p className="cmp-l">
          <Icon className="ic" aria-hidden="true" />
          {m.label}
        </p>
        <p className={up ? 'delta delta--up' : 'delta delta--down'}>
          {up ? <ArrowUp className="ic" aria-hidden="true" /> : <ArrowDown className="ic" aria-hidden="true" />}
          {deltaText(r.deltaPct)}
        </p>
      </div>
      <div
        className="cmp-strip"
        role="img"
        aria-label={`${m.label}: ${m.fmt(r.me)}, la ${r.rank} ${tail} Tu media es ${m.fmt(r.mean)}.`}
      >
        {dots.map((d, i) => (
          <i key={i} style={{ left: `${d.x.toFixed(2)}%`, top: 5 + d.lane * 6 }} />
        ))}
        <b style={{ left: `${X(r.mean)}%` }} />
        <em style={{ left: `${X(r.me)}%` }} />
      </div>
      <p className="cmp-foot">
        La <b>{r.rank}</b> {tail} Tu media: {m.fmt(r.mean)}.
      </p>
    </div>
  );
}

/* ---------- Rutas parecidas ---------- */

function routeMeta(r: RouteHere): string {
  const me = formatDuration(r.me, 'short');
  if (r.rank === 1) return `Esta vez ${me}, tu mejor tiempo`;
  const gap = `a ${formatDuration(r.me - r.best)} de tu mejor, ${formatDuration(r.best, 'short')}`;
  return r.rank <= 3 ? `Esta vez ${me}, tu ${r.rank}.º mejor tiempo: ${gap}` : `Esta vez ${me}: ${gap}`;
}

const SimilarSection = memo(function SimilarSection({ route, similar }: { route: RouteHere | null; similar: SimilarHere[] }) {
  return (
    <section className="section" aria-labelledby="s-parecidas">
      <div className="section-h">
        <h2 className="section-title" id="s-parecidas">
          Rutas parecidas
        </h2>
      </div>
      {route ? (
        <List inset>
          <ListRow
            to={`/historial/repetidas/${encodeURIComponent(route.groupId)}`}
            icon={Repeat}
            accent="time"
            title={`Has hecho esta ruta ${formatCount(route.times)} veces`}
            meta={routeMeta(route)}
          />
        </List>
      ) : null}
      {similar.length > 0 ? (
        <List inset className="similar">
          {similar.map(({ act, share }) => (
            <ListRow
              key={act.id}
              to={`/historial/${encodeURIComponent(act.id)}`}
              lead={<RideThumb id={act.id} />}
              title={<span dir="auto">{act.name?.trim() || UNTITLED}</span>}
              meta={<span className="share">Coincide en un {formatCount(share * 100)}{NNB}%</span>}
              value={formatNumber(act.totals.distanceM / 1000, 1)}
              unit="km"
            />
          ))}
        </List>
      ) : null}
    </section>
  );
});
