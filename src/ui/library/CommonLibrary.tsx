import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import type { LatLng } from '../../domain/types';
import { loadSettings } from '../../settings/settings';
import type { LibraryCatalog } from '../../routes/library/catalog';
import { activeFilterCount, applyCatalogFilter, NO_FILTER, sourcesOf, type CatalogFilter } from '../../routes/library/catalogView';
import type { ReferenceRoute } from '../../routes/library';
import { findLibraryCatalog } from '../../routes/sources/client';
import { Skeleton } from '../components/Skeleton';
import { StateView } from '../components/StateView';
import { useDesktopLayout } from '../hooks/useDesktopLayout';
import { formatCount } from '../format';
import { ListFilter, MapPin, RefreshCw, Route as RouteIcon, Search, WifiOff, Lock } from '../icons';
import { CatalogCard } from './CatalogCard';
import { CatalogDetail } from './CatalogDetail';
import { FilterControls, FilterSheet } from './CatalogFilters';

/** Radio de la búsqueda por defecto: la biblioteca es pequeña y el usuario quiere verla entera. */
const DEFAULT_RADIUS_KM = 100;
/** Catálogos ya descargados en esta sesión, por cuenta, punto a 3 decimales y radio. */
const cache = new Map<string, LibraryCatalog>();
export const clearCatalogCache = () => cache.clear();

type Load = { state: 'loading' } | { state: 'ready'; catalog: LibraryCatalog } | { state: 'error'; busy: boolean };

function useCatalog(account: Account, centre: LatLng, radiusKm: number) {
  const key = `${account.user.id}|${centre.lat.toFixed(3)}|${centre.lng.toFixed(3)}|${radiusKm}`;
  const [load, setLoad] = useState<Load>(() => { const hit = cache.get(key); return hit ? { state: 'ready', catalog: hit } : { state: 'loading' }; });
  const [attempt, setAttempt] = useState(0);
  // supabase-js crea un cliente de funciones nuevo en cada lectura: se lee al llamar, no como dependencia.
  const clientRef = useRef(account.client);
  clientRef.current = account.client;
  useEffect(() => {
    const hit = attempt === 0 ? cache.get(key) : undefined;
    if (hit) { setLoad({ state: 'ready', catalog: hit }); return; }
    const controller = new AbortController();
    setLoad({ state: 'loading' });
    findLibraryCatalog({ lat: centre.lat, lon: centre.lng, radiusM: radiusKm * 1000 }, clientRef.current.functions, controller.signal)
      .then(catalog => { cache.set(key, catalog); setLoad({ state: 'ready', catalog }); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setLoad({ state: 'error', busy: e instanceof Error && e.message === 'busy' }); });
    return () => controller.abort();
  // `key` ya resume cuenta, punto y radio.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  return { load, retry: () => setAttempt(n => n + 1) };
}

type Props = {
  /** Enlaces de origen de las rutas ya guardadas en «Mis rutas»: esas se marcan como guardadas. */
  savedUrls: Set<string>;
  onSaved: (route: ReferenceRoute) => void;
};

/** «Biblioteca común»: las rutas de la biblioteca compartida cerca de tu inicio, con filtros y detalle. */
export function CommonLibrary({ savedUrls, onSaved }: Props) {
  const account = useAccount();
  const [home, setHome] = useState<LatLng | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadSettings().then(s => { if (live) setHome(s.home); }).catch(() => { if (live) setHome(null); });
    return () => { live = false; };
  }, []);
  if (!account || account.user.is_anonymous) {
    return <StateView icon={Lock} title="Entra con tu cuenta" text="La biblioteca común es de los usuarios registrados. Entra con tu cuenta para verla." level={2} action={<Link className="btn btn--secondary" to="/ajustes">Ir a Ajustes</Link>} />;
  }
  if (home === undefined) return <CatalogSkeleton />;
  if (home === null) {
    return <StateView icon={MapPin} title="Elige tu punto de salida" text="Con tu inicio te enseñamos las rutas que salen cerca. Fíjalo en Rutas y vuelve aquí." level={2} action={<Link className="btn btn--secondary" to="/rutas">Ir a Rutas</Link>} />;
  }
  return <Browser account={account} centre={home} savedUrls={savedUrls} onSaved={onSaved} />;
}

function CatalogSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">Cargando la biblioteca común</span>
      <ul className="lib-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="rcard lib-sk"><Skeleton variant="box" height={132} /><div className="rcard-body"><Skeleton variant="title" width="70%" /><Skeleton width="45%" /><Skeleton width="85%" /></div></li>
        ))}
      </ul>
    </div>
  );
}

function Browser({ account, centre, savedUrls, onSaved }: { account: Account; centre: LatLng; savedUrls: Set<string>; onSaved: (route: ReferenceRoute) => void }) {
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const { load, retry } = useCatalog(account, centre, radiusKm);
  const [filter, setFilter] = useState<CatalogFilter>(NO_FILTER);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const desktop = useDesktopLayout();
  const searchId = useId();
  const patch = useCallback((p: Partial<CatalogFilter>) => setFilter(f => ({ ...f, ...p })), []);

  const routes = load.state === 'ready' ? load.catalog.routes : null;
  const items = useMemo(() => routes ? applyCatalogFilter(routes, filter, centre) : [], [routes, filter, centre]);
  const sources = useMemo(() => routes ? sourcesOf(routes) : [], [routes]);
  const active = activeFilterCount(filter);
  const reset = () => setFilter(f => ({ ...NO_FILTER, sort: f.sort }));
  const open = openId && routes ? routes.find(r => r.id === openId) ?? null : null;

  const controls = <FilterControls filter={filter} onChange={patch} sources={sources} radiusKm={radiusKm} onRadius={setRadiusKm} />;
  return (
    <div className="lib-common">
      <div className="toolbar">
        <div className="search">
          <Search className="ic" aria-hidden="true" />
          <label className="sr-only" htmlFor={searchId}>Buscar por nombre o autor</label>
          <input id={searchId} className="input" type="search" inputMode="search" maxLength={80} autoComplete="off" placeholder="Pantano, Navacerrada…" value={filter.text} onChange={e => patch({ text: e.target.value })} />
        </div>
        {desktop ? null : (
          <button type="button" className="icon-btn icon-btn--filled" aria-label={active > 0 ? `Filtrar y ordenar (${active})` : 'Filtrar y ordenar'} aria-haspopup="dialog" onClick={() => setSheetOpen(true)}>
            <ListFilter className="ic" aria-hidden="true" />
            {active > 0 ? <span className="dot" aria-hidden="true" /> : null}
          </button>
        )}
      </div>
      {desktop ? <section className="card lib-filters" aria-label="Filtros y orden">{controls}</section> : null}

      {load.state === 'loading' ? <CatalogSkeleton /> : null}
      {load.state === 'error' ? (
        <StateView
          icon={load.busy ? RefreshCw : WifiOff} tone="error" level={2}
          title={load.busy ? 'Demasiadas consultas seguidas' : 'No se pudo leer la biblioteca común'}
          text={load.busy ? 'Espera un momento y vuelve a intentarlo.' : 'Comprueba tu conexión y vuelve a intentarlo. Tus rutas guardadas siguen en este dispositivo.'}
          action={<button type="button" className="btn btn--secondary" onClick={retry}><RefreshCw className="ic" aria-hidden="true" />Reintentar</button>}
        />
      ) : null}
      {load.state === 'ready' ? (
        <>
          <p className="lib-count" role="status" aria-live="polite">
            {load.catalog.routes.length === 0 ? 'Sin rutas en esta zona' : items.length === load.catalog.routes.length
              ? `${formatCount(items.length)} ${items.length === 1 ? 'ruta' : 'rutas'}`
              : `${formatCount(items.length)} de ${formatCount(load.catalog.routes.length)} rutas`}
            {load.catalog.total > load.catalog.routes.length ? ` · las ${formatCount(load.catalog.routes.length)} más cercanas de ${formatCount(load.catalog.total)}` : ''}
          </p>
          {items.length > 0 ? (
            <ul className="lib-grid" aria-label="Rutas de la biblioteca común">
              {items.map(({ route, awayM }) => <li key={route.id}><CatalogCard route={route} awayM={awayM} saved={savedUrls.has(route.url)} onOpen={() => setOpenId(route.id)} /></li>)}
            </ul>
          ) : load.catalog.routes.length === 0 ? (
            <StateView icon={RouteIcon} level={2} title="Aún no hay rutas cerca" text={radiusKm < 150 ? 'Prueba con un radio mayor.' : 'No hay rutas compartidas a menos de 150 km de tu inicio.'}
              action={radiusKm < 150 ? <button type="button" className="btn btn--secondary" onClick={() => setRadiusKm(150)}>Buscar a 150 km</button> : undefined} />
          ) : (
            <StateView icon={ListFilter} level={2} title="Ninguna ruta cumple los filtros" text="Quita algún filtro o amplía los rangos de distancia y desnivel."
              action={<button type="button" className="btn btn--secondary" onClick={reset}>Quitar filtros</button>} />
          )}
        </>
      ) : null}

      <FilterSheet open={sheetOpen && !desktop} onClose={() => setSheetOpen(false)} count={items.length} onReset={reset}>{controls}</FilterSheet>
      <CatalogDetail route={open} onClose={() => setOpenId(null)} account={account} saved={open ? savedUrls.has(open.url) : false} onSaved={onSaved} />
    </div>
  );
}
