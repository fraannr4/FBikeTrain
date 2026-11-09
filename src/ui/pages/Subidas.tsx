import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { listActivities, listClimbEfforts } from '../../db/repo';
import { groupClimbs } from '../../metrics/climbGroups';
import { gradeClass } from '../charts/grade';
import {
  CLIMB_SORTS,
  climbTime,
  gapTime,
  rankOf,
  relDay,
  shortDay,
  toClimbItems,
  vamOk,
  type ClimbItem,
  type ClimbSort,
} from '../climbView';
import { FilterChip } from '../components/Chip';
import { Page } from '../components/Page';
import { SegmentedNav } from '../components/SegmentedControl';
import { Sheet } from '../components/Sheet';
import { Skeleton, SkeletonRows } from '../components/Skeleton';
import { StateView } from '../components/StateView';
import { formatClimb, formatCount, formatMeters, formatVam } from '../format';
import { ArrowUp, ChevronDown, ChevronRight, CircleAlert, Mountain, RefreshCw, Search, TrendingUp, Upload, X } from '../icons';
import { isSheetState, SHEET_STATE } from '../shell/sheetRoute';
import { HISTORIAL_VIEWS } from '../shell/screens';
import { useAnalysis } from '../useAnalysis';
import { SubidaDetail } from './Subida';

/** Filas por página de la lista; las de una sola pasada empiezan por 10. */
const PAGE = 20;
const ONCE_PAGE = 10;
const LEAD = 'Los puertos que repites y cómo te van, pasada a pasada.';

const SORT_OPTIONS: [ClimbSort, string][] = [
  ['veces', 'Más pasadas'],
  ['recientes', 'Recientes'],
  ['duras', 'Más duras'],
  ['largas', 'Más largas'],
];
const SORTS = new Set<string>(SORT_OPTIONS.map(([v]) => v));
/** Lo que tarda la hoja en bajar (ver `Sheet`), con margen. */
const SHEET_EXIT_MS = 320;

type Data = { items: ClimbItem[]; byId: Map<string, ClimbItem>; now: number };

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Desplazamiento de la lista guardado en la entrada de la hoja al abrirla. */
const savedY = (state: unknown) => (isSheetState(state) ? Number((state as { y?: unknown }).y) || 0 : 0);

/** Tras «Ver más», el foco pasa a la primera fila nueva: el lector la anuncia y el teclado sigue ahí. */
function useFocusNewRows(shown: number) {
  const listRef = useRef<HTMLUListElement>(null);
  const from = useRef<number | null>(null);
  useEffect(() => {
    const i = from.current;
    from.current = null;
    if (i !== null) listRef.current?.children[i]?.querySelector<HTMLElement>('.row')?.focus();
  }, [shown]);
  return {
    listRef,
    focusFrom: (i: number) => {
      from.current = i;
    },
  };
}

function Vam({ mh }: { mh: number }) {
  return (
    <>
      VAM <span className="nw">{formatVam(mh)}</span>
    </>
  );
}

/** La rampa de la fila, con el color de su pendiente media. */
function Wedge({ grade }: { grade: number }) {
  const h = Math.min(28, 6 + grade * 2.6);
  return (
    <svg className="wedge" viewBox="0 0 42 42" aria-hidden="true">
      <polygon className={`w${gradeClass(grade)}`} points={`7,33 35,33 35,${(33 - h).toFixed(1)}`} />
      <line x1="7" x2="35" y1="33.5" y2="33.5" />
    </svg>
  );
}

const ClimbRow = memo(function ClimbRow({ c, now, onOpen }: { c: ClimbItem; now: number; onOpen: (id: string) => void }) {
  const n = c.passes.length;
  const isNew = n > 1 && c.last === c.best;
  return (
    <li>
      <button type="button" className="row" aria-haspopup="dialog" data-climb={c.id} onClick={() => onOpen(c.id)}>
        <span className="row-lead row-lead--wedge" aria-hidden="true">
          <Wedge grade={c.gradePct} />
        </span>
        <span className="row-main">
          <span className="row-title" dir="auto" title={c.name}>
            {c.name}
          </span>
          <span className="row-meta">{formatClimb(c.lengthM, c.gradePct)}</span>
          <span className="row-meta">
            {n > 1 ? (
              <>
                {plural(n, 'pasada', 'pasadas')}
                {vamOk(c) ? (
                  <>
                    {' · '}
                    <Vam mh={c.best.vamMh} />
                  </>
                ) : null}
              </>
            ) : (
              `Una pasada, ${relDay(c.last.activityStart, now)}`
            )}
          </span>
          {isNew ? (
            <span className="row-meta">
              <span className="chip chip--done">
                <TrendingUp className="ic" aria-hidden="true" />
                Mejor tiempo en la última
              </span>
            </span>
          ) : null}
        </span>
        <span className="row-trail">
          <span className="trail-stack">
            <span className="row-val">{climbTime(c.best.timeS)}</span>
            <span className="trail-cap">{n > 1 ? 'tu mejor' : 'tu tiempo'}</span>
          </span>
          <ChevronRight className="chev" aria-hidden="true" />
        </span>
      </button>
    </li>
  );
});

/** «Tu última subida»: compacta, sin perfil (está en la hoja), y toda ella abre la hoja. */
function LastCard({ c, now, onOpen }: { c: ClimbItem; now: number; onOpen: (id: string) => void }) {
  const p = c.last;
  const n = c.passes.length;
  const rank = rankOf(c, p);
  return (
    <article className="card last last--tap" data-m="elev" aria-labelledby="last-t">
      <div className="card-h">
        <span className="card-ic" aria-hidden="true">
          <Mountain className="ic" />
        </span>
        <h2 className="card-title" id="last-t">
          <button
            type="button"
            className="last-go"
            aria-haspopup="dialog"
            aria-label={`Tu última subida, ver tus ${formatCount(n)} pasadas`}
            onClick={() => onOpen(c.id)}
          >
            Tu última subida
          </button>
        </h2>
        <span className="last-when">{shortDay(p.activityStart, now)}</span>
        <ChevronRight className="chev" aria-hidden="true" />
      </div>
      <div>
        <p className="last-name" dir="auto" title={c.name}>
          {c.name}
        </p>
        <p className="last-line">
          {formatClimb(c.lengthM, c.gradePct)}
          {vamOk(c) ? (
            <>
              , <Vam mh={p.vamMh} />
            </>
          ) : null}
        </p>
      </div>
      <div className="last-fig">
        <span className="last-time">{climbTime(p.timeS)}</span>
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
              <span>
                a {gapTime(p.timeS - c.best.timeS)} de tu mejor, {climbTime(c.best.timeS)}
              </span>
            </>
          )}
        </p>
      </div>
    </article>
  );
}

function MoreButton({ left, onClick, controls }: { left: number; onClick: () => void; controls: string }) {
  if (left <= 0) return null;
  return (
    <button type="button" className="btn btn--ghost more-btn" aria-controls={controls} onClick={onClick}>
      <ChevronDown className="ic" aria-hidden="true" />
      <span>
        Ver {Math.min(PAGE, left)} más<span className="more-left">, quedan {formatCount(left)}</span>
      </span>
    </button>
  );
}

/** Las de una sola pasada: plegadas tras su botón, de la más reciente a la más antigua. */
function OnceBlock({ list, now, onOpen }: { list: ClimbItem[]; now: number; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(ONCE_PAGE);
  const id = useId();
  const { listRef, focusFrom } = useFocusNewRows(shown);
  if (!list.length) return null;
  const label = open
    ? list.length === 1
      ? 'Ocultar la que has subido una vez'
      : 'Ocultar las que has subido una vez'
    : list.length === 1
      ? 'Ver la que has subido una vez'
      : `Ver las ${formatCount(list.length)} que has subido una vez`;
  return (
    <>
      <button
        type="button"
        className="btn btn--ghost more-btn"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((v) => !v);
          setShown(ONCE_PAGE);
        }}
      >
        <ChevronDown className="ic" aria-hidden="true" />
        {label}
      </button>
      <ul ref={listRef} className="list list--inset subidas-list" id={id} hidden={!open}>
        {open ? list.slice(0, shown).map((c) => <ClimbRow key={c.id} c={c} now={now} onOpen={onOpen} />) : null}
      </ul>
      {open ? (
        <MoreButton
          left={list.length - shown}
          controls={id}
          onClick={() => {
            focusFrom(shown);
            setShown(shown + PAGE);
          }}
        />
      ) : null}
    </>
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

function ClimbList({ data, onOpen }: { data: Data; onOpen: (id: string) => void }) {
  const { items, now } = data;
  // Orden, búsqueda y filas cargadas van en la dirección (?orden=duras&q=rupit&n=40): al volver de
  // una salida, la pantalla se monta de nuevo y la lista sigue igual.
  const [params, setParams] = useSearchParams();
  const o = params.get('orden');
  const sort: ClimbSort = o && SORTS.has(o) ? (o as ClimbSort) : 'veces';
  const shown = Math.max(PAGE, Number(params.get('n')) || 0);
  // El texto se lee de la dirección al montar y se escribe en ella, pero el campo no espera a la navegación.
  const [raw, setRaw] = useState(() => params.get('q') ?? '');
  const setUrl = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );
  const { listRef, focusFrom } = useFocusNewRows(shown);
  const inputRef = useRef<HTMLInputElement>(null);
  const query = norm(raw.trim());

  const repeated = useMemo(() => items.filter((c) => c.passes.length > 1), [items]);
  const rep = useMemo(
    () => repeated.filter((c) => !query || norm(c.name).includes(query)).sort(CLIMB_SORTS[sort]),
    [repeated, query, sort],
  );
  const once = useMemo(
    () =>
      items
        .filter((c) => c.passes.length === 1 && (!query || norm(c.name).includes(query)))
        .sort(CLIMB_SORTS.recientes),
    [items, query],
  );
  const hits = rep.length + once.length;

  return (
    <section className="section" aria-labelledby="rep-t">
      <div className="section-h">
        <h2 className="section-title" id="rep-t">
          Las que repites
        </h2>
      </div>
      {items.length > PAGE ? (
        <>
          <div className="search" role="search">
            <Search className="ic" aria-hidden="true" />
            <label className="sr-only" htmlFor="q-sub">
              Buscar subida
            </label>
            <input
              ref={inputRef}
              className="input"
              id="q-sub"
              type="search"
              placeholder="Buscar subida o puerto…"
              autoComplete="off"
              enterKeyHint="search"
              spellCheck={false}
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setUrl({ q: e.target.value, n: null });
              }}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label="Borrar la búsqueda"
              hidden={!raw}
              onClick={() => {
                setRaw('');
                setUrl({ q: null });
                inputRef.current?.focus();
              }}
            >
              <X className="ic" aria-hidden="true" />
            </button>
          </div>
          <p className="results" role="status">
            {!query
              ? ''
              : hits
                ? `${plural(hits, 'subida', 'subidas')} con «${raw.trim()}»`
                : `Ninguna subida con «${raw.trim()}». Prueba con otro nombre.`}
          </p>
        </>
      ) : null}
      {repeated.length >= 3 ? (
        <ChipsScroll label="Ordenar subidas">
          {SORT_OPTIONS.map(([v, text]) => (
            <FilterChip
              key={v}
              pressed={sort === v}
              onClick={() => setUrl({ orden: v === 'veces' ? null : v, n: null })}
            >
              {text}
            </FilterChip>
          ))}
        </ChipsScroll>
      ) : null}
      {rep.length ? (
        <ul ref={listRef} className="list list--inset subidas-list" id="lista-subidas">
          {rep.slice(0, shown).map((c) => (
            <ClimbRow key={c.id} c={c} now={now} onOpen={onOpen} />
          ))}
        </ul>
      ) : null}
      <MoreButton
        left={rep.length - shown}
        controls="lista-subidas"
        onClick={() => {
          focusFrom(shown);
          setUrl({ n: String(shown + PAGE) });
        }}
      />
      <OnceBlock key={query} list={once} now={now} onOpen={onOpen} />
    </section>
  );
}

/** Historial, vista Subidas: los puertos que repites, la última subida y, en una hoja, cada puerto. */
export function Subidas() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const analysis = useAnalysis();
  const ready = analysis.status === 'ready';
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  // La hoja va en la dirección (/historial/subidas/:id), así que Atrás la cierra. Al cerrarse,
  // `shownId` mantiene la subida mientras la hoja baja.
  const [shownId, setShownId] = useState<string | null>(id ?? null);
  if (id && id !== shownId) setShownId(id);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    Promise.all([listClimbEfforts(), listActivities()]).then(
      ([efforts, rides]) => {
        if (!alive) return;
        const items = toClimbItems(groupClimbs(efforts), rides);
        setData({ items, byId: new Map(items.map((c) => [c.id, c])), now: Date.now() });
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [ready]);

  const item = shownId && data ? data.byId.get(shownId) : undefined;
  const notFound = Boolean(id && data && !data.byId.has(id));
  const { search } = location;
  // La hoja arrastra la búsqueda de la lista y guarda dónde estaba la página, para volver al mismo sitio.
  const openClimb = useCallback(
    (cid: string) =>
      navigate(
        { pathname: `/historial/subidas/${encodeURIComponent(cid)}`, search },
        { state: { ...SHEET_STATE, y: Math.round(window.scrollY) } },
      ),
    [navigate, search],
  );
  // Abierta desde la lista, cerrar es volver atrás; desde un enlace directo, se sustituye la entrada.
  const closeSheet = () => {
    if (!id) return;
    if (isSheetState(location.state)) navigate(-1);
    else navigate({ pathname: '/historial/subidas', search }, { replace: true });
  };

  // De vuelta de una salida, la pantalla se monta otra vez con la hoja abierta: en cuanto está la
  // lista, la página vuelve a donde estaba.
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!data || restored.current) return;
    restored.current = true;
    const y = savedY(location.state);
    if (id && y > 0) window.scrollTo(0, y);
  }, [data, id, location.state]);

  // Al cerrar una hoja que no se abrió desde esta pantalla (se montó al volver), el foco no tiene a
  // quién volver: va a la fila de esa subida.
  const lastId = useRef(id);
  useEffect(() => {
    const was = lastId.current;
    lastId.current = id;
    if (id || !was) return;
    const t = window.setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      document.querySelector<HTMLElement>(`.subidas-list [data-climb="${CSS.escape(was)}"]`)?.focus({ preventScroll: true });
    }, SHEET_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [id]);

  const repeated = data ? data.items.filter((c) => c.passes.length > 1) : [];
  const latest = repeated.reduce<ClimbItem | null>(
    (a, c) => (!a || c.last.activityStart > a.last.activityStart ? c : a),
    null,
  );

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
          : 'Calculando tus subidas…'}
      </span>
    );
    body = (
      <>
        <div className="card sk-last" aria-hidden="true">
          <Skeleton variant="title" />
          <Skeleton variant="title" width="72%" />
          <Skeleton variant="fig" height={56} width="52%" />
          <Skeleton width="64%" />
        </div>
        <div className="list">
          <SkeletonRows rows={4} label="Cargando subidas" />
        </div>
      </>
    );
  } else if (notFound) {
    body = (
      <div className="card">
        <StateView
          icon={Mountain}
          level={2}
          title="No se encuentra la subida"
          text="Puede que ya no esté entre tus salidas o que el enlace esté incompleto."
          action={
            <Link className="btn btn--secondary" to="/historial/subidas" replace>
              Ver todas las subidas
            </Link>
          }
        />
      </div>
    );
  } else if (!data.items.length) {
    body = (
      <div className="card">
        <StateView
          icon={Mountain}
          level={2}
          title="Aún no hay subidas detectadas"
          text="Cuenta como subida un tramo de 1 km o más al 3 % o más. Importa salidas con GPS y altitud y aquí verás tus tiempos en cada puerto."
          action={
            <Link className="btn btn--primary" to="/importar">
              <Upload className="ic" aria-hidden="true" />
              Importar salidas nuevas
            </Link>
          }
        />
      </div>
    );
  } else if (!latest) {
    body = (
      <>
        <div className="card">
          <StateView
            icon={Mountain}
            level={2}
            title="Aún no repites ninguna subida"
            text="Cuando pases dos veces por el mismo puerto, aquí verás tus tiempos uno frente a otro."
            action={
              <Link className="btn btn--primary" to="/importar">
                <Upload className="ic" aria-hidden="true" />
                Importar salidas nuevas
              </Link>
            }
          />
        </div>
        <section className="section once-only" aria-label="Subidas de una sola pasada">
          <OnceBlock list={data.items.slice().sort(CLIMB_SORTS.recientes)} now={data.now} onOpen={openClimb} />
        </section>
      </>
    );
  } else {
    lead = (
      <>
        <b>{plural(repeated.length, 'subida', 'subidas')}</b> que repites, de {formatCount(data.items.length)}.
      </>
    );
    body = (
      <>
        <LastCard c={latest} now={data.now} onOpen={openClimb} />
        <ClimbList data={data} onOpen={openClimb} />
      </>
    );
  }

  return (
    <Page
      title="Historial"
      barTitle="Subidas"
      variant="dense"
      className="subidas"
      busy={!data && !failed}
      lead={lead}
      nav={<SegmentedNav label="Vistas del historial" items={HISTORIAL_VIEWS} current="/historial/subidas" />}
    >
      {body}
      {item && data ? (
        <Sheet
          open={Boolean(id)}
          onClose={closeSheet}
          title={item.name}
          sub={`${formatClimb(item.lengthM, item.gradePct)}, ${formatMeters(item.gainM)} de desnivel.`}
          className="sheet--subida"
        >
          <SubidaDetail key={item.id} item={item} now={data.now} />
        </Sheet>
      ) : null}
    </Page>
  );
}
