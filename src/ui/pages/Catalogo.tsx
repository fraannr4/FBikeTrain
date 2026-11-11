import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { isAbort } from '../../ai/abort';
import { useAccount } from '../../auth/AccountBoundary';
import type { LatLng, Settings } from '../../domain/types';
import { adaptRoute, type AdaptedRoute } from '../../routes/adapt';
import { loadOsmCatalog, type CatalogProgress } from '../../routes/catalog/load';
import { OsmCatalogError } from '../../routes/catalog/osm';
import { recommendFromCatalog, type Proposal, type RecommendUpdate } from '../../routes/catalog/recommend';
import {
  importReferenceRoutes, listReferenceRoutes, parseReferenceRoute, saveCatalogRoutes, RouteLibraryError, type ParsedReferenceRoute, type ReferenceRoute,
} from '../../routes/library';
import { OrsError } from '../../routes/ors';
import { RwgpsError } from '../../routes/sources/ridewithgps';
import { clearRwgpsCredentials, loadRwgpsCredentials, saveRwgpsCredentials } from '../../routes/sources/rwgpsCredentials';
import {
  createRwgpsToken, fetchRwgpsRoutes, parseRwgpsLinks, RWGPS_API_CLIENTS_URL, RWGPS_FIND_URL, RWGPS_UNAUTHORIZED, type RwgpsLink,
} from '../../routes/sources/rwgpsImport';
import { chooseOrsAccess, sharedOrsEnabled } from '../../routes/orsProxy';
import { isWikilocUrl } from '../../routes/wikilocLimits';
import { clearLegacyWikilocRows, loadWikilocRequest, saveWikilocRequest, wikilocSearchUrl } from '../../routes/wikilocNearby';
import { loadSettings, saveSettings } from '../../settings/settings';
import { CyclingLoader } from '../components/CyclingLoader';
import { Field } from '../components/Field';
import { Page } from '../components/Page';
import { StateView } from '../components/StateView';
import { useToast } from '../components/Toast';
import { formatCount } from '../format';
import { CircleAlert, ExternalLink, KeyRound, MapIcon, RefreshCw, Route, SlidersHorizontal, Upload } from '../icons';
import { ProposalCard } from '../routes/ProposalCard';
import { StartChoice, startPoint, type PickedPoints, type StartKind } from '../routes/StartChoice';
import '../styles/library.css';
import '../styles/wikiloc.css';

const DISTANCE_ID = 'cat-distancia';
const MIN_KM = 1;
const MAX_KM = 1000;
const MAX_GAIN_M = 20_000;
const DISTANCE_ERROR = `Escribe la distancia en km, entre ${formatCount(MIN_KM)} y ${formatCount(MAX_KM)}.`;
const GAIN_ERROR = `El desnivel va en metros, entre 0 y ${formatCount(MAX_GAIN_M)}.`;
const UNEXPECTED = 'Ha fallado algo inesperado. Vuelve a probar.';

const routesWord = (n: number) => (n === 1 ? '1 ruta' : `${formatCount(n)} rutas`);

/** Cifra escrita con coma o punto; `null` si está vacía o no es un número. */
function parseFigure(text: string): number | null {
  const raw = text.trim().replace(/\s/g, '');
  const t = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const samePoint = (a: LatLng | null, b: LatLng) => !!a && a.lat === b.lat && a.lng === b.lng;

function progressText(p: CatalogProgress): string {
  if (p.step === 'osm') return 'Buscando rutas ciclistas en OpenStreetMap…';
  if (p.step === 'elevation') return `Estimando el desnivel: ${formatCount(p.done + 1)} de ${formatCount(p.total)}…`;
  return `Calculando subidas a puertos: ${formatCount(p.done + 1)} de ${formatCount(p.total)}…`;
}

type Search =
  | { state: 'running'; status: string; proposals: Proposal[] }
  | { state: 'done'; proposals: Proposal[]; candidates: number; rejected: number }
  | { state: 'error'; message: string; proposals: Proposal[] };
type UploadState = { state: 'adapting'; name: string } | { state: 'ready'; original: ParsedReferenceRoute; adapted: AdaptedRoute } | { state: 'error'; message: string };

/**
 * «Rutas de tu catálogo»: rutas reales de la zona (OpenStreetMap, puertos) y las que sube el usuario,
 * ordenadas por los km y el desnivel pedidos y adaptadas para salir y volver a su inicio.
 * La app nunca accede a wikiloc.com: «Buscar en Wikiloc» abre una pestaña del usuario.
 */
export function Catalogo() {
  const account = useAccount();
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [routes, setRoutes] = useState<ReferenceRoute[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [distanceText, setDistanceText] = useState('');
  const [gainText, setGainText] = useState('');
  const [kind, setKind] = useState<StartKind>('casa');
  const [points, setPoints] = useState<PickedPoints>({ aqui: null, mapa: null });
  const [checked, setChecked] = useState(false);
  const [search, setSearch] = useState<Search | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [rwgps, setRwgps] = useState<{ apiKey: string; authToken: string } | null>(null);
  const [rwgpsForm, setRwgpsForm] = useState({ apiKey: '', email: '', password: '' });
  const [rwgpsLinks, setRwgpsLinks] = useState('');
  const [rwgpsBusy, setRwgpsBusy] = useState<string | null>(null);
  const [rwgpsError, setRwgpsError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    setLoadFailed(false);
    void loadRwgpsCredentials().then((c) => alive && setRwgps(c)).catch(() => undefined);
    void clearLegacyWikilocRows().catch(() => undefined);
    Promise.all([loadSettings(), listReferenceRoutes(), loadWikilocRequest()])
      .then(([s, list, request]) => {
        if (!alive) return;
        setSettings(s);
        setRoutes(list);
        if (request) {
          setDistanceText(String(request.distanceKm).replace('.', ','));
          setGainText(request.elevGainM === null ? '' : String(request.elevGainM));
          if (samePoint(s.home, request.start)) setKind('casa');
          else {
            setKind('mapa');
            setPoints((p) => ({ ...p, mapa: request.start }));
          }
        } else setKind(s.home ? 'casa' : 'mapa');
      })
      .catch(() => alive && setLoadFailed(true));
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => () => abort.current?.abort(), []);

  const home = settings?.home ?? null;
  const start = startPoint(kind, home, points);
  const distance = parseFigure(distanceText);
  const gain = parseFigure(gainText);
  const distanceOk = distance !== null && distance >= MIN_KM && distance <= MAX_KM;
  const gainOk = gainText.trim() === '' || (gain !== null && gain >= 0 && gain <= MAX_GAIN_M);
  const distanceError = (checked || distanceText.trim() !== '') && !distanceOk ? DISTANCE_ERROR : undefined;
  const gainError = gainOk ? undefined : GAIN_ERROR;
  const hasKey = !!settings && ((sharedOrsEnabled() && account !== null) || settings.ors.apiKey.trim() !== '');
  const ors = useMemo(() => (settings ? chooseOrsAccess(settings.ors.apiKey, account) : null), [settings, account]);
  const busy = loading !== null || importing || rwgpsBusy !== null || search?.state === 'running' || upload?.state === 'adapting';

  const counts = useMemo(() => {
    const list = routes ?? [];
    const osm = list.filter((r) => r.catalog?.kind === 'osm').length;
    const passes = list.filter((r) => r.catalog?.kind === 'puerto').length;
    const rwgpsCount = list.filter((r) => r.catalog?.kind === 'rwgps').length;
    return { total: list.length, osm, passes, rwgps: rwgpsCount, own: list.length - osm - passes - rwgpsCount };
  }, [routes]);

  const refreshRoutes = async () => setRoutes(await listReferenceRoutes());

  /** Comprueba la petición y la guarda. `null` si falta algo, y lo dice. */
  const request = async () => {
    setChecked(true);
    if (!distanceOk || !gainOk || distance === null) {
      document.getElementById(DISTANCE_ID)?.focus();
      return null;
    }
    if (!start) {
      toast(kind === 'aqui' ? 'Falta tu ubicación.' : 'Elige el inicio en el mapa.', { tone: 'error' });
      return null;
    }
    const req = { distanceKm: distance, elevGainM: gainText.trim() === '' ? null : gain, start };
    await saveWikilocRequest(req).catch(() => undefined);
    return req;
  };

  const newController = () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    return controller;
  };

  const propose = async () => {
    if (busy || !routes || !ors || !hasKey) return;
    const req = await request();
    if (!req) return;
    const controller = newController();
    const shown: Proposal[] = [];
    setSearch({ state: 'running', status: 'Buscando en tu catálogo…', proposals: [] });
    const onUpdate = (u: RecommendUpdate) => {
      if (controller.signal.aborted) return;
      if (u.kind === 'proposal') shown.push(u.proposal);
      const status = u.kind === 'trying'
        ? `Adaptando «${u.route.name}» (${u.attempt} de ${u.total})…`
        : u.kind === 'waiting'
          ? `El motor de rutas admite pocas consultas por minuto. Sigo en ${u.seconds} s…`
          : `${shown.length} de 3 listas. Buscando la siguiente…`;
      setSearch({ state: 'running', status, proposals: [...shown] });
    };
    try {
      const result = await recommendFromCatalog(routes, req, { ors, signal: controller.signal, onUpdate });
      if (!controller.signal.aborted) setSearch({ state: 'done', proposals: result.proposals, candidates: result.candidates, rejected: result.rejected.length });
    } catch (e) {
      if (isAbort(e) || controller.signal.aborted) return;
      setSearch({ state: 'error', message: e instanceof OrsError ? e.message : UNEXPECTED, proposals: [...shown] });
    }
  };

  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setSearch((s) => (s?.state === 'running' ? { state: 'done', proposals: s.proposals, candidates: 0, rejected: 0 } : s));
    setLoading(null);
    setRwgpsBusy(null);
  };

  const preload = async () => {
    if (busy || !settings) return;
    const centre = start ?? home;
    if (!centre) {
      toast('Elige primero tu inicio: el catálogo se carga alrededor de él.', { tone: 'error' });
      return;
    }
    const controller = newController();
    setLoading('Buscando rutas ciclistas en OpenStreetMap…');
    try {
      const result = await loadOsmCatalog(centre, {
        ors: hasKey ? ors : null, signal: controller.signal, onProgress: (p) => !controller.signal.aborted && setLoading(progressText(p)),
      });
      await refreshRoutes();
      const parts = [`${routesWord(result.osm)} de OpenStreetMap`];
      if (result.passes) parts.push(`${result.passes === 1 ? '1 subida' : `${formatCount(result.passes)} subidas`} a puertos`);
      toast(`Catálogo cargado: ${parts.join(' y ')}.`, { tone: 'good' });
      if (result.withoutElevation) toast(`${routesWord(result.withoutElevation)} sin desnivel: el modelo de terreno no ha respondido.`, { tone: 'info' });
    } catch (e) {
      if (isAbort(e) || controller.signal.aborted) return;
      toast(e instanceof OsmCatalogError ? e.message : 'No se ha podido guardar el catálogo. Vuelve a probar.', { tone: 'error' });
    } finally {
      if (abort.current === controller) abort.current = null;
      setLoading(null);
    }
  };

  const importFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length || busy) return;
    setImporting(true);
    try {
      const { imported, failed } = await importReferenceRoutes(files);
      await refreshRoutes();
      toast(`${routesWord(imported.length)} ${imported.length === 1 ? 'importada' : 'importadas'} al catálogo.`, { tone: imported.length ? 'good' : 'info' });
      if (failed.length) toast(`${failed.length === 1 ? '1 fichero' : `${formatCount(failed.length)} ficheros`} sin importar. Primero: ${failed[0].name}: ${failed[0].message}`, { tone: 'error' });
    } catch {
      toast('No se han podido importar las rutas. Vuelve a probar.', { tone: 'error' });
    } finally {
      setImporting(false);
    }
  };

  // La pestaña se abre en el mismo gesto del usuario: si no, el navegador la bloquea.
  const openWikiloc = () => {
    const centre = start ?? home;
    if (!centre) {
      toast('Elige primero tu inicio.', { tone: 'error' });
      return;
    }
    const url = wikilocSearchUrl(centre);
    if (isWikilocUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const adaptUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy || !ors) return;
    const req = await request();
    if (!req) return;
    const controller = newController();
    setUpload({ state: 'adapting', name: file.name });
    try {
      const original = parseReferenceRoute(await file.text(), file.name);
      const adapted = await adaptRoute(
        original.points,
        { start: req.start, mode: 'mi-inicio', targetKm: req.distanceKm, ...(req.elevGainM !== null ? { targetGainM: req.elevGainM } : {}) },
        { ors, signal: controller.signal },
      );
      if (!controller.signal.aborted) setUpload({ state: 'ready', original, adapted });
    } catch (err) {
      if (isAbort(err) || controller.signal.aborted) return;
      const message = err instanceof RouteLibraryError || err instanceof OrsError || err instanceof RangeError ? err.message : 'El fichero no es un GPX o TCX válido.';
      setUpload({ state: 'error', message });
    }
  };

  const connectRwgps = async (e: FormEvent) => {
    e.preventDefault();
    if (rwgpsBusy) return;
    setRwgpsBusy('Conectando con Ride with GPS…');
    setRwgpsError(null);
    try {
      const authToken = await createRwgpsToken(rwgpsForm.apiKey, rwgpsForm.email, rwgpsForm.password);
      const credentials = { apiKey: rwgpsForm.apiKey.trim(), authToken };
      await saveRwgpsCredentials(credentials);
      setRwgps(credentials);
      setRwgpsForm({ apiKey: '', email: '', password: '' });
      toast('Ride with GPS conectado', { tone: 'good' });
    } catch (err) {
      setRwgpsError(err instanceof RwgpsError ? err.message : UNEXPECTED);
    } finally {
      setRwgpsForm((f) => ({ ...f, password: '' }));
      setRwgpsBusy(null);
    }
  };

  const disconnectRwgps = async () => {
    await clearRwgpsCredentials().catch(() => undefined);
    setRwgps(null);
    toast('Ride with GPS desconectado', { tone: 'info' });
  };

  /** Descarga por la API de Ride with GPS las rutas enlazadas y las guarda en el catálogo. */
  const importRwgps = async (links: RwgpsLink[]) => {
    if (!rwgps || busy || links.length === 0) return;
    const controller = newController();
    setRwgpsError(null);
    setRwgpsBusy('Leyendo Ride with GPS…');
    try {
      const { routes: found, failed } = await fetchRwgpsRoutes(links, rwgps, {
        signal: controller.signal,
        onProgress: (p) => !controller.signal.aborted && setRwgpsBusy(`Descargando rutas de Ride with GPS: ${formatCount(p.done + 1)} de ${formatCount(p.total)}…`),
      });
      if (found.length) {
        await saveCatalogRoutes(found.map((r) => ({
          name: r.name, points: r.points, sourceUrl: r.sourceUrl, author: `${r.author} en Ride with GPS`,
          catalog: { kind: 'rwgps' as const, ref: `rwgps-${r.id}`, tipo: 'carretera' as const },
        })));
        await refreshRoutes();
        setRwgpsLinks('');
      }
      toast(`${routesWord(found.length)} de Ride with GPS en el catálogo.`, { tone: found.length ? 'good' : 'info' });
      if (failed.length) {
        const first = failed.slice(0, 3).map((f) => `${f.ref} (${f.message})`).join('; ');
        setRwgpsError(`${failed.length === 1 ? '1 sin importar' : `${formatCount(failed.length)} sin importar`}: ${first}${failed.length > 3 ? '…' : ''}`);
      }
    } catch (err) {
      if (isAbort(err) || controller.signal.aborted) return;
      if (err instanceof RwgpsError && err.message === RWGPS_UNAUTHORIZED) {
        await clearRwgpsCredentials().catch(() => undefined);
        setRwgps(null);
      }
      setRwgpsError(err instanceof RwgpsError ? err.message : UNEXPECTED);
    } finally {
      if (abort.current === controller) abort.current = null;
      setRwgpsBusy(null);
    }
  };

  const importRwgpsText = () => {
    const { links, invalid } = parseRwgpsLinks(rwgpsLinks);
    if (links.length === 0) {
      setRwgpsError('Pega enlaces de rutas (ridewithgps.com/routes/…) o de colecciones (ridewithgps.com/collections/…).');
      return;
    }
    if (invalid.length) toast(`${invalid.length === 1 ? '1 texto no es un enlace' : `${formatCount(invalid.length)} textos no son enlaces`} de Ride with GPS: se ignora${invalid.length === 1 ? '' : 'n'}.`, { tone: 'info' });
    void importRwgps(links);
  };

  const saveHome = async (p: LatLng) => {
    try {
      const next = { ...(await loadSettings()), home: p };
      await saveSettings(next);
      setSettings(next);
      setKind('casa');
      toast('Casa guardada', { tone: 'good' });
    } catch {
      toast('No se ha podido guardar Casa. Vuelve a probar.', { tone: 'error' });
    }
  };

  const ready = settings && routes;
  return (
    <Page
      title="Rutas de tu catálogo"
      back="/rutas"
      variant="narrow"
      className="page--wikiloc page--catalogo"
      busy={!ready && !loadFailed}
      lead="Rutas reales de tu zona y las que subes tú. Pide km y desnivel: te propongo 3 que salen y vuelven a tu inicio."
    >
      {loadFailed ? (
        <section className="section card">
          <StateView
            icon={CircleAlert}
            tone="error"
            level={2}
            title="No se han podido leer tus datos"
            text="El almacenamiento del navegador no responde."
            action={
              <button type="button" className="btn btn--secondary" onClick={() => setAttempt((n) => n + 1)}>
                <RefreshCw className="ic" aria-hidden="true" />
                Reintentar
              </button>
            }
          />
        </section>
      ) : null}

      {ready ? (
        <section className="section card library-panel" aria-labelledby="cat-hoy">
          <h2 className="card-title" id="cat-hoy">
            ¿Qué quieres hacer hoy?
          </h2>
          <div className="wk-figures">
            <Field id={DISTANCE_ID} label="Distancia" inputMode="decimal" suffix="km" required value={distanceText} error={distanceError} onChange={(e) => setDistanceText(e.target.value)} />
            <Field label="Desnivel (opcional)" inputMode="numeric" suffix="m" value={gainText} error={gainError} onChange={(e) => setGainText(e.target.value)} />
          </div>
          <StartChoice
            home={home}
            kind={kind}
            points={points}
            onKind={setKind}
            onPick={(k, p) => setPoints((ps) => ({ ...ps, [k]: p }))}
            onSaveHome={(p) => void saveHome(p)}
          />
          {!hasKey ? (
            <StateView
              icon={KeyRound}
              level={3}
              title="Falta tu clave de rutas"
              text="Para unir cada ruta con tu inicio hace falta OpenRouteService. Pega tu clave en Ajustes."
              action={
                <Link className="btn btn--secondary" to="/ajustes?abrir=claves">
                  <SlidersHorizontal className="ic" aria-hidden="true" />
                  Ir a Ajustes
                </Link>
              }
            />
          ) : counts.total === 0 ? (
            <p className="help">Tu catálogo está vacío. Cárgalo abajo con las rutas de OpenStreetMap o con tus GPX.</p>
          ) : (
            <button type="button" className="btn btn--primary btn--block" disabled={busy} onClick={() => void propose()}>
              <Route className="ic" aria-hidden="true" />
              Proponer 3 rutas
            </button>
          )}
        </section>
      ) : null}

      {search ? (
        <section className="section" aria-labelledby="cat-propuestas">
          <h2 className="section-title" id="cat-propuestas">
            Propuestas
          </h2>
          <div className="cat-list">
            {search.proposals.map((p) => (
              <ProposalCard
                key={p.route.id}
                source={{ name: p.route.name, original: p.route, sourceUrl: p.route.sourceUrl, author: p.route.author, estimated: p.route.elevation === 'dem' }}
                adapted={p.adapted}
                why={p.motivo}
              />
            ))}
          </div>
          {search.state === 'running' ? (
            <div className="card library-panel cat-status" role="status">
              <CyclingLoader compact />
              <p>{search.status}</p>
              <button type="button" className="btn btn--ghost" onClick={cancel}>
                Parar
              </button>
            </div>
          ) : search.state === 'error' ? (
            <p className="library-error" role="alert">
              {search.message}
            </p>
          ) : search.proposals.length < 3 ? (
            <p className="help" role="status">
              {search.candidates === 0
                ? 'Ninguna ruta del catálogo pasa cerca de tu inicio con una distancia entre la mitad y 1,6 veces lo pedido. Carga más rutas o cambia la distancia.'
                : `${search.proposals.length === 0 ? 'Ninguna' : `Solo ${search.proposals.length}`} de las ${formatCount(search.candidates)} candidatas se ha podido adaptar bien. Prueba otra distancia o carga más rutas.`}
            </p>
          ) : null}
        </section>
      ) : null}

      {ready ? (
        <section className="section card library-panel" aria-labelledby="cat-catalogo">
          <h2 className="card-title" id="cat-catalogo">
            Tu catálogo
          </h2>
          <p className="cat-count">
            {counts.total === 0
              ? 'Aún no hay rutas.'
              : `${routesWord(counts.total)}: ${formatCount(counts.osm)} de OpenStreetMap, ${formatCount(counts.passes)} a puertos, ${formatCount(counts.rwgps)} de Ride with GPS y ${formatCount(counts.own)} tuyas.`}
          </p>
          {loading ? (
            <div className="cat-status" role="status">
              <CyclingLoader compact />
              <p>{loading}</p>
              <button type="button" className="btn btn--ghost" onClick={cancel}>
                Parar
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn--secondary btn--block btn--wrap" disabled={busy} onClick={() => void preload()}>
              <MapIcon className="ic" aria-hidden="true" />
              {counts.osm ? 'Actualizar rutas de OpenStreetMap' : 'Cargar rutas de OpenStreetMap'}
            </button>
          )}
          <p className="help">
            Rutas ciclistas y de BTT señalizadas que pasan a menos de 15 km de tu inicio, y subidas a puertos cercanos. Se guardan solo en tu cuenta.
            Datos © OpenStreetMap contributors; desnivel estimado con el modelo de terreno de Open-Meteo.
          </p>
          <label className={`btn btn--secondary btn--block btn--wrap${busy ? ' is-disabled' : ''}`}>
            <Upload className="ic" aria-hidden="true" />
            {importing ? 'Importando…' : 'Importar GPX, TCX o ZIP'}
            <input className="sr-only" type="file" multiple accept=".gpx,.tcx,.zip,application/gpx+xml,application/vnd.garmin.tcx+xml,application/xml,text/xml,application/zip" aria-label="Importar GPX, TCX o ZIP" disabled={busy} onChange={(e) => void importFiles(e)} />
          </label>
          <p className="help">Elige muchos a la vez o un ZIP: hasta 200 rutas por vez. Las de Wikiloc, Komoot o amigos entran igual.</p>
        </section>
      ) : null}

      {ready ? (
        <section className="section card library-panel" aria-labelledby="cat-wikiloc">
          <h2 className="card-title" id="cat-wikiloc">
            Una ruta de Wikiloc
          </h2>
          <button type="button" className="btn btn--secondary btn--block btn--wrap" onClick={openWikiloc}>
            <ExternalLink className="ic" aria-hidden="true" />
            Buscar en Wikiloc
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </button>
          <label className={`btn btn--secondary btn--block btn--wrap${busy || !hasKey ? ' is-disabled' : ''}`}>
            <Upload className="ic" aria-hidden="true" />
            Subir el GPX descargado
            <input className="sr-only" type="file" accept=".gpx,.tcx,application/gpx+xml,application/vnd.garmin.tcx+xml,application/xml,text/xml" aria-label="Subir el GPX descargado" disabled={busy || !hasKey} onChange={(e) => void adaptUpload(e)} />
          </label>
          <p className="help">Se abre Wikiloc alrededor de tu inicio con bici de carretera. Descarga allí el GPX y súbelo: se adapta a tu distancia y sale de tu inicio.</p>
          {upload?.state === 'adapting' ? (
            <div className="cat-status" role="status">
              <CyclingLoader compact />
              <p>Adaptando «{upload.name}»…</p>
            </div>
          ) : upload?.state === 'error' ? (
            <p className="library-error" role="alert">
              {upload.message}
            </p>
          ) : null}
        </section>
      ) : null}
      {ready ? (
        <section className="section card library-panel" aria-labelledby="cat-rwgps">
          <h2 className="card-title" id="cat-rwgps">
            Rutas de Ride with GPS
          </h2>
          <a className="btn btn--secondary btn--block btn--wrap" href={RWGPS_FIND_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="ic" aria-hidden="true" />
            Buscar en Ride with GPS
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
          {rwgps ? (
            <>
              <div className="cat-field">
                <label className="cat-label" htmlFor="cat-rwgps-links">
                  Enlaces de rutas o colecciones
                </label>
                <textarea
                  id="cat-rwgps-links"
                  className="cat-links"
                  rows={4}
                  placeholder="https://ridewithgps.com/routes/…"
                  value={rwgpsLinks}
                  disabled={busy}
                  onChange={(e) => setRwgpsLinks(e.target.value)}
                />
              </div>
              <button type="button" className="btn btn--primary btn--block btn--wrap" disabled={busy || !rwgpsLinks.trim()} onClick={importRwgpsText}>
                <Upload className="ic" aria-hidden="true" />
                Añadir al catálogo
              </button>
              <button type="button" className="btn btn--secondary btn--block btn--wrap" disabled={busy} onClick={() => void importRwgps([{ kind: 'collection', id: 'pinned' }])}>
                <Route className="ic" aria-hidden="true" />
                Añadir mi colección fijada
              </button>
              <p className="help">
                Pega muchos enlaces a la vez, uno por línea, o el de una colección. Se descargan con tu cuenta por la API oficial y se adaptan como el resto del catálogo.
              </p>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void disconnectRwgps()}>
                Desconectar Ride with GPS
              </button>
            </>
          ) : (
            <form className="cat-rwgps-form" onSubmit={(e) => void connectRwgps(e)}>
              <p className="help">
                Conecta tu cuenta para descargar rutas por la API oficial. Crea una clave en{' '}
                <a href={RWGPS_API_CLIENTS_URL} target="_blank" rel="noopener noreferrer">
                  API clients de Ride with GPS<span className="sr-only"> (se abre en otra pestaña)</span>
                </a>
                . La contraseña solo se envía a Ride with GPS y no se guarda.
              </p>
              <Field label="Clave de API" autoComplete="off" value={rwgpsForm.apiKey} disabled={busy} onChange={(e) => setRwgpsForm((f) => ({ ...f, apiKey: e.target.value }))} />
              <Field label="Correo de Ride with GPS" type="email" autoComplete="username" value={rwgpsForm.email} disabled={busy} onChange={(e) => setRwgpsForm((f) => ({ ...f, email: e.target.value }))} />
              <Field label="Contraseña de Ride with GPS" type="password" autoComplete="current-password" value={rwgpsForm.password} disabled={busy} onChange={(e) => setRwgpsForm((f) => ({ ...f, password: e.target.value }))} />
              <button type="submit" className="btn btn--primary btn--block" disabled={busy || !rwgpsForm.apiKey.trim() || !rwgpsForm.email.trim() || !rwgpsForm.password}>
                Conectar Ride with GPS
              </button>
            </form>
          )}
          {rwgpsBusy ? (
            <div className="cat-status" role="status">
              <CyclingLoader compact />
              <p>{rwgpsBusy}</p>
              <button type="button" className="btn btn--ghost" onClick={cancel}>
                Parar
              </button>
            </div>
          ) : null}
          {rwgpsError ? (
            <p className="library-error" role="alert">
              {rwgpsError}
            </p>
          ) : null}
        </section>
      ) : null}
      {upload?.state === 'ready' ? (
        <section className="section" aria-label="Ruta subida">
          <ProposalCard
            headingLevel={2}
            source={{ name: upload.original.name, original: upload.original, sourceUrl: upload.original.sourceUrl, author: upload.original.author }}
            adapted={upload.adapted}
          />
        </section>
      ) : null}
    </Page>
  );
}
