import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigationType, useSearchParams } from 'react-router-dom';
import type { StoredActivity } from '../../domain/types';
import { cachedActivities, readActivities } from '../../db/activityCache';
import { listRouteSigs } from '../../db/repo';
import { TZDate } from '@date-fns/tz';
import { TZ } from '../../metrics/aggregate';
import { computeReference, type Difficulty } from '../../metrics/reference';
import { groupRoutes } from '../../metrics/routes';
import { Page } from '../components/Page';
import { SegmentedNav } from '../components/SegmentedControl';
import { Skeleton, SkeletonRows } from '../components/Skeleton';
import { StateView } from '../components/StateView';
import { formatCount } from '../format';
import { Bike, CircleAlert, RefreshCw, Search, SlidersHorizontal, Upload, X } from '../icons';
import { HISTORIAL_VIEWS } from '../shell/screens';
import { DIST_LABEL, FilterSheet, LEVELS, SORT_OPTIONS, yearLabel, type SheetState } from '../historial/FilterSheet';
import { MonthSection } from '../historial/MonthSection';
import { RideRow } from '../historial/RideRow';
import {
  applyFilters,
  groupByMonth,
  longDate,
  monthlyAverages,
  monthTotals,
  normalize,
  toItems,
  type DistKey,
  type RideItem,
  type SortKey,
} from '../historial/model';

/** Filas por página: la lista no se pinta entera (con 5.000 salidas, segundos y miles de nodos). */
export const PAGE_ROWS = 50;
const NO_REPEATED: ReadonlySet<string> = new Set();
const SORT_KEYS = new Set<string>(SORT_OPTIONS.map((o) => o.value));
const DIST_KEYS = new Set<string>(Object.keys(DIST_LABEL));
const LEVEL_KEYS = new Set<string>(LEVELS);

/** «Dura,Media» de la dirección: solo los niveles que existen, sin repetir y en su orden. */
function parseLevels(param: string): Difficulty[] {
  return [...new Set(param.split(',').filter((l) => LEVEL_KEYS.has(l)))] as Difficulty[];
}

/** Cómo se dejó la lista, por entrada del historial del navegador, para dejarla igual al volver. */
type ListView = { y: number; n: number; opened: string | null };
const views = new Map<string, ListView>();
const SORT_TEXT: Record<Exclude<SortKey, 'fecha'>, string> = {
  km: 'de más a menos distancia',
  m: 'de más a menos desnivel',
  kmh: 'de más a menos rápida',
};
const SORT_CHIP: Record<Exclude<SortKey, 'fecha'>, string> = {
  km: 'Por distancia',
  m: 'Por desnivel',
  kmh: 'Por velocidad',
};

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; acts: StoredActivity[]; now: number };

/** Historial, vista Salidas: las salidas por mes, con búsqueda, filtros y orden. */
export function Historial() {
  // Si ya se leyeron, la lista se pinta en el primer render: sin esqueleto y con la altura de antes.
  const [load, setLoad] = useState<Load>(() => {
    const acts = cachedActivities();
    return acts ? { status: 'ready', acts, now: Date.now() } : { status: 'loading' };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    readActivities().then(
      (acts) => alive && setLoad((l) => (l.status === 'ready' && l.acts === acts ? l : { status: 'ready', acts, now: Date.now() })),
      () => alive && setLoad({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  const retry = () => {
    setLoad({ status: 'loading' });
    setAttempt((n) => n + 1);
  };

  const nav = <SegmentedNav label="Vistas del historial" items={HISTORIAL_VIEWS} current="/historial" />;
  let body: ReactNode;
  if (load.status === 'loading') body = <Loading nav={nav} />;
  else if (load.status === 'error')
    body = (
      <Tools nav={nav} lead="Tus salidas siguen guardadas en este teléfono.">
        <div className="card">
          <StateView
            tone="error"
            level={2}
            icon={CircleAlert}
            title="No se han podido abrir tus salidas"
            text="El navegador no ha dejado leer los datos guardados. Cierra las otras pestañas de FBikeTrain y vuelve a intentarlo."
            action={
              <button type="button" className="btn btn--secondary" onClick={retry}>
                <RefreshCw className="ic" aria-hidden="true" />
                Reintentar
              </button>
            }
          />
        </div>
      </Tools>
    );
  else if (load.acts.length === 0)
    body = (
      <Tools nav={nav} lead="Aquí verás cada salida, agrupada por mes.">
        <div className="card">
          <StateView
            level={2}
            icon={Bike}
            title="Aún no hay salidas"
            text="Importa el archivo que te envía Strava. Tus salidas se guardan solo en este teléfono."
            action={
              <Link className="btn btn--primary" to="/importar">
                <Upload className="ic" aria-hidden="true" />
                Importar salidas
              </Link>
            }
          />
        </div>
      </Tools>
    );
  else body = <Rides nav={nav} acts={load.acts} now={load.now} />;

  return (
    <Page
      title="Historial"
      variant="dense"
      className="hist"
      busy={load.status === 'loading'}
      actions={
        <Link className="icon-btn" to="/importar" aria-label="Importar salidas de Strava">
          <Upload className="ic" aria-hidden="true" />
        </Link>
      }
    >
      {body}
    </Page>
  );
}

/** Segmentado de vistas y, debajo, la entradilla o la barra de búsqueda. */
function Tools({ nav, lead, tools, children }: { nav: ReactNode; lead?: string; tools?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <section className="hist-tools" aria-label="Buscar y filtrar">
        {nav}
        {lead ? <p className="page-lead page-lead--sub">{lead}</p> : null}
        {tools}
      </section>
      {children}
    </>
  );
}

function Loading({ nav }: { nav: ReactNode }) {
  return (
    <Tools
      nav={nav}
      tools={
        <div className="toolbar">
          <div className="search" role="search">
            <Search className="ic" aria-hidden="true" />
            <label className="sr-only" htmlFor="hist-q">
              Buscar salidas
            </label>
            <input className="input" id="hist-q" type="search" placeholder="Buscar por nombre…" disabled />
          </div>
          <button type="button" className="icon-btn icon-btn--filled" aria-label="Filtrar y ordenar" disabled>
            <SlidersHorizontal className="ic" aria-hidden="true" />
          </button>
        </div>
      }
    >
      <div className="months">
        <div className="month">
          <div className="month-bar" aria-hidden="true">
            <div className="month-bar-in">
              <Skeleton variant="title" width="40%" height={22} />
              <Skeleton width={72} height={22} />
            </div>
          </div>
          <Skeleton width="62%" />
          <Skeleton variant="box" className="sk-days" />
          <div className="list sk-list">
            <SkeletonRows rows={5} label="Cargando tus salidas…" />
          </div>
        </div>
      </div>
    </Tools>
  );
}

function Rides({ nav, acts, now }: { nav: ReactNode; acts: StoredActivity[]; now: number }) {
  const [params, setParams] = useSearchParams();
  const [qInput, setQInput] = useState(() => params.get('q') ?? '');
  const q = useDeferredValue(qInput).trim();
  const qn = normalize(q);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [repeated, setRepeated] = useState<ReadonlySet<string>>(NO_REPEATED);

  // Rutas repetidas: después de pintar la lista, para no retrasarla.
  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      listRouteSigs().then(
        (sigs) => alive && setRepeated(new Set(groupRoutes(sigs).flatMap((g) => g.activityIds))),
        () => {},
      );
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [acts]);

  const items = useMemo(() => toItems(acts, computeReference(acts, now)), [acts, now]);
  const years = useMemo(() => [...new Set(items.map((r) => r.year))].sort((a, b) => b - a), [items]);
  const thisYear = new TZDate(now, TZ).getFullYear();
  const months = useMemo(() => {
    const list = monthTotals(items, now);
    return { totals: new Map(list.map((p) => [p.start, p])), averages: monthlyAverages(list) };
  }, [items, now]);

  const sortParam = params.get('orden') ?? '';
  const sort: SortKey = SORT_KEYS.has(sortParam) ? (sortParam as SortKey) : 'fecha';
  const yearParam = Number(params.get('periodo'));
  const year = years.includes(yearParam) ? yearParam : null;
  const distParam = params.get('dist') ?? '';
  const dist: DistKey = DIST_KEYS.has(distParam) ? (distParam as DistKey) : 'all';
  const difParam = params.get('dif') ?? '';
  const dif = useMemo(() => parseLevels(difParam), [difParam]);
  const rep = params.get('rep') === '1';

  // La búsqueda, el orden y los filtros viven en la dirección: al volver de una salida se conservan.
  const writeParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );
  // La dirección sigue a lo escrito, no a la lista diferida: si esta tarda, otro cambio no recupera un «q» ya borrado.
  const qTyped = qInput.trim();
  useEffect(() => {
    if ((params.get('q') ?? '') !== qTyped) writeParams({ q: qTyped || null });
  }, [qTyped, params, writeParams]);

  const filtered = useMemo(
    () => applyFilters(items, { qn, sort, year, dist, dif, rep }, repeated),
    [items, qn, sort, year, dist, dif, rep, repeated],
  );

  const filtersOn = dist !== 'all' || dif.length > 0 || rep || year !== null;
  const plain = !qn && !filtersOn;
  const byDate = sort === 'fecha';

  // Página: vuelve a 50 filas cuando cambia lo que se ve.
  const key = `${qn}|${sort}|${year}|${dist}|${dif.join()}|${rep}`;
  // Al volver atrás (o adelante) a esta entrada, las mismas filas, la misma altura y el foco en la salida abierta.
  const { key: entry, pathname, search } = useLocation();
  const navType = useNavigationType();
  const [restore] = useState(() => (navType === 'POP' ? views.get(entry) : undefined));
  const [page, setPage] = useState({ key, n: restore?.n ?? PAGE_ROWS });
  const shown = page.key === key ? page.n : PAGE_ROWS;
  const more = useCallback(() => setPage((p) => ({ key, n: (p.key === key ? p.n : PAGE_ROWS) + PAGE_ROWS })), [key]);
  const hasMore = shown < filtered.length;
  // Con «Solo repetidas», la lista no está completa hasta leer las rutas repetidas.
  const repReady = !rep || repeated !== NO_REPEATED;

  const monthsRef = useRef<HTMLDivElement>(null);
  const opened = useRef<string | null>(null);
  const leaving = useRef({ entry, href: '', n: shown });
  useLayoutEffect(() => {
    leaving.current = { entry, href: `#${pathname}${search}`, n: shown };
  });
  // Al irse a otra pantalla, antes de que esta suba al principio. Desmontar sin cambiar de
  // dirección (doble montaje de StrictMode) no cuenta.
  useLayoutEffect(
    () => () => {
      const { entry: at, href, n } = leaving.current;
      if (window.location.hash !== href) views.set(at, { y: window.scrollY, n, opened: opened.current });
    },
    [],
  );
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!restore || restored.current || !repReady) return;
    restored.current = true;
    window.scrollTo(0, restore.y);
    const links = monthsRef.current?.querySelectorAll('a') ?? [];
    [...links].find((a) => a.getAttribute('href') === restore.opened)?.focus({ preventScroll: true });
  }, [restore, repReady]);

  // Al acercarse el final de la lista a la pantalla, la página siguiente. El botón queda para el teclado.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!hasMore || !el || typeof IntersectionObserver !== 'function') return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && more(), { rootMargin: '0px 0px 800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, shown, more]);

  // «/» lleva a la búsqueda (teclado físico).
  const qRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (e.key !== '/' || tag === 'input' || tag === 'textarea' || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      qRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const sheetState: SheetState = { sort, year, dist, dif, rep };
  const change = (patch: Partial<SheetState>) => {
    const url: Record<string, string | null> = {};
    if ('sort' in patch) url.orden = patch.sort && patch.sort !== 'fecha' ? patch.sort : null;
    if ('year' in patch) url.periodo = patch.year ? String(patch.year) : null;
    if (patch.dist) url.dist = patch.dist === 'all' ? null : patch.dist;
    if (patch.dif) url.dif = patch.dif.join(',') || null;
    if (patch.rep !== undefined) url.rep = patch.rep ? '1' : null;
    if (Object.keys(url).length > 0) writeParams(url);
  };
  const reset = () => change({ sort: 'fecha', year: null, dist: 'all', dif: [], rep: false });
  const clearQ = () => {
    setQInput('');
    qRef.current?.focus();
  };

  // Filtros aplicados, cada uno se quita con un toque. El foco pasa al siguiente o al botón de filtros.
  const chips: { id: string; label: string; remove: () => void }[] = [];
  if (sort !== 'fecha') chips.push({ id: 'sort', label: SORT_CHIP[sort], remove: () => change({ sort: 'fecha' }) });
  if (year !== null) chips.push({ id: 'year', label: yearLabel(year, thisYear), remove: () => change({ year: null }) });
  if (dist !== 'all') chips.push({ id: 'dist', label: DIST_LABEL[dist], remove: () => change({ dist: 'all' }) });
  for (const l of dif) chips.push({ id: `dif-${l}`, label: l, remove: () => change({ dif: dif.filter((x) => x !== l) }) });
  if (rep) chips.push({ id: 'rep', label: 'Solo repetidas', remove: () => change({ rep: false }) });

  const chipsRef = useRef<HTMLDivElement>(null);
  const filterBtn = useRef<HTMLButtonElement>(null);
  const focusChip = useRef<number | null>(null);
  useEffect(() => {
    const i = focusChip.current;
    if (i === null) return;
    focusChip.current = null;
    const next = chipsRef.current?.querySelectorAll('button');
    (next && next.length > 0 ? next[Math.min(i, next.length - 1)] : filterBtn.current)?.focus();
  });

  const showCount = !(plain && byDate) && filtered.length > 0;
  const resultCount = showCount ? (
    <>
      <b>{formatCount(filtered.length)}</b> de {plural(acts.length, 'salida', 'salidas')}
      {byDate ? '' : `, ${SORT_TEXT[sort as Exclude<SortKey, 'fecha'>]}`}
    </>
  ) : null;
  // Fuera de la región viva: el lector anuncia solo el recuento, no el texto del botón.
  const clearFilters =
    showCount && chips.length > 0 ? (
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => {
          reset();
          qRef.current?.focus();
        }}
      >
        Quitar filtros
      </button>
    ) : null;

  const row = (r: RideItem) => (
    <RideRow
      key={r.act.id}
      item={r}
      now={now}
      flat={!byDate}
      qn={qn}
      repeated={repeated.has(r.act.id)}
      showSpeed={sort === 'kmh'}
    />
  );

  let list: ReactNode;
  if (!repReady) {
    list = null;
  } else if (filtered.length === 0) {
    list = (
      <div className="card">
        {q ? (
          <StateView
            level={2}
            icon={Search}
            title={`Ninguna salida con «${q}»`}
            text="Prueba con otra palabra del nombre de la salida."
            action={
              <button type="button" className="btn btn--secondary" onClick={clearQ}>
                <X className="ic" aria-hidden="true" />
                Borrar la búsqueda
              </button>
            }
          />
        ) : (
          <StateView
            level={2}
            icon={Search}
            title="Ninguna salida con estos filtros"
            text="Quita alguno para ver más salidas."
            action={
              <button type="button" className="btn btn--secondary" onClick={reset}>
                Quitar filtros
              </button>
            }
          />
        )}
      </div>
    );
  } else if (byDate) {
    let left = shown;
    const sections: ReactNode[] = [];
    for (const g of groupByMonth(filtered)) {
      if (left <= 0) break;
      const visible = g.items.slice(0, left);
      left -= visible.length;
      sections.push(
        <MonthSection
          key={g.month}
          month={g.month}
          now={now}
          items={g.items}
          full={plain}
          totals={months.totals.get(g.month)}
          average={months.averages.get(g.month)}
        >
          {visible.map(row)}
        </MonthSection>,
      );
    }
    list = sections;
  } else {
    list = <ul className="list list--inset rides">{filtered.slice(0, shown).map(row)}</ul>;
  }

  return (
    <Tools
      nav={nav}
      tools={
        <>
          <div className="toolbar">
            <div className="search" role="search">
              <Search className="ic" aria-hidden="true" />
              <label className="sr-only" htmlFor="hist-q">
                Buscar salidas
              </label>
              <input
                ref={qRef}
                className="input"
                id="hist-q"
                type="search"
                placeholder="Buscar por nombre…"
                autoComplete="off"
                enterKeyHint="search"
                spellCheck={false}
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && qInput) {
                    e.preventDefault();
                    setQInput('');
                  }
                }}
              />
              {qInput ? (
                <button type="button" className="icon-btn" aria-label="Borrar la búsqueda" onClick={clearQ}>
                  <X className="ic" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <button
              ref={filterBtn}
              type="button"
              className="icon-btn icon-btn--filled"
              aria-label={`Filtrar y ordenar${chips.length ? `, ${plural(chips.length, 'filtro activo', 'filtros activos')}` : ''}`}
              aria-haspopup="dialog"
              onClick={() => setSheetOpen(true)}
            >
              <SlidersHorizontal className="ic" aria-hidden="true" />
              {chips.length ? (
                <span className="count" aria-hidden="true">
                  {chips.length}
                </span>
              ) : null}
            </button>
          </div>
          {chips.length > 0 ? (
            <div className="chips-scroll applied" role="group" aria-label="Filtros aplicados" ref={chipsRef}>
              {chips.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  className="fchip fchip--x"
                  aria-label={`Quitar el filtro ${c.label}`}
                  onClick={() => {
                    focusChip.current = i;
                    c.remove();
                  }}
                >
                  <span>
                    {c.label}
                    <X className="ic" aria-hidden="true" />
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="results">
            <p className="results-count" role="status">
              {resultCount}
            </p>
            {clearFilters}
          </div>
        </>
      }
    >
      {/* Anota qué salida se abre (el clic llega del enlace de la fila) para devolverle el foco al volver. */}
      <div
        className="months"
        ref={monthsRef}
        onClick={(e) => {
          const a = (e.target as Element).closest('a');
          if (a) opened.current = a.getAttribute('href');
        }}
      >
        {list}
      </div>
      {hasMore ? (
        <>
          <div ref={sentinel} className="more-sentinel" aria-hidden="true" />
          <button type="button" className="btn btn--secondary btn--block more-rides" onClick={more}>
            Mostrar más
          </button>
        </>
      ) : plain && byDate ? (
        <p className="end-note">Tu primera salida importada es del {longDate(acts[0].startTime)}.</p>
      ) : null}
      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        state={sheetState}
        onChange={change}
        onReset={reset}
        years={years}
        thisYear={thisYear}
        hasLevels={items.some((r) => r.level !== null)}
        hasRepeated={repeated.size > 0}
        count={filtered.length}
      />
    </Tools>
  );
}
