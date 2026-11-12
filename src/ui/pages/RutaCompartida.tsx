import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isAbort } from '../../ai/abort';
import { useAccount } from '../../auth/AccountBoundary';
import type { LatLng, Settings } from '../../domain/types';
import type { Proposal } from '../../routes/catalog/recommend';
import { OrsError } from '../../routes/ors';
import { chooseOrsAccess, sessionToken, sharedOrsEnabled } from '../../routes/orsProxy';
import { RwgpsError } from '../../routes/sources/ridewithgps';
import { adaptRwgpsChoice, listRwgpsChoices, rwgpsExploreUrl, type RwgpsChoice } from '../../routes/sources/rwgpsExplore';
import { parseRwgpsLinks, type RwgpsAccess } from '../../routes/sources/rwgpsImport';
import { loadSettings, saveSettings } from '../../settings/settings';
import { CyclingLoader } from '../components/CyclingLoader';
import { Field } from '../components/Field';
import { Page } from '../components/Page';
import { StateView } from '../components/StateView';
import { useToast } from '../components/Toast';
import { formatCount } from '../format';
import { CircleAlert, ExternalLink, KeyRound, RefreshCw, Route, Share2, SlidersHorizontal } from '../icons';
import { ProposalCard } from '../routes/ProposalCard';
import { StartChoice, startPoint, type PickedPoints, type StartKind } from '../routes/StartChoice';
import '../styles/library.css';
import '../styles/wikiloc.css';
import '../styles/compartida.css';

const DISTANCE_ID = 'cmp-distancia';
const LINKS_ID = 'cmp-enlaces';
const MIN_KM = 5;
const MAX_KM = 300;
const MAX_GAIN_M = 20_000;
const DISTANCE_ERROR = `Escribe la distancia en km, entre ${formatCount(MIN_KM)} y ${formatCount(MAX_KM)}.`;
const GAIN_ERROR = `El desnivel va en metros, entre 0 y ${formatCount(MAX_GAIN_M)}.`;
const NO_LINKS = 'Pega un enlace de una ruta o colección de Ride with GPS (ridewithgps.com/routes/… o /collections/…).';
const UNEXPECTED = 'Ha fallado algo inesperado. Vuelve a probar.';

/** Cifra escrita con coma o punto; `null` si está vacía o no es un número. */
function parseFigure(text: string): number | null {
  const t = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const messageOf = (e: unknown) => (e instanceof RwgpsError || e instanceof OrsError || e instanceof RangeError ? e.message : UNEXPECTED);

type Work =
  | { state: 'listing' }
  | { state: 'adapting'; label: string; waitUntil: number | null }
  | { state: 'ready'; proposal: Proposal }
  | { state: 'error'; message: string };

/**
 * «Una ruta de Explore»: el usuario busca a mano en Ride with GPS Explore (se abre en su navegador con los
 * filtros puestos), comparte la ruta con FBikeTrain o pega su enlace, y la app la lee por id con la cuenta
 * común y la adapta para salir y volver a su inicio. La app nunca consulta Explore.
 */
export function RutaCompartida() {
  const account = useAccount();
  const toast = useToast();
  const [params] = useSearchParams();
  const received = params.get('enlaces');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [distanceText, setDistanceText] = useState('');
  const [gainText, setGainText] = useState('');
  const [linksText, setLinksText] = useState(received ?? '');
  const [kind, setKind] = useState<StartKind>('casa');
  const [points, setPoints] = useState<PickedPoints>({ aqui: null, mapa: null });
  const [checked, setChecked] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [choices, setChoices] = useState<{ items: RwgpsChoice[]; failed: string[] } | null>(null);
  const [work, setWork] = useState<Work | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const abort = useRef<AbortController | null>(null);

  // Un envío nuevo con la pantalla ya abierta sustituye a los enlaces del campo.
  useEffect(() => {
    if (received) setLinksText(received);
  }, [received]);

  useEffect(() => {
    let alive = true;
    setLoadFailed(false);
    loadSettings()
      .then((s) => {
        if (!alive) return;
        setSettings(s);
        setKind(s.home ? 'casa' : 'mapa');
      })
      .catch(() => alive && setLoadFailed(true));
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => () => abort.current?.abort(), []);

  const waitUntil = work?.state === 'adapting' ? work.waitUntil : null;
  useEffect(() => {
    if (waitUntil === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waitUntil]);

  const home = settings?.home ?? null;
  const start = startPoint(kind, home, points);
  const distance = parseFigure(distanceText);
  const gain = parseFigure(gainText);
  const distanceOk = distance !== null && distance >= MIN_KM && distance <= MAX_KM;
  const gainOk = gainText.trim() === '' || (gain !== null && gain >= 0 && gain <= MAX_GAIN_M);
  const distanceError = (checked || distanceText.trim() !== '') && !distanceOk ? DISTANCE_ERROR : undefined;
  const hasKey = !!settings && ((sharedOrsEnabled() && account !== null) || settings.ors.apiKey.trim() !== '');
  const ors = useMemo(() => (settings ? chooseOrsAccess(settings.ors.apiKey, account) : null), [settings, account]);
  const rwgps = useMemo<RwgpsAccess | null>(() => (account ? { getToken: sessionToken(account.client) } : null), [account]);
  const busy = work?.state === 'listing' || work?.state === 'adapting';
  const ready = !!rwgps && hasKey;

  /** Lo que pide el usuario, o `null` si falta algo (y lo dice). */
  const target = () => {
    setChecked(true);
    if (!distanceOk || !gainOk || distance === null) {
      document.getElementById(DISTANCE_ID)?.focus();
      return null;
    }
    if (!start) {
      toast(kind === 'aqui' ? 'Falta tu ubicación.' : 'Elige el inicio en el mapa.', { tone: 'error' });
      return null;
    }
    return { start, distanceKm: distance, elevGainM: gainText.trim() === '' ? null : gain };
  };

  const newController = () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    return controller;
  };

  // La pestaña se abre en el mismo gesto del usuario: si no, el navegador la bloquea.
  const openExplore = () => {
    const t = target();
    if (t) window.open(rwgpsExploreUrl(t), '_blank', 'noopener,noreferrer');
  };

  const adaptChoice = async (choice: RwgpsChoice) => {
    if (busy || !rwgps || !ors) return;
    const t = target();
    if (!t) return;
    const controller = newController();
    setWork({ state: 'adapting', label: choice.label, waitUntil: null });
    try {
      const out = await adaptRwgpsChoice(choice, t, {
        rwgps, ors, signal: controller.signal,
        onUpdate: (u) => {
          if (u.kind === 'waiting' && !controller.signal.aborted) setWork({ state: 'adapting', label: choice.label, waitUntil: Date.now() + u.seconds * 1000 });
        },
      });
      if (!controller.signal.aborted) setWork('proposal' in out ? { state: 'ready', proposal: out.proposal } : { state: 'error', message: out.rejected });
    } catch (e) {
      if (isAbort(e) || controller.signal.aborted) return;
      setWork({ state: 'error', message: messageOf(e) });
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  };

  const adapt = async () => {
    if (busy || !rwgps || !ors) return;
    const { links } = parseRwgpsLinks(linksText);
    if (links.length === 0) {
      setLinksError(NO_LINKS);
      document.getElementById(LINKS_ID)?.focus();
      return;
    }
    setLinksError(null);
    if (!target()) return;
    setChoices(null);
    // Una sola ruta: se adapta directamente, sin lista.
    if (links.length === 1 && links[0].kind === 'route') {
      await adaptChoice({ id: links[0].id, label: `Ruta ${links[0].id}` });
      return;
    }
    const controller = newController();
    setWork({ state: 'listing' });
    try {
      const out = await listRwgpsChoices(links, rwgps, controller.signal);
      if (controller.signal.aborted) return;
      setChoices({ items: out.choices, failed: out.failed });
      setWork(out.choices.length === 0 ? { state: 'error', message: 'Ninguno de los enlaces tiene rutas que se puedan leer.' } : null);
    } catch (e) {
      if (isAbort(e) || controller.signal.aborted) return;
      setWork({ state: 'error', message: messageOf(e) });
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  };

  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setWork(null);
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

  const secondsLeft = waitUntil === null ? 0 : Math.max(0, Math.ceil((waitUntil - now) / 1000));

  return (
    <Page
      title="Una ruta de Explore"
      back="/rutas"
      variant="narrow"
      className="page--wikiloc page--compartida"
      busy={!settings && !loadFailed}
      lead="Busca en Ride with GPS Explore, compártela con FBikeTrain o pega su enlace: la adapto para salir y volver a tu inicio."
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
        <>
          <section className="section card library-panel" aria-labelledby="cmp-hoy">
            <h2 className="card-title" id="cmp-hoy">
              ¿Qué quieres hacer hoy?
            </h2>
            <div className="wk-figures">
              <Field id={DISTANCE_ID} label="Distancia" inputMode="decimal" suffix="km" required value={distanceText} error={distanceError} onChange={(e) => setDistanceText(e.target.value)} />
              <Field label="Desnivel (opcional)" inputMode="numeric" suffix="m" value={gainText} error={gainOk ? undefined : GAIN_ERROR} onChange={(e) => setGainText(e.target.value)} />
            </div>
            <StartChoice
              home={home}
              kind={kind}
              points={points}
              onKind={setKind}
              onPick={(k, p) => setPoints((ps) => ({ ...ps, [k]: p }))}
              onSaveHome={(p) => void saveHome(p)}
            />
            <button type="button" className="btn btn--secondary btn--block btn--wrap" onClick={openExplore}>
              <ExternalLink className="ic" aria-hidden="true" />
              Buscar en Ride with GPS Explore
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </button>
            <p className="help">
              Se abre Explore cerca de tu inicio, con tu distancia (±10 %), asfalto y bici de carretera. Elige una ruta y usa «Compartir → FBikeTrain», o copia su enlace y pégalo aquí.
            </p>
          </section>

          <section className="section card library-panel" aria-labelledby="cmp-ruta">
            <h2 className="card-title" id="cmp-ruta">
              La ruta
            </h2>
            {received ? (
              <p className="cmp-received">
                <Share2 className="ic" aria-hidden="true" />
                Recibido desde Compartir
              </p>
            ) : null}
            <div className="field" data-invalid={linksError ? '' : undefined}>
              <label className="field-label" htmlFor={LINKS_ID}>
                Enlaces de Ride with GPS
              </label>
              <textarea
                id={LINKS_ID}
                className="input cmp-links"
                rows={3}
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://ridewithgps.com/routes/…"
                value={linksText}
                aria-invalid={linksError ? true : undefined}
                aria-describedby={`${LINKS_ID}-nota`}
                onChange={(e) => setLinksText(e.target.value)}
              />
              {linksError ? (
                <p className="field-error" id={`${LINKS_ID}-nota`}>
                  <CircleAlert className="ic" aria-hidden="true" />
                  {linksError}
                </p>
              ) : (
                <p className="field-help" id={`${LINKS_ID}-nota`}>
                  Una o varias rutas o colecciones públicas. Una colección se lista y eliges la ruta.
                </p>
              )}
            </div>
            {!rwgps ? (
              <p className="help">Inicia sesión para leer rutas de Ride with GPS: las lee la cuenta común de FBikeTrain.</p>
            ) : !hasKey ? (
              <StateView
                icon={KeyRound}
                level={3}
                title="Falta tu clave de rutas"
                text="Para unir la ruta con tu inicio hace falta OpenRouteService. Pega tu clave en Ajustes."
                action={
                  <Link className="btn btn--secondary" to="/ajustes?abrir=claves">
                    <SlidersHorizontal className="ic" aria-hidden="true" />
                    Ir a Ajustes
                  </Link>
                }
              />
            ) : (
              <button type="button" className="btn btn--primary btn--block" disabled={busy} onClick={() => void adapt()}>
                <Route className="ic" aria-hidden="true" />
                Adaptar
              </button>
            )}
          </section>
        </>
      ) : null}

      {choices && choices.items.length > 0 ? (
        <section className="section" aria-labelledby="cmp-elegir">
          <h2 className="section-title" id="cmp-elegir">
            Rutas para elegir
          </h2>
          <ul className="cmp-choices" aria-labelledby="cmp-elegir">
            {choices.items.map((c) => (
              <li key={c.id} className="cmp-choice">
                <span className="cmp-choice-name">{c.label}</span>
                <span className="cmp-choice-actions">
                  <a className="btn btn--ghost" href={`https://ridewithgps.com/routes/${c.id}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="ic" aria-hidden="true" />
                    Ver
                    <span className="sr-only"> {c.label} en Ride with GPS (se abre en otra pestaña)</span>
                  </a>
                  <button type="button" className="btn btn--secondary" disabled={busy || !ready} aria-label={`Adaptar ${c.label}`} onClick={() => void adaptChoice(c)}>
                    Adaptar
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {choices.failed.length > 0 ? (
            <ul className="wk-warnings">
              {choices.failed.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {work ? (
        <section className="section" aria-label="Resultado">
          {work.state === 'listing' ? (
            <div className="card library-panel cat-status" role="status">
              <CyclingLoader compact />
              <p>Leyendo los enlaces en Ride with GPS…</p>
            </div>
          ) : work.state === 'adapting' ? (
            <div className="card library-panel cat-status" role="status">
              <CyclingLoader compact />
              <p>
                {work.waitUntil !== null && secondsLeft > 0
                  ? `El motor de rutas admite pocas consultas por minuto. Sigo en ${secondsLeft} s…`
                  : `Adaptando «${work.label}» a tu inicio…`}
              </p>
              <button type="button" className="btn btn--ghost" onClick={cancel}>
                Cancelar
              </button>
            </div>
          ) : work.state === 'error' ? (
            <p className="library-error" role="alert">
              {work.message}
            </p>
          ) : (
            <ProposalCard
              headingLevel={2}
              source={{ name: work.proposal.route.name, original: work.proposal.route, sourceUrl: work.proposal.route.sourceUrl, author: work.proposal.route.author }}
              adapted={work.proposal.adapted}
            />
          )}
        </section>
      ) : null}
    </Page>
  );
}
