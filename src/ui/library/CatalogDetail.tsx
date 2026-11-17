import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Account } from '../../auth/AccountBoundary';
import type { LatLng, TrackPoint } from '../../domain/types';
import type { CatalogRoute, LibraryDetail } from '../../routes/library/catalog';
import { terrainFeel } from '../../routes/library/catalogView';
import { toParsedReference } from '../../routes/library/generate';
import { REFERENCE_ROUTE_GEOMETRY_NOTICE, RouteLibraryError, saveAdaptedRoute, type ReferenceRoute } from '../../routes/library';
import { findLibraryRoute } from '../../routes/sources/client';
import type { ProfilePoint } from '../../metrics/climbs';
import { Banner } from '../components/Banner';
import { Chip } from '../components/Chip';
import { ElevationProfile } from '../components/ElevationProfile';
import { RideMap } from '../components/RideMap';
import { Sheet } from '../components/Sheet';
import { Skeleton } from '../components/Skeleton';
import { downloadText } from '../routes/sendGpx';
import { formatKm, formatMeters } from '../format';
import { Download, Folder } from '../icons';
import { OriginLink } from './CatalogCard';

/** Rutas ya descargadas en esta sesión, por id. */
const cache = new Map<string, LibraryDetail>();
export const clearDetailCache = () => cache.clear();

type Load = { state: 'loading' } | { state: 'ready'; detail: LibraryDetail } | { state: 'error'; missing: boolean };

function useRouteDetail(id: string | null, account: Account) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // supabase-js crea un cliente de funciones nuevo en cada lectura: se lee al llamar, no como dependencia.
  const clientRef = useRef(account.client);
  clientRef.current = account.client;
  useEffect(() => {
    if (!id) return;
    const hit = cache.get(id);
    if (hit) { setLoad({ state: 'ready', detail: hit }); return; }
    const controller = new AbortController();
    setLoad({ state: 'loading' });
    findLibraryRoute(id, clientRef.current.functions, controller.signal)
      .then(detail => { cache.set(id, detail); setLoad({ state: 'ready', detail }); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setLoad({ state: 'error', missing: e instanceof Error && e.message === 'not_found' }); });
    return () => controller.abort();
  }, [id, attempt]);
  return { load, retry: () => setAttempt(n => n + 1) };
}

type Props = {
  /** La ruta abierta (con los datos del catálogo) o `null` con la hoja cerrada. */
  route: CatalogRoute | null;
  onClose: () => void;
  account: Account;
  saved: boolean;
  onSaved: (route: ReferenceRoute) => void;
};

/** Detalle de una ruta de la biblioteca común: mapa, perfil, cifras, origen y las acciones que ya tiene la app. */
export function CatalogDetail({ route, onClose, account, saved, onSaved }: Props) {
  // El último nombre se conserva mientras la hoja baja.
  const [shown, setShown] = useState(route);
  useEffect(() => { if (route) setShown(route); }, [route]);
  const current = route ?? shown;
  return (
    <Sheet open={route !== null} onClose={onClose} title={current?.name || 'Ruta sin nombre'} sub={current ? <OriginLink route={current} /> : undefined} className="lib-sheet lib-detail">
      {current ? <DetailBody key={current.id} route={current} account={account} saved={saved} onSaved={onSaved} /> : null}
    </Sheet>
  );
}

function DetailBody({ route, account, saved, onSaved }: { route: CatalogRoute; account: Account; saved: boolean; onSaved: (route: ReferenceRoute) => void }) {
  const { load, retry } = useRouteDetail(route.id, account);
  const [cursor, setCursor] = useState<LatLng | null>(null);
  const onCursor = useCallback((p: ProfilePoint | null) => setCursor(p ? { lat: p.lat, lng: p.lng } : null), []);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const detail = load.state === 'ready' ? load.detail : null;

  const points = useMemo<LatLng[]>(() => detail ? detail.line.map(([lng, lat]) => ({ lat, lng })) : [], [detail]);
  const track = useMemo<TrackPoint[]>(() => detail && detail.line.every(p => p.length === 3) ? detail.line.map(([lng, lat, ele], t) => ({ t, lat, lng, ele })) : [], [detail]);
  const parsed = useMemo(() => detail ? toParsedReference({ ...detail, passM: 0 }) : null, [detail]);
  const terrain = terrainFeel(route);

  async function save() {
    if (!parsed || busy) return;
    setBusy(true); setNote(null);
    try {
      const stored = await saveAdaptedRoute(parsed, parsed.points, { name: parsed.name, sourceUrl: parsed.sourceUrl, author: parsed.author });
      setJustSaved(true); onSaved(stored); setNote({ tone: 'info', text: 'Guardada en Mis rutas, con su enlace de origen.' });
    } catch (e) {
      setNote({ tone: 'error', text: e instanceof RouteLibraryError ? e.message : 'No se pudo guardar la ruta. Inténtalo de nuevo.' });
    } finally { setBusy(false); }
  }
  function download() {
    if (!parsed) return;
    setNote(downloadText(parsed.originalXml, parsed.sourceFileName) ? { tone: 'info', text: 'GPX descargado.' } : { tone: 'error', text: 'Este navegador no deja descargar el GPX.' });
  }

  return (
    <div className="lib-detail-body">
      {detail ? <RideMap className="lib-map" points={points} label={`Mapa de ${route.name || 'la ruta'}`} cursor={cursor} interactive /> : <div className="lib-map"><Skeleton variant="box" height="100%" /></div>}
      {load.state === 'error' ? (
        <Banner tone="error" action={load.missing ? undefined : <button type="button" className="btn btn--ghost" onClick={retry}>Reintentar</button>}>
          <b>{load.missing ? 'Esta ruta ya no está en la biblioteca.' : 'No se pudo cargar el recorrido.'}</b> {load.missing ? 'Cierra la ficha y vuelve a la lista.' : 'Comprueba tu conexión.'}
        </Banner>
      ) : null}
      <dl className="library-metrics">
        <div><dt>Distancia</dt><dd>{formatKm(route.distanceM, 1)}</dd></div>
        <div><dt>Desnivel</dt><dd>{route.elevGainM === null ? 'Sin altitud' : formatMeters(route.elevGainM)}</dd></div>
        <div><dt>Trazado</dt><dd>{route.loop ? 'Circular' : 'Lineal'}</dd></div>
      </dl>
      {terrain || route.unpavedPct !== null ? (
        <div className="cluster">
          {terrain ? <Chip>{terrain}</Chip> : null}
          {route.unpavedPct !== null ? <Chip>{route.unpavedPct < 1 ? 'Asfalto' : `${Math.round(route.unpavedPct)} % sin asfaltar`}</Chip> : null}
        </div>
      ) : null}
      {detail && track.length >= 2 ? <ElevationProfile points={track} onCursor={onCursor} heading={<h3 className="section-title">Perfil</h3>} /> : null}
      {load.state === 'loading' ? <Skeleton variant="box" height={96} /> : null}
      {note ? <p className={note.tone === 'error' ? 'library-error' : 'library-notice'} role={note.tone === 'error' ? 'alert' : 'status'}>{note.text}</p> : null}
      <div className="lib-actions">
        <button type="button" className="btn btn--primary btn--block" disabled={!parsed || busy || saved || justSaved} onClick={() => void save()}>
          <Folder className="ic" aria-hidden="true" />{saved || justSaved ? 'Ya está en Mis rutas' : 'Guardar en Mis rutas'}
        </button>
        <button type="button" className="btn btn--secondary btn--block" disabled={!parsed} onClick={download}>
          <Download className="ic" aria-hidden="true" />Descargar GPX
        </button>
      </div>
      <p className="meta">{REFERENCE_ROUTE_GEOMETRY_NOTICE}</p>
    </div>
  );
}
