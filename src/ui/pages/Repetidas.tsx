import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { listActivities, listRouteSigs } from '../../db/repo';
import { groupRoutes } from '../../metrics/routes';
import { daysAgo, relDay, shortDay } from '../climbView';
import { FilterChip } from '../components/Chip';
import { Page } from '../components/Page';
import { SegmentedNav } from '../components/SegmentedControl';
import { Sheet } from '../components/Sheet';
import { Skeleton } from '../components/Skeleton';
import { StateView } from '../components/StateView';
import { formatCount, formatDuration, formatKm, formatMeters } from '../format';
import { RideThumb } from '../historial/RideThumb';
import { ArrowUp, ChevronDown, ChevronRight, CircleAlert, RefreshCw, Repeat, Search, TrendingUp, Upload, X } from '../icons';
import { lapRank, ROUTE_SORTS, TREND_FLAT, toRouteItems, type RouteItem, type RouteSort } from '../repeatView';
import { HISTORIAL_VIEWS } from '../shell/screens';
import { isSheetState, SHEET_STATE } from '../shell/sheetRoute';
import { useAnalysis } from '../useAnalysis';
import { Hm, lapLine, RepetidaDetail, Trend } from './Repetida';

/** Tarjetas por página; con más, búsqueda. */
const PAGE = 20;
const LEAD = 'Las rutas que haces una y otra vez, vuelta a vuelta.';

const SORT_OPTIONS: [RouteSort, string][] = [
  ['veces', 'Más veces'],
  ['recientes', 'Recientes'],
  ['mejorando', 'Mejorando'],
  ['largas', 'Más largas'],
];

type Data = { items: RouteItem[]; byId: Map<string, RouteItem>; now: number };

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Diferencia con la mejor: «34 s» o «6 min». */
const gap = (s: number) => (Math.round(s) < 60 ? `${Math.round(s)} s` : formatDuration(s, 'short'));

const RouteCard = memo(function RouteCard({ r, now, onOpen }: { r: RouteItem; now: number; onOpen: (id: string) => void }) {
  const n = r.laps.length;
  const lastIsBest = r.last === r.best;
  const when = daysAgo(r.last.t, now) < 7 ? relDay(r.last.t, now) : shortDay(r.last.t, now);
  return (
    <li>
      <button type="button" className="rg" aria-haspopup="dialog" onClick={() => onOpen(r.id)}>
        <span className="rg-top">
          <span className="shape-box" aria-hidden="true">
            <RideThumb id={r.id} />
          </span>
          <span className="rg-main">
            <span className="rg-name" dir="auto" title={r.name}>
              {r.name}
            </span>
            <span className="row-meta">
              {formatKm(r.distM, 1)}, {formatMeters(r.elevM)}
            </span>
            <span className="row-meta">
              {formatCount(n)} veces · última, {when}
            </span>
            {lastIsBest ? (
              <span className="row-meta">
                <span className="chip chip--done">
                  <TrendingUp className="ic" aria-hidden="true" />
                  Mejor tiempo en la última
                </span>
              </span>
            ) : null}
          </span>
          <ChevronRight className="chev" aria-hidden="true" />
        </span>
        <span className="rg-stats">
          <span>
            <span className="rg-k">Mejor</span>
            <span className="rg-v">
              <Hm s={r.best.s} />
            </span>
          </span>
          <span>
            <span className="rg-k">Última</span>
            <span className="rg-v">
              <Hm s={r.last.s} />
            </span>
          </span>
          <span>
            <span className="rg-k">Tendencia</span>
            <Trend r={r} className="rg-v" />
          </span>
        </span>
      </button>
    </li>
  );
});

/** «Tu última repetida»: compacta, y toda ella abre la hoja. */
function LastCard({ r, now, onOpen }: { r: RouteItem; now: number; onOpen: (id: string) => void }) {
  const l = r.last;
  const n = r.laps.length;
  const rank = lapRank(r, l);
  return (
    <article className="card last last--tap" data-m="time" aria-labelledby="last-t">
      <div className="card-h">
        <span className="card-ic" aria-hidden="true">
          <Repeat className="ic" />
        </span>
        <h2 className="card-title" id="last-t">
          <button
            type="button"
            className="last-go"
            aria-haspopup="dialog"
            aria-label={`Tu última repetida, ver tus ${formatCount(n)} vueltas`}
            onClick={() => onOpen(r.id)}
          >
            Tu última repetida
          </button>
        </h2>
        <span className="last-when">{shortDay(l.t, now)}</span>
        <ChevronRight className="chev" aria-hidden="true" />
      </div>
      <div className="last-top">
        <span className="shape-box" aria-hidden="true">
          <RideThumb id={r.id} />
        </span>
        <div>
          <p className="last-name" dir="auto" title={r.name}>
            {r.name}
          </p>
          <p className="last-meta">{lapLine(l)}</p>
        </div>
      </div>
      <div className="last-fig">
        <span className="last-time">
          <Hm s={l.s} />
        </span>
        <p className="last-rank">
          {rank === 1 ? (
            <span className="delta delta--up">
              <ArrowUp className="ic" aria-hidden="true" />
              Tu mejor tiempo
            </span>
          ) : (
            <>
              <span>
                <b>{rank === n ? 'La más lenta' : `Tu ${rank}.ª mejor`}</b> de {formatCount(n)}
              </span>
              <span>a {gap(l.s - r.best.s)} de tu mejor</span>
            </>
          )}
        </p>
      </div>
    </article>
  );
}

/** Fila de chips con desbordamiento: `data-more` mientras quede algo a la derecha. */
function ChipsScroll({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    check();
    el.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      el.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, []);
  return (
    <div ref={ref} className="chips-scroll" role="group" aria-label={label} data-more={more ? '' : undefined}>
      {children}
    </div>
  );
}

function RouteList({ data, onOpen }: { data: Data; onOpen: (id: string) => void }) {
  const { items, now } = data;
  const [sort, setSort] = useState<RouteSort>('veces');
  const [raw, setRaw] = useState('');
  const [shown, setShown] = useState(PAGE);
  const inputRef = useRef<HTMLInputElement>(null);
  const query = norm(raw.trim());

  const rows = useMemo(
    () => items.filter((r) => !query || norm(r.name).includes(query)).sort(ROUTE_SORTS[sort]),
    [items, query, sort],
  );
  const left = rows.length - shown;

  return (
    <section className="section" aria-labelledby="rep-t">
      <div className="section-h">
        <h2 className="section-title" id="rep-t">
          Tus rutas de siempre
        </h2>
      </div>
      {items.length > PAGE ? (
        <>
          <div className="search" role="search">
            <Search className="ic" aria-hidden="true" />
            <label className="sr-only" htmlFor="q-ruta">
              Buscar ruta
            </label>
            <input
              ref={inputRef}
              className="input"
              id="q-ruta"
              type="search"
              placeholder="Buscar ruta o pueblo…"
              autoComplete="off"
              enterKeyHint="search"
              spellCheck={false}
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setShown(PAGE);
              }}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label="Borrar la búsqueda"
              hidden={!raw}
              onClick={() => {
                setRaw('');
                inputRef.current?.focus();
              }}
            >
              <X className="ic" aria-hidden="true" />
            </button>
          </div>
          <p className="results" role="status">
            {!query
              ? ''
              : rows.length
                ? `${plural(rows.length, 'ruta', 'rutas')} con «${raw.trim()}»`
                : `Ninguna ruta con «${raw.trim()}». Prueba con otro nombre.`}
          </p>
        </>
      ) : null}
      {items.length >= 3 ? (
        <ChipsScroll label="Ordenar rutas">
          {SORT_OPTIONS.map(([v, text]) => (
            <FilterChip
              key={v}
              pressed={sort === v}
              onClick={() => {
                setSort(v);
                setShown(PAGE);
              }}
            >
              {text}
            </FilterChip>
          ))}
        </ChipsScroll>
      ) : null}
      {rows.length ? (
        <ul className="groups" id="lista-rutas">
          {rows.slice(0, shown).map((r) => (
            <RouteCard key={r.id} r={r} now={now} onOpen={onOpen} />
          ))}
        </ul>
      ) : null}
      {left > 0 ? (
        <button
          type="button"
          className="btn btn--ghost more-btn"
          aria-controls="lista-rutas"
          onClick={() => setShown((s) => s + PAGE)}
        >
          <ChevronDown className="ic" aria-hidden="true" />
          <span>
            Ver {Math.min(PAGE, left)} más<span className="more-left">, quedan {formatCount(left)}</span>
          </span>
        </button>
      ) : null}
    </section>
  );
}

function Loading() {
  const group = (
    <div className="card sk-group">
      <div className="sk-group-top">
        <Skeleton variant="box" height={64} />
        <span className="sk-stack">
          <Skeleton variant="title" width="70%" />
          <Skeleton width="48%" />
          <Skeleton width="60%" />
        </span>
      </div>
      <Skeleton height={34} />
    </div>
  );
  return (
    <>
      <span className="sr-only">Cargando rutas repetidas</span>
      <div className="card sk-last" aria-hidden="true">
        <Skeleton variant="title" />
        <div className="sk-group-top">
          <Skeleton variant="box" height={64} />
          <span className="sk-stack">
            <Skeleton variant="title" width="80%" />
            <Skeleton width="55%" />
          </span>
        </div>
        <Skeleton variant="fig" height={56} width="48%" />
      </div>
      <div className="groups sk-groups" aria-hidden="true">
        {group}
        {group}
      </div>
    </>
  );
}

/** Historial, vista Repetidas: las rutas que haces una y otra vez y, en una hoja, sus vueltas. */
export function Repetidas() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const analysis = useAnalysis();
  const ready = analysis.status === 'ready';
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  // La hoja va en la dirección (/historial/repetidas/:id), así que Atrás la cierra. Al cerrarse,
  // `shownId` mantiene la ruta mientras la hoja baja.
  const [shownId, setShownId] = useState<string | null>(id ?? null);
  if (id && id !== shownId) setShownId(id);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    Promise.all([listRouteSigs(), listActivities()]).then(
      ([sigs, rides]) => {
        if (!alive) return;
        const items = toRouteItems(groupRoutes(sigs), rides);
        setData({ items, byId: new Map(items.map((r) => [r.id, r])), now: Date.now() });
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [ready]);

  const item = shownId && data ? data.byId.get(shownId) : undefined;
  const notFound = Boolean(id && data && !data.byId.has(id));
  const openRoute = useCallback(
    (rid: string) => navigate(`/historial/repetidas/${encodeURIComponent(rid)}`, { state: SHEET_STATE }),
    [navigate],
  );
  // Abierta desde la lista, cerrar es volver atrás; desde un enlace directo, se sustituye la entrada.
  const closeSheet = () => {
    if (!id) return;
    if (isSheetState(location.state)) navigate(-1);
    else navigate('/historial/repetidas', { replace: true });
  };

  let lead: ReactNode = LEAD;
  let body: ReactNode;
  if (failed || analysis.status === 'error') {
    body = (
      <div className="card">
        <StateView
          icon={CircleAlert}
          tone="error"
          level={2}
          title="No se han podido leer tus salidas"
          text="El almacenamiento de este navegador no ha respondido. Vuelve a intentarlo; si sigue igual, restaura tu copia desde Ajustes."
          action={
            <button type="button" className="btn btn--secondary" onClick={() => window.location.reload()}>
              <RefreshCw className="ic" aria-hidden="true" />
              Reintentar
            </button>
          }
        />
      </div>
    );
  } else if (!data) {
    lead = (
      <span role="status">
        {analysis.status === 'running' && analysis.total > 0
          ? `Analizando salidas: ${formatCount(analysis.done)} de ${formatCount(analysis.total)}`
          : 'Buscando las rutas que repites…'}
      </span>
    );
    body = <Loading />;
  } else if (notFound) {
    body = (
      <div className="card">
        <StateView
          icon={Repeat}
          level={2}
          title="No se encuentra la ruta"
          text="Puede que ya no esté entre tus salidas o que el enlace esté incompleto."
          action={
            <Link className="btn btn--secondary" to="/historial/repetidas" replace>
              Ver todas las repetidas
            </Link>
          }
        />
      </div>
    );
  } else if (!data.items.length) {
    body = (
      <div className="card">
        <StateView
          icon={Repeat}
          level={2}
          title="Aún no repites ninguna ruta"
          text="Cuando hagas dos veces el mismo recorrido, aquí verás tus tiempos y si vas más rápido."
          action={
            <Link className="btn btn--primary" to="/importar">
              <Upload className="ic" aria-hidden="true" />
              Importar salidas nuevas
            </Link>
          }
        />
      </div>
    );
  } else {
    const items = data.items;
    const latest = items.reduce((a, r) => (r.last.t > a.last.t ? r : a));
    const withTrend = items.filter((r) => r.delta !== null).length;
    const up = items.filter((r) => r.delta !== null && r.delta >= TREND_FLAT).length;
    lead = (
      <>
        <b>{plural(items.length, 'ruta', 'rutas')}</b> que repites.
        {!withTrend ? '' : up ? ` En ${formatCount(up)} vas más rápido que antes.` : ' Aún no vas más rápido en ninguna.'}
      </>
    );
    body = (
      <>
        <LastCard r={latest} now={data.now} onOpen={openRoute} />
        <RouteList data={data} onOpen={openRoute} />
      </>
    );
  }

  return (
    <Page
      title="Historial"
      barTitle="Repetidas"
      variant="dense"
      className="repetidas"
      busy={!data && !failed}
      lead={lead}
      nav={<SegmentedNav label="Vistas del historial" items={HISTORIAL_VIEWS} current="/historial/repetidas" />}
    >
      {body}
      {item && data ? (
        <Sheet
          open={Boolean(id)}
          onClose={closeSheet}
          title={item.name}
          sub={`${formatKm(item.distM, 1)}, ${formatMeters(item.elevM)} de desnivel. Tiempos en movimiento.`}
          className="sheet--repetida"
        >
          <RepetidaDetail key={item.id} r={item} now={data.now} />
        </Sheet>
      ) : null}
    </Page>
  );
}
