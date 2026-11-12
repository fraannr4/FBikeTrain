import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { isAbort } from '../../ai/abort';
import { useAccount } from '../../auth/AccountBoundary';
import type { LatLng, Settings } from '../../domain/types';
import { adaptRoute, type AdaptedRoute } from '../../routes/adapt';
import type { Proposal } from '../../routes/catalog/recommend';
import { parseReferenceRoute, RouteLibraryError, type ParsedReferenceRoute } from '../../routes/library';
import { OrsError } from '../../routes/ors';
import { RwgpsError } from '../../routes/sources/ridewithgps';
import { clearLegacyRwgpsCredentials } from '../../routes/sources/rwgpsCredentials';
import type { RwgpsAccess } from '../../routes/sources/rwgpsImport';
import { MIN_PROPOSALS, proposeRwgpsRoutes, type RwgpsProposalResult, type RwgpsProposalUpdate } from '../../routes/sources/rwgpsProposals';
import { chooseOrsAccess, sessionToken, sharedOrsEnabled } from '../../routes/orsProxy';
import { isWikilocUrl } from '../../routes/wikilocLimits';
import { clearLegacyWikilocRows, loadWikilocRequest, saveWikilocRequest, wikilocSearchUrl } from '../../routes/wikilocNearby';
import { loadSettings, saveSettings } from '../../settings/settings';
import { CyclingLoader } from '../components/CyclingLoader';
import { Field } from '../components/Field';
import { Page } from '../components/Page';
import { StateView } from '../components/StateView';
import { useToast } from '../components/Toast';
import { formatCount } from '../format';
import { CircleAlert, ExternalLink, KeyRound, RefreshCw, Route, SlidersHorizontal, Upload } from '../icons';
import { ProposalCard } from '../routes/ProposalCard';
import { StartChoice, startPoint, type PickedPoints, type StartKind } from '../routes/StartChoice';
import '../styles/library.css';
import '../styles/wikiloc.css';

const DISTANCE_ID = 'cat-distancia';
const MIN_KM = 5;
const MAX_KM = 300;
const MAX_GAIN_M = 20_000;
const DISTANCE_ERROR = `Escribe la distancia en km, entre ${formatCount(MIN_KM)} y ${formatCount(MAX_KM)}.`;
const GAIN_ERROR = `El desnivel va en metros, entre 0 y ${formatCount(MAX_GAIN_M)}.`;
const UNEXPECTED = 'Ha fallado algo inesperado. Vuelve a probar.';

/** Cifra escrita con coma o punto; `null` si está vacía o no es un número. */
function parseFigure(text: string): number | null {
  const raw = text.trim().replace(/\s/g, '');
  const t = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const samePoint = (a: LatLng | null, b: LatLng) => !!a && a.lat === b.lat && a.lng === b.lng;

function statusText(u: RwgpsProposalUpdate, ready: number): string {
  if (u.kind === 'searching') return `Buscando rutas de Ride with GPS a menos de ${formatCount(u.radiusKm)} km de tu inicio…`;
  if (u.kind === 'trying') return `Adaptando «${u.name}» (${u.attempt} de ${u.total})…`;
  if (u.kind === 'waiting') return `El motor de rutas admite pocas consultas por minuto. Sigo en ${u.seconds} s…`;
  return `${ready === 1 ? '1 lista' : `${formatCount(ready)} listas`}. Buscando la siguiente…`;
}

/** Qué decir cuando la búsqueda acaba con menos de 5 propuestas. */
function shortfallText(r: RwgpsProposalResult): string {
  if (r.nearby === 0) {
    return 'Aún no hay rutas de Ride with GPS a menos de 30 km de tu inicio. Salen de la colección común de FBikeTrain, que crece con el tiempo: vuelve a probar más adelante o elige otro inicio.';
  }
  if (r.candidates === 0) {
    return `Hay ${r.nearby === 1 ? '1 ruta' : `${formatCount(r.nearby)} rutas`} cerca, pero ninguna tiene una distancia parecida a la pedida. Prueba otra distancia.`;
  }
  const n = r.proposals.length;
  return `${n === 0 ? 'Ninguna' : `Solo ${n}`} de las ${formatCount(r.candidates)} candidatas se ha podido adaptar bien. Prueba otra distancia u otro inicio.`;
}

type Search =
  | { state: 'running'; status: string; proposals: Proposal[] }
  | { state: 'done'; proposals: Proposal[]; result: RwgpsProposalResult | null }
  | { state: 'error'; message: string; proposals: Proposal[] };
type UploadState = { state: 'adapting'; name: string } | { state: 'ready'; original: ParsedReferenceRoute; adapted: AdaptedRoute } | { state: 'error'; message: string };

/**
 * «Rutas de Ride with GPS»: solo cuando el usuario lo pide, busca en la colección común las rutas de la
 * distancia pedida que pasan cerca de su inicio, elige al menos 5 en direcciones distintas y las adapta
 * para salir y volver a él. La app nunca accede a wikiloc.com: «Buscar en Wikiloc» abre una pestaña del usuario.
 */
export function Catalogo() {
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
    if (busy || !ors || !rwgps || !hasKey) return;
    const req = await request();
    if (!req) return;
    const controller = newController();
    const shown: Proposal[] = [];
    setSearch({ state: 'running', status: 'Buscando rutas de Ride with GPS…', proposals: [] });
    const onUpdate = (u: RwgpsProposalUpdate) => {
      if (controller.signal.aborted) return;
      if (u.kind === 'proposal') shown.push(u.proposal);
      setSearch({ state: 'running', status: statusText(u, shown.length), proposals: [...shown] });
    };
    try {
      const result = await proposeRwgpsRoutes(req, { rwgps, ors, signal: controller.signal, onUpdate });
      if (!controller.signal.aborted) setSearch({ state: 'done', proposals: result.proposals, result });
    } catch (e) {
      if (isAbort(e) || controller.signal.aborted) return;
      setSearch({ state: 'error', message: e instanceof OrsError || e instanceof RwgpsError ? e.message : UNEXPECTED, proposals: [...shown] });
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  };

  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setSearch((s) => (s?.state === 'running' ? { state: 'done', proposals: s.proposals, result: null } : s));
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

  return (
    <Page
      title="Rutas de Ride with GPS"
      back="/rutas"
      variant="narrow"
      className="page--wikiloc page--catalogo"
      busy={!settings && !loadFailed}
      lead="Pide km y desnivel: te propongo al menos 5 rutas de Ride with GPS en direcciones distintas, adaptadas para salir y volver a tu inicio."
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
          {!rwgps ? (
            <p className="help">Inicia sesión para buscar rutas de Ride with GPS: las lee la cuenta común de FBikeTrain.</p>
          ) : !hasKey ? (
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
          ) : (
            <button type="button" className="btn btn--primary btn--block" disabled={busy} onClick={() => void propose()}>
              <Route className="ic" aria-hidden="true" />
              Proponer rutas
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
                source={{ name: p.route.name, original: p.route, sourceUrl: p.route.sourceUrl, author: p.route.author }}
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
          ) : search.result && search.proposals.length < MIN_PROPOSALS ? (
            <p className="help" role="status">
              {shortfallText(search.result)}
            </p>
          ) : null}
        </section>
      ) : null}

      {settings ? (
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
