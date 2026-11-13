import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { isAbort } from '../../ai/abort';
import { createSharedWaypointPlanner } from '../../ai/sharedClient';
import { useAccount } from '../../auth/AccountBoundary';
import { listActivities, listClimbEfforts } from '../../db/repo';
import type { LatLng, Settings } from '../../domain/types';
import { computeReference } from '../../metrics/reference';
import { adaptRoute, type AdaptedRoute } from '../../routes/adapt';
import { loadVisitedCells } from '../../routes/history';
import { historyWaypoints } from '../../routes/historyWaypoints';
import { parseReferenceRoute, RouteLibraryError, type ParsedReferenceRoute } from '../../routes/library';
import { proposeNearbyRoutes, type NearbyCard as NearbyCardData, type NearbyUpdate } from '../../routes/nearby';
import { OrsError } from '../../routes/ors';
import { chooseOrsAccess, sessionToken, sharedOrsEnabled } from '../../routes/orsProxy';
import { findWaypoints } from '../../routes/sources/client';
import { RwgpsError } from '../../routes/sources/ridewithgps';
import { clearLegacyRwgpsCredentials } from '../../routes/sources/rwgpsCredentials';
import type { RwgpsAccess } from '../../routes/sources/rwgpsImport';
import { MIN_PROPOSALS } from '../../routes/sources/rwgpsProposals';
import { rwgpsExploreUrl } from '../../routes/sources/rwgpsExplore';
import { isWikilocUrl } from '../../routes/wikilocLimits';
import { clearLegacyWikilocRows, loadWikilocRequest, saveWikilocRequest, wikilocSearchUrl } from '../../routes/wikilocNearby';
import { loadSettings, saveSettings } from '../../settings/settings';
import { CyclingLoader } from '../components/CyclingLoader';
import { Field } from '../components/Field';
import { Page } from '../components/Page';
import { StateView } from '../components/StateView';
import { useToast } from '../components/Toast';
import { formatCount } from '../format';
import { ChevronDown, CircleAlert, ExternalLink, Info, KeyRound, RefreshCw, Route, SlidersHorizontal, Upload } from '../icons';
import { NearbyCard } from '../routes/NearbyCard';
import { ProposalCard } from '../routes/ProposalCard';
import { referenceRange } from '../routes/routeView';
import { StartChoice, startPoint, type PickedPoints, type StartKind } from '../routes/StartChoice';
import '../styles/library.css';
import '../styles/wikiloc.css';

const DISTANCE_ID = 'cerca-distancia';
const MIN_KM = 5;
const MAX_KM = 300;
const MAX_GAIN_M = 20_000;
const DISTANCE_ERROR = `Escribe la distancia en km, entre ${formatCount(MIN_KM)} y ${formatCount(MAX_KM)}.`;
const GAIN_ERROR = `El desnivel va en metros, entre 0 y ${formatCount(MAX_GAIN_M)}.`;
const UNEXPECTED = 'Ha fallado algo inesperado. Vuelve a probar.';
const FIRST_STATUS = 'Leyendo tu historial…';

/** Cifra escrita con coma o punto; `null` si está vacía o no es un número. */
function parseFigure(text: string): number | null {
  const raw = text.trim().replace(/\s/g, '');
  const t = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const samePoint = (a: LatLng | null, b: LatLng) => !!a && a.lat === b.lat && a.lng === b.lng;
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${formatCount(n)} ${many}`);
const waitingText = (s: number) => `Esperando ${formatCount(s)} s por el límite de consultas del motor de rutas…`;

/** Qué está haciendo la búsqueda; `null` si la actualización no cambia el texto. */
function statusText(u: NearbyUpdate, realReady: number): string | null {
  switch (u.kind) {
    case 'searching':
      return `Buscando rutas reales a ${formatCount(u.radiusKm)} km de tu inicio…`;
    case 'trying':
      return `Adaptando «${u.name}» (${u.attempt} de ${u.total})…`;
    case 'proposal':
      return `${plural(realReady, 'ruta real lista', 'rutas reales listas')}. Buscando más…`;
    case 'waypoints':
      return u.count > 0 ? `${plural(u.count, 'punto de paso', 'puntos de paso')} en la zona. Combinándolos…` : 'Sin puntos de paso en la zona. Probando vueltas circulares…';
    case 'engine':
      return `Probando ${formatCount(u.tried)} de ${formatCount(u.budget)}…`;
    default:
      return null;
  }
}

const cardKey = (c: NearbyCardData) => (c.kind === 'real' ? c.proposal.route.id : `${c.combo}-${c.route.id}`);

type Search =
  | { state: 'running'; start: LatLng; status: string; cards: NearbyCardData[] }
  | { state: 'done'; start: LatLng; cards: NearbyCardData[]; warnings: string[] }
  | { state: 'error'; start: LatLng; message: string; cards: NearbyCardData[] };
type UploadState = { state: 'adapting'; name: string } | { state: 'ready'; original: ParsedReferenceRoute; adapted: AdaptedRoute } | { state: 'error'; message: string };

/**
 * «Rutas cerca»: solo cuando el usuario lo pide, propone al menos 5 vueltas de carretera desde su inicio,
 * primero las rutas reales de la colección común y después las del motor, que encadena puertos, cimas,
 * pueblos y tramos habituales. La app nunca accede a wikiloc.com: «Buscar en Wikiloc» abre una pestaña del usuario.
 */
export function RutasCerca() {
  const account = useAccount();
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [distanceText, setDistanceText] = useState('');
  const [gainText, setGainText] = useState('');
  const [kind, setKind] = useState<StartKind>('casa');
  const [points, setPoints] = useState<PickedPoints>({ aqui: null, mapa: null });
  const [checked, setChecked] = useState(false);
  const [search, setSearch] = useState<Search | null>(null);
  /** Segundos que faltan de la espera por el límite por minuto; `null` si no se espera. */
  const [waitLeft, setWaitLeft] = useState<number | null>(null);
  /** Consultas del motor hechas y previstas; `null` mientras se cargan los puntos de la zona. */
  const [progress, setProgress] = useState<{ tried: number; budget: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const running = search?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    setLoadFailed(false);
    void clearLegacyRwgpsCredentials().catch(() => undefined);
    void clearLegacyWikilocRows().catch(() => undefined);
    Promise.all([loadSettings(), loadWikilocRequest()])
      .then(([s, request]) => {
        if (!alive) return;
        setSettings(s);
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

  // Cuenta atrás de la espera: baja de segundo en segundo hasta 0.
  useEffect(() => {
    if (waitLeft === null || waitLeft <= 0) return;
    const t = setTimeout(() => setWaitLeft((s) => (s === null ? null : Math.max(0, s - 1))), 1000);
    return () => clearTimeout(t);
  }, [waitLeft]);

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
  const rwgps = useMemo<RwgpsAccess | null>(() => (account ? { getToken: sessionToken(account.client) } : null), [account]);
  const ai = useMemo(() => (account ? createSharedWaypointPlanner(sessionToken(account.client)) : null), [account]);
  const busy = search?.state === 'running' || upload?.state === 'adapting';

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
    if (busy || !ors || !rwgps || !account || !hasKey) return;
    const req = await request();
    if (!req) return;
    const controller = newController();
    const { signal } = controller;
    const accepted: NearbyCardData[] = [];
    let realReady = 0;
    let status = FIRST_STATUS;
    setWaitLeft(null);
    setProgress(null);
    setSearch({ state: 'running', start: req.start, status, cards: [] });
    const onUpdate = (u: NearbyUpdate) => {
      if (signal.aborted) return;
      if (u.kind === 'card') accepted.push(u.card);
      else if (u.kind === 'waiting') setWaitLeft(u.seconds);
      else {
        if (u.kind === 'proposal') realReady++;
        if (u.kind === 'engine') setProgress({ tried: u.tried, budget: u.budget });
        status = statusText(u, realReady) ?? status;
        setWaitLeft(null);
      }
      setSearch({ state: 'running', start: req.start, status, cards: [...accepted] });
    };
    try {
      // El historial (referencia, celdas visitadas y subidas) no sale nunca del navegador.
      const now = Date.now();
      const [visited, acts, climbs] = await Promise.all([
        loadVisitedCells().catch(() => new Set<string>()),
        listActivities(referenceRange(now)).catch(() => []),
        listClimbEfforts().catch(() => []),
      ]);
      signal.throwIfAborted();
      const functions = account.client.functions;
      const result = await proposeNearbyRoutes(req, {
        ors, rwgps, signal, onUpdate, ai,
        reference: computeReference(acts, now),
        visited,
        findWaypoints: (from, radiusM, s) => findWaypoints(from, radiusM, functions, s),
        historyWaypoints: (from, band, s) => historyWaypoints(from, band, { climbs, signal: s }),
      });
      if (!signal.aborted) setSearch({ state: 'done', start: req.start, cards: result.cards, warnings: result.warnings });
    } catch (e) {
      if (isAbort(e) || signal.aborted) return;
      setSearch({ state: 'error', start: req.start, message: e instanceof OrsError || e instanceof RwgpsError ? e.message : UNEXPECTED, cards: [...accepted] });
    } finally {
      if (abort.current === controller) abort.current = null;
      if (!signal.aborted) setWaitLeft(null);
    }
  };

  /** Corta al momento y deja las tarjetas ya aceptadas. */
  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setWaitLeft(null);
    setSearch((s) => (s?.state === 'running' ? { state: 'done', start: s.start, cards: s.cards, warnings: [] } : s));
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

  // Explore de Ride with GPS con zona, km y desnivel puestos. Solo se abre: la app nunca lo consulta.
  const openExplore = () => {
    const centre = start ?? home;
    if (!centre) {
      toast('Elige primero tu inicio.', { tone: 'error' });
      return;
    }
    if (distance === null || !Number.isFinite(distance) || distance <= 0) {
      toast('Escribe primero los km.', { tone: 'error' });
      return;
    }
    const elevGainM = gain !== null && Number.isFinite(gain) && gain > 0 ? gain : null;
    window.open(rwgpsExploreUrl({ start: centre, distanceKm: distance, elevGainM }), '_blank', 'noopener,noreferrer');
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

  const warnings = search?.state === 'done' ? search.warnings : [];
  return (
    <Page
      title="Rutas cerca"
      back="/rutas"
      variant="narrow"
      className="page--wikiloc page--cerca"
      busy={!settings && !loadFailed}
      lead="Al menos 5 vueltas de carretera desde donde salgas: primero rutas reales de la zona y después las del motor."
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

      {settings ? (
        <section className="section card library-panel" aria-label="Qué quieres hacer hoy">
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
          {!account ? (
            <p className="help">Inicia sesión para buscar rutas cerca: usan la colección común y los servicios de FBikeTrain.</p>
          ) : !hasKey ? (
            <StateView
              icon={KeyRound}
              level={3}
              title="Falta tu clave de rutas"
              text="Para calcular las vueltas hace falta OpenRouteService. Pega tu clave en Ajustes."
              action={
                <Link className="btn btn--secondary" to="/ajustes?abrir=claves">
                  <SlidersHorizontal className="ic" aria-hidden="true" />
                  Ir a Ajustes
                </Link>
              }
            />
          ) : (
            <button type="button" className="btn btn--primary btn--block" disabled={busy} onClick={() => void propose()}>
              <Route className="ic" aria-hidden="true" />
              Proponer rutas
            </button>
          )}
        </section>
      ) : null}

      {search ? (
        <section className="section" aria-labelledby="cerca-propuestas">
          <h2 className="section-title" id="cerca-propuestas">
            Propuestas
          </h2>
          <div className="cat-list">
            {search.cards.map((c) => (
              <NearbyCard key={cardKey(c)} card={c} start={search.start} />
            ))}
          </div>
          {search.state === 'running' ? (
            <div className="card library-panel cat-status" role="status" aria-label="Progreso de la búsqueda">
              <CyclingLoader compact />
              <p>{waitLeft !== null ? waitingText(waitLeft) : search.status}</p>
              <progress
                className="cat-progress"
                aria-label="Progreso de la búsqueda"
                {...(progress ? { max: progress.budget, value: progress.tried } : {})}
              />
              <p className="cat-elapsed">{`Llevas ${formatCount(elapsed)} s. Puede tardar hasta 4 minutos.`}</p>
              <button type="button" className="btn btn--secondary" onClick={cancel}>
                Cancelar
              </button>
            </div>
          ) : null}
          {search.state === 'error' ? (
            <p className="library-error" role="alert">
              {search.message}
            </p>
          ) : null}
          {warnings.length > 0 ? (
            <section className="card nb-notice" aria-label="Avisos de la búsqueda">
              <StateView
                icon={Info}
                title={search.cards.length < MIN_PROPOSALS ? 'Menos vueltas de las buscadas' : 'Para tener en cuenta'}
                text={warnings.map((w) => (
                  <span key={w} className="nb-warning">
                    {w}
                  </span>
                ))}
              />
            </section>
          ) : null}
        </section>
      ) : null}

      {settings ? (
        <details className="section disclosure nb-wikiloc">
          <summary>
            <ExternalLink className="ic nb-wikiloc-ic" aria-hidden="true" />
            <span className="nb-wikiloc-t">¿Buscas en Ride with GPS Explore?</span>
            <ChevronDown className="chev" aria-hidden="true" />
          </summary>
          <div className="disclosure-body">
            <button type="button" className="btn btn--secondary btn--block btn--wrap" onClick={openExplore}>
              <ExternalLink className="ic" aria-hidden="true" />
              Abrir Explore con tus filtros
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </button>
            <Link className="btn btn--secondary btn--block btn--wrap" to="/rutas/compartida">
              <Route className="ic" aria-hidden="true" />
              Pegar el enlace de una ruta
            </Link>
            <p className="help">Explore se abre alrededor de tu inicio, con tus km, tu desnivel y solo asfalto. Elige una ruta, compártela con FBikeTrain o copia su enlace: se adapta para salir y volver a tu inicio.</p>
          </div>
        </details>
      ) : null}

      {settings ? (
        <details className="section disclosure nb-wikiloc">
          <summary>
            <ExternalLink className="ic nb-wikiloc-ic" aria-hidden="true" />
            <span className="nb-wikiloc-t">¿Buscas en Wikiloc?</span>
            <ChevronDown className="chev" aria-hidden="true" />
          </summary>
          <div className="disclosure-body">
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
            ) : null}
            {upload?.state === 'error' ? (
              <p className="library-error" role="alert">
                {upload.message}
              </p>
            ) : null}
          </div>
        </details>
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
