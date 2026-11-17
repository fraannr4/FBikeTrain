import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { isAbort } from '../../ai/abort';
import { resolveReference } from '../../ai/levelSummary';
import { useAccount } from '../../auth/AccountBoundary';
import { listActivities } from '../../db/repo';
import type { LatLng, Settings } from '../../domain/types';
import { adaptRoute, type AdaptedRoute } from '../../routes/adapt';
import { loadVisitedCells } from '../../routes/history';
import { parseReferenceRoute, RouteLibraryError, type ParsedReferenceRoute } from '../../routes/library';
import {
  generateProposals,
  GENERATOR_ORS_BUDGET,
  MIN_PROPOSALS,
  SOURCE_NAMES,
  toParsedReference,
  type GeneratorCard,
  type GeneratorUpdate,
} from '../../routes/library/generate';
import { OrsError } from '../../routes/ors';
import { chooseOrsAccess, sharedOrsEnabled } from '../../routes/orsProxy';
import { findLibrary } from '../../routes/sources/client';
import { clearLegacyRwgpsCredentials } from '../../routes/sources/rwgpsCredentials';
import { RouteSourceError } from '../../routes/sources/schema';
import { rwgpsExploreUrl } from '../../routes/sources/rwgpsExplore';
import { isWikilocUrl } from '../../routes/wikilocLimits';
import { clearLegacyWikilocRows, loadWikilocRequest, saveWikilocRequest, wikilocSearchUrl } from '../../routes/wikilocNearby';
import { loadSettings, saveSettings } from '../../settings/settings';
import { CyclingLoader } from '../components/CyclingLoader';
import { Field } from '../components/Field';
import { List, ListRow } from '../components/ListRow';
import { Page } from '../components/Page';
import { StateView } from '../components/StateView';
import { useToast } from '../components/Toast';
import { formatCount } from '../format';
import { ChevronDown, CircleAlert, ExternalLink, Folder, Info, KeyRound, RefreshCw, Route, Share2, SlidersHorizontal, Upload } from '../icons';
import { NewRouteCard } from '../routes/NewRouteCard';
import { ProposalCard } from '../routes/ProposalCard';
import { RouteSearchOverlay } from '../routes/RouteSearchLoading';
import { referenceRange } from '../routes/routeView';
import { StartChoice, startPoint, type PickedPoints, type StartKind } from '../routes/StartChoice';
import { useRideWeather, WeatherRow } from '../routes/WeatherRow';
import type { HourForecast } from '../../weather/forecast';
import '../styles/library.css';
import '../styles/wikiloc.css';

const DISTANCE_ID = 'rutas-distancia';
const MIN_KM = 5;
const MAX_KM = 300;
const MAX_GAIN_M = 20_000;
const DISTANCE_ERROR = `Escribe la distancia en km, entre ${formatCount(MIN_KM)} y ${formatCount(MAX_KM)}.`;
const GAIN_ERROR = `El desnivel va en metros, entre 0 y ${formatCount(MAX_GAIN_M)}.`;
const UNEXPECTED = 'Ha fallado algo inesperado. Vuelve a probar.';
const LIBRARY_STATUS = 'Cargando las rutas de la zona…';
/** Sin respuesta de la biblioteca en este tiempo, la zona probablemente se está llenando desde Ride with GPS. */
const SLOW_LIBRARY_S = 8;
const SLOW_LIBRARY = 'Si la zona es nueva, la primera búsqueda tarda más: estamos buscando rutas en Ride with GPS.';

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
const waitingText = (s: number) => `Esperando ${formatCount(s)} s por el límite de consultas…`;

/** Qué está haciendo la búsqueda; `null` si la actualización no cambia el texto. */
function statusText(u: GeneratorUpdate): string | null {
  switch (u.kind) {
    case 'library':
      return LIBRARY_STATUS;
    case 'library-ready':
      return `${plural(u.routes, 'ruta', 'rutas')} y ${plural(u.cells, 'tramo', 'tramos')} en la zona. Montando vueltas…`;
    case 'trying':
      return `Probando ${formatCount(u.used)} de ${formatCount(u.budget)}…`;
    default:
      return null;
  }
}

function errorText(e: unknown): string {
  if (e instanceof OrsError) return e.message;
  if (e instanceof RouteSourceError) {
    return e.code === 'busy'
      ? 'La biblioteca de rutas está ocupada. Vuelve a probar en un minuto.'
      : 'No se ha podido cargar la biblioteca de rutas de la zona. Vuelve a probar.';
  }
  return UNEXPECTED;
}

/** «De la biblioteca · Ride with GPS · autora». */
function libraryOrigin(card: Extract<GeneratorCard, { kind: 'biblioteca' }>): string {
  return ['De la biblioteca', SOURCE_NAMES[card.route.source], card.route.author.trim()].filter(Boolean).join(' · ');
}

type Search =
  | { state: 'running'; n: number; start: LatLng; status: string; libraryReady: boolean; cards: GeneratorCard[] }
  | { state: 'done'; n: number; start: LatLng; cards: GeneratorCard[]; warnings: string[] }
  | { state: 'error'; n: number; start: LatLng; message: string; cards: GeneratorCard[] };
type UploadState = { state: 'adapting'; name: string } | { state: 'ready'; original: ParsedReferenceRoute; adapted: AdaptedRoute } | { state: 'error'; message: string };

function SearchCard({ card, start, weather }: { card: GeneratorCard; start: LatLng; weather: HourForecast | null }) {
  if (card.kind === 'nueva') return <NewRouteCard card={card} start={start} weather={weather} />;
  const source = toParsedReference(card.route);
  return (
    <ProposalCard
      origin={libraryOrigin(card)}
      source={{ name: source.name, original: source, sourceUrl: source.sourceUrl, author: source.author }}
      adapted={card.adapted}
      weather={weather}
    />
  );
}

/**
 * Rutas: solo cuando el usuario lo pide, propone de 3 a 5 vueltas de carretera desde su inicio. Primero
 * rutas reales de la biblioteca común adaptadas y después vueltas nuevas por los tramos más transitados.
 * Debajo, plegados, Explore de Ride with GPS y Wikiloc: la app solo abre su pestaña, nunca los consulta.
 */
export function Rutas() {
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
  /** Consultas a ORS hechas en esta búsqueda. */
  const [used, setUsed] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const abort = useRef<AbortController | null>(null);
  const searches = useRef(0);
  const running = search?.state === 'running';
  // El tiempo se pide con el inicio de la búsqueda (redondeado a ~1 km), no con Casa tal cual.
  const weather = useRideWeather(search?.start ?? null);

  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);

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
  const busy = running || upload?.state === 'adapting';

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
    if (busy || !ors || !account || !hasKey) return;
    const req = await request();
    if (!req) return;
    const controller = newController();
    const { signal } = controller;
    const n = ++searches.current;
    const accepted: GeneratorCard[] = [];
    let status = LIBRARY_STATUS;
    let libraryReady = false;
    setWaitLeft(null);
    setUsed(0);
    setSearch({ state: 'running', n, start: req.start, status, libraryReady, cards: [] });
    const onUpdate = (u: GeneratorUpdate) => {
      if (signal.aborted) return;
      if (u.kind === 'card') accepted.push(u.card);
      else if (u.kind === 'waiting') setWaitLeft(u.seconds);
      else {
        if (u.kind === 'library-ready') libraryReady = true;
        if (u.kind === 'trying') setUsed(u.used);
        status = statusText(u) ?? status;
        setWaitLeft(null);
      }
      setSearch({ state: 'running', n, start: req.start, status, libraryReady, cards: [...accepted] });
    };
    try {
      // El historial (referencia y celdas visitadas) no sale nunca del navegador.
      const now = Date.now();
      const [visited, reference] = await Promise.all([
        loadVisitedCells().catch(() => new Set<string>()),
        listActivities(referenceRange(now)).then((acts) => resolveReference(acts, now)).catch(() => null),
      ]);
      signal.throwIfAborted();
      const functions = account.client.functions;
      const result = await generateProposals(req, {
        ors, reference, visited, signal, onUpdate,
        library: (s, sig) => findLibrary(s, functions, sig),
      });
      if (!signal.aborted) setSearch({ state: 'done', n, start: req.start, cards: result.cards, warnings: result.warnings });
    } catch (e) {
      if (isAbort(e) || signal.aborted) return;
      setSearch({ state: 'error', n, start: req.start, message: errorText(e), cards: [...accepted] });
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
    setSearch((s) => (s?.state === 'running' ? { state: 'done', n: s.n, start: s.start, cards: s.cards, warnings: [] } : s));
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
      title="Rutas"
      variant="narrow"
      className="page--wikiloc page--cerca"
      busy={!settings && !loadFailed}
      lead="Elige inicio, km y, si quieres, desnivel. Te proponemos de 3 a 5 vueltas de carretera hechas con rutas reales de ciclistas de la zona."
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
              <button type="button" className="btn btn--secondary" onClick={() => setAttempt((a) => a + 1)}>
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
            <p className="help">Inicia sesión para proponer rutas: usan la biblioteca común de rutas y los servicios de FBikeTrain.</p>
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
        <section className="section" aria-labelledby="rutas-propuestas">
          <h2 className="section-title" id="rutas-propuestas">
            Propuestas
          </h2>
          <WeatherRow weather={weather} />
          <div className="cat-list">
            {search.cards.map((c) => (
              <SearchCard key={`${search.n}-${c.id}`} card={c} start={search.start} weather={weather.hour} />
            ))}
          </div>
          <RouteSearchOverlay
            open={search.state === 'running'}
            message={waitLeft !== null ? waitingText(waitLeft) : search.state === 'running' ? search.status : ''}
            elapsed={elapsed}
            used={used}
            budget={GENERATOR_ORS_BUDGET}
            found={search.cards.length}
            help={search.state === 'running' && !search.libraryReady && elapsed >= SLOW_LIBRARY_S ? SLOW_LIBRARY : undefined}
            onCancel={cancel}
          />
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

      <section className="section" aria-label="Más formas de conseguir una ruta">
        <List inset>
          <ListRow to="/rutas/biblioteca" icon={Folder} accent="dist" title="Biblioteca de rutas" meta="Tus rutas guardadas y los GPX que abras: analiza, recorta y exporta" />
          <ListRow to="/rutas/compartida" icon={Share2} accent="time" title="Ruta de Ride with GPS Explore" meta="Búscala en Explore, compártela con FBikeTrain o pega su enlace, y se adapta a tu inicio" />
        </List>
      </section>
    </Page>
  );
}
