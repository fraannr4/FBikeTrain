import { useEffect, useRef, useState } from 'react';
import { isAbort } from '../../ai/abort';
import { buildLevelSummary, climbsInWindow, resolveReference, type LevelSummary } from '../../ai/levelSummary';
import { createSharedAiPlanner, SHARED_AI_ENABLED } from '../../ai/sharedClient';
import { recommendWikiloc, type WikilocAdvice } from '../../ai/wikilocAdvisor';
import { useAccount } from '../../auth/AccountBoundary';
import { listActivities, listClimbEfforts } from '../../db/repo';
import type { LatLng, Settings } from '../../domain/types';
import type { UserReference } from '../../metrics/reference';
import { sessionToken } from '../../routes/orsProxy';
import { isWikilocUrl } from '../../routes/wikilocLimits';
import {
  loadNearby, loadReceivedTrack, loadWikilocRequest, rankForTarget, saveWikilocRequest, wikilocSearchUrl,
  type NearbyState, type RankedWikiloc, type RankTarget, type WikilocCard, type WikilocTrackMessage,
} from '../../routes/wikilocNearby';
import { loadSettings, saveSettings } from '../../settings/settings';
import { Banner } from '../components/Banner';
import { DifficultyChip } from '../components/Chip';
import { Disclosure } from '../components/Disclosure';
import { Field } from '../components/Field';
import { List, ListRow } from '../components/ListRow';
import { Page } from '../components/Page';
import { StateView } from '../components/StateView';
import { useToast } from '../components/Toast';
import { formatCount, formatKm, formatMeters } from '../format';
import { CircleAlert, ExternalLink, ListFilter, Mountain, RefreshCw, Route, Sparkles } from '../icons';
import { referenceRange } from '../routes/routeView';
import { StartChoice, startPoint, type PickedPoints, type StartKind } from '../routes/StartChoice';
import '../styles/library.css';
import '../styles/wikiloc.css';

type Ctx = {
  settings: Settings;
  reference: UserReference | null;
  summary: LevelSummary | null;
  nearby: NearbyState;
  track: WikilocTrackMessage | null;
};
type Advice = { key: string; result: WikilocAdvice };

const DISTANCE_ID = 'wk-distancia';
const MIN_KM = 1;
const MAX_KM = 1000;
const MAX_GAIN_M = 20_000;
const DISTANCE_ERROR = `Escribe la distancia en km, entre ${formatCount(MIN_KM)} y ${formatCount(MAX_KM)}.`;
const GAIN_ERROR = `El desnivel va en metros, entre 0 y ${formatCount(MAX_GAIN_M)}.`;

const stamp = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
const routesWord = (n: number) => (n === 1 ? '1 ruta' : `${formatCount(n)} rutas`);

/** Cifra escrita con coma o punto; `null` si está vacía o no es un número. */
function parseFigure(text: string): number | null {
  const raw = text.trim().replace(/\s/g, '');
  // «1.200» o «1.200,5»: el punto separa miles; si no, la coma o el punto son decimales.
  const t = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Abre una página de Wikiloc en otra pestaña, sin darle acceso a la app. */
function openWikiloc(url: string): void {
  if (isWikilocUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
}

const samePoint = (a: LatLng | null, b: LatLng) => !!a && a.lat === b.lat && a.lng === b.lng;

/**
 * «Rutas de Wikiloc cerca»: lo que quieres hacer hoy, el enlace al mapa de Wikiloc alrededor del inicio,
 * la lista que trae el marcador ordenada por lo pedido y, si hay IA, su recomendación. Nada de aquí lee
 * wikiloc.com: abre páginas que el usuario ve con su navegador.
 */
export function WikilocCerca() {
  const account = useAccount();
  const toast = useToast();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [distanceText, setDistanceText] = useState('');
  const [gainText, setGainText] = useState('');
  const [kind, setKind] = useState<StartKind>('casa');
  const [points, setPoints] = useState<PickedPoints>({ aqui: null, mapa: null });
  const [checked, setChecked] = useState(false);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    const now = Date.now();
    setLoadFailed(false);
    const recent = listActivities(referenceRange(now)).then(async (acts) => [acts, await listClimbEfforts(acts.map((a) => a.id))] as const);
    Promise.all([loadSettings(), recent, loadNearby(now), loadReceivedTrack(now), loadWikilocRequest()])
      .then(async ([settings, [acts, climbs], nearby, track, request]) => {
        const reference = await resolveReference(acts, now);
        if (!alive) return;
        const summary = reference ? buildLevelSummary(reference, climbsInWindow(climbs, reference, now)) : null;
        setCtx({ settings, reference, summary, nearby, track: track.state === 'ok' ? track.track : null });
        if (request) {
          setDistanceText(String(request.distanceKm).replace('.', ','));
          setGainText(request.elevGainM === null ? '' : String(request.elevGainM));
          if (samePoint(settings.home, request.start)) setKind('casa');
          else {
            setKind('mapa');
            setPoints((p) => ({ ...p, mapa: request.start }));
          }
        } else setKind(settings.home ? 'casa' : 'mapa');
      })
      .catch(() => alive && setLoadFailed(true));
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => () => abort.current?.abort(), []);

  const home = ctx?.settings.home ?? null;
  const start = startPoint(kind, home, points);
  const distance = parseFigure(distanceText);
  const gain = parseFigure(gainText);
  const distanceOk = distance !== null && distance >= MIN_KM && distance <= MAX_KM;
  const gainOk = gainText.trim() === '' || (gain !== null && gain >= 0 && gain <= MAX_GAIN_M);
  const target: RankTarget | null = distanceOk && gainOk ? { distanceKm: distance, ...(gain !== null ? { elevGainM: gain } : {}) } : null;
  const targetKey = target ? `${target.distanceKm}|${target.elevGainM ?? ''}` : '';
  const distanceError = (checked || distanceText.trim() !== '') && !distanceOk ? DISTANCE_ERROR : undefined;
  const gainError = gainOk ? undefined : GAIN_ERROR;

  const rutas = ctx?.nearby.state === 'ok' ? ctx.nearby.rutas : null;
  // Como mucho 50 rutas: ordenarlas en cada render no cuesta nada.
  const ranking = rutas && target ? rankForTarget(rutas, target, ctx?.reference ?? null) : null;

  const llm = ctx?.settings.llm;
  const sharedAi = SHARED_AI_ENABLED && account !== null;
  const aiAvailable = sharedAi || (!!llm && llm.apiKey.trim() !== '' && llm.model.trim() !== '');
  const shownAdvice = advice && advice.key === targetKey ? advice.result : null;

  /** Guarda lo pedido para la ventana que abre el marcador. `false` si falta algo, y lo dice. */
  const commit = async (): Promise<boolean> => {
    setChecked(true);
    if (!target) {
      document.getElementById(DISTANCE_ID)?.focus();
      return false;
    }
    if (!start) {
      toast(kind === 'aqui' ? 'Falta tu ubicación para buscar alrededor.' : 'Elige el inicio en el mapa.', { tone: 'error' });
      return false;
    }
    try {
      await saveWikilocRequest({ distanceKm: target.distanceKm, elevGainM: target.elevGainM ?? null, start });
    } catch {
      toast('No se ha podido guardar lo que pides. Vuelve a probar.', { tone: 'error' });
      return false;
    }
    return true;
  };

  // La pestaña se abre en el mismo gesto del usuario: si no, el navegador la bloquea. Después se guarda lo pedido.
  const search = () => {
    if (target && start) openWikiloc(wikilocSearchUrl(start));
    void commit();
  };

  const adapt = (card: WikilocCard) => {
    if (target && start) openWikiloc(card.url);
    void commit();
  };

  const saveHome = async (p: LatLng) => {
    try {
      const next = { ...(await loadSettings()), home: p };
      await saveSettings(next);
      setCtx((c) => (c ? { ...c, settings: next } : c));
      setKind('casa');
      toast('Casa guardada', { tone: 'good' });
    } catch {
      toast('No se ha podido guardar Casa. Vuelve a probar.', { tone: 'error' });
    }
  };

  const recommend = async () => {
    if (!ctx || !ranking || !target || aiBusy) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const key = targetKey;
    setAiBusy(true);
    try {
      const shared = sharedAi && account ? createSharedAiPlanner(sessionToken(account.client)) : undefined;
      const result = await recommendWikiloc({ ranked: ranking.ranked, target, summary: ctx.summary }, { llm: ctx.settings.llm, shared, signal: controller.signal });
      if (!controller.signal.aborted) setAdvice({ key, result });
    } catch (e) {
      if (!isAbort(e) && !controller.signal.aborted) setAdvice({ key, result: { kind: 'local', reason: 'Ha fallado algo inesperado al pedir la recomendación. Se queda el orden local.' } });
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setAiBusy(false);
      }
    }
  };

  const cancelAi = () => {
    abort.current?.abort();
    abort.current = null;
    setAiBusy(false);
  };

  return (
    <Page
      title="Rutas de Wikiloc cerca"
      back="/rutas"
      variant="narrow"
      className="page--wikiloc"
      busy={!ctx && !loadFailed}
      lead="Rutas de carretera de Wikiloc que salen o pasan cerca de tu inicio, ordenadas por lo que pides hoy."
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

      {ctx?.track ? (
        <section className="section" aria-label="Ruta recibida">
          <List inset>
            <ListRow
              to="/rutas/wikiloc/adaptar"
              icon={Route}
              accent="dist"
              title={`Ruta recibida: «${ctx.track.nombre}»`}
              meta="Adáptala a tu inicio y a tu distancia"
            />
          </List>
        </section>
      ) : null}

      {ctx ? (
        <section className="section card library-panel" aria-labelledby="wk-hoy">
          <h2 className="card-title" id="wk-hoy">
            ¿Qué quieres hacer hoy?
          </h2>
          <div className="wk-figures">
            <Field
              id={DISTANCE_ID}
              label="Distancia"
              inputMode="decimal"
              suffix="km"
              required
              value={distanceText}
              error={distanceError}
              help={ctx.reference ? `Tu salida media: ${formatKm(ctx.reference.avgDistanceM)}` : undefined}
              onChange={(e) => setDistanceText(e.target.value)}
            />
            <Field
              label="Desnivel (opcional)"
              inputMode="numeric"
              suffix="m"
              value={gainText}
              error={gainError}
              onChange={(e) => setGainText(e.target.value)}
            />
          </div>
          <StartChoice
            home={home}
            kind={kind}
            points={points}
            onKind={setKind}
            onPick={(k, p) => setPoints((ps) => ({ ...ps, [k]: p }))}
            onSaveHome={(p) => void saveHome(p)}
          />
          <button type="button" className="btn btn--primary btn--block" onClick={search}>
            <ExternalLink className="ic" aria-hidden="true" />
            Buscar en Wikiloc
          </button>
          <p className="help">
            Se abre el mapa de Wikiloc alrededor de tu inicio, con rutas de ciclismo de carretera. Allí, pulsa el marcador «→ FBikeTrain» y
            las rutas que ves llegan aquí. <a href={`${import.meta.env.BASE_URL}wikiloc-marcador.html`}>Instalar el marcador</a>
          </p>
        </section>
      ) : null}

      {ctx ? <Results ctx={ctx} ranking={ranking} target={target} onAdapt={adapt} /> : null}

      {ctx && ranking && ranking.ranked.length > 0 && target ? (
        <section className="section card library-panel" aria-labelledby="wk-ia">
          <h2 className="card-title" id="wk-ia">
            Recomendación de la IA
          </h2>
          {!aiAvailable ? (
            <p className="help">Sin IA configurada, el orden es el local: primero las que más se acercan a lo que pides.</p>
          ) : aiBusy ? (
            <div className="wk-ai-busy" role="status">
              <p>La IA está eligiendo entre las rutas recibidas…</p>
              <button type="button" className="btn btn--secondary" onClick={cancelAi}>
                Cancelar
              </button>
            </div>
          ) : (
            <>
              <p className="help">Elige de 3 a 5 rutas con su motivo. Solo ve el nombre, los km y el desnivel de cada ruta.</p>
              <button type="button" className="btn btn--secondary btn--block" onClick={() => void recommend()}>
                <Sparkles className="ic" aria-hidden="true" />
                Pedir recomendación a la IA
              </button>
            </>
          )}
          {shownAdvice?.kind === 'local' ? <Banner>{shownAdvice.reason}</Banner> : null}
          {shownAdvice?.kind === 'ai' ? (
            <ol className="wk-list" aria-label="Recomendadas por la IA">
              {shownAdvice.picks.map(({ card, motivo }) => (
                <li key={card.id} className="wk-card">
                  <h3 className="wk-name">{card.nombre}</h3>
                  <p className="wk-meta">{cardFigures(card)}</p>
                  <p className="wk-why">{motivo}</p>
                  <AdaptButton card={card} onAdapt={adapt} />
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}
    </Page>
  );
}

function cardFigures(card: WikilocCard): string {
  return [formatKm(card.km * 1000), card.desnivelM === null ? 'desnivel sin dato' : formatMeters(card.desnivelM), card.autor].filter(Boolean).join(' · ');
}

function AdaptButton({ card, onAdapt }: { card: WikilocCard; onAdapt: (card: WikilocCard) => void }) {
  return (
    <button type="button" className="btn btn--secondary" aria-label={`Adaptar esta ruta: ${card.nombre}`} onClick={() => onAdapt(card)}>
      <ExternalLink className="ic" aria-hidden="true" />
      Adaptar esta ruta
    </button>
  );
}

function Results({
  ctx,
  ranking,
  target,
  onAdapt,
}: {
  ctx: Ctx;
  ranking: ReturnType<typeof rankForTarget> | null;
  target: RankTarget | null;
  onAdapt: (card: WikilocCard) => void;
}) {
  const { nearby } = ctx;
  if (nearby.state === 'none') {
    return (
      <section className="section card">
        <StateView
          icon={Mountain}
          level={2}
          title="Aún no has traído rutas de Wikiloc"
          text="Pulsa «Buscar en Wikiloc» y, en Wikiloc, toca el marcador «→ FBikeTrain». Las rutas que veas en el mapa aparecerán aquí."
        />
      </section>
    );
  }
  if (nearby.state === 'expired') {
    return (
      <section className="section card">
        <StateView
          icon={Mountain}
          level={2}
          title="La lista de Wikiloc ha caducado"
          text={`Las listas se guardan 7 días y esta llegó el ${stamp.format(nearby.savedAt)}. Vuelve a buscar en Wikiloc y pulsa el marcador.`}
        />
      </section>
    );
  }
  if (nearby.rutas.length === 0) {
    return (
      <section className="section" aria-labelledby="wk-lista">
        <h2 className="section-title" id="wk-lista">
          No ha llegado ninguna ruta
        </h2>
        <p className="help">La búsqueda de Wikiloc del {stamp.format(nearby.savedAt)} no traía rutas. Amplía la zona o quita filtros en Wikiloc y vuelve a pulsar el marcador.</p>
      </section>
    );
  }
  const received = `${routesWord(nearby.rutas.length)} ${nearby.rutas.length === 1 ? 'recibida' : 'recibidas'} el ${stamp.format(nearby.savedAt)}. Se borran a los 7 días.`;
  if (!ranking || !target) {
    return (
      <section className="section" aria-labelledby="wk-lista">
        <h2 className="section-title" id="wk-lista">
          Rutas recibidas
        </h2>
        <p className="help">{received} Escribe la distancia para ordenarlas.</p>
      </section>
    );
  }
  const { ranked, discarded } = ranking;
  return (
    <section className="section" aria-labelledby="wk-lista">
      <h2 className="section-title" id="wk-lista">
        {ranked.length === 0 ? `Ninguna ruta encaja con ${formatKm(target.distanceKm * 1000)}` : `${routesWord(ranked.length)} para ${formatKm(target.distanceKm * 1000)}`}
      </h2>
      <p className="help">{received}</p>
      {ranked.length > 0 ? (
        <ol className="wk-list" aria-label="Rutas que encajan">
          {ranked.map((r) => (
            <RankedItem key={r.card.id} item={r} onAdapt={onAdapt} />
          ))}
        </ol>
      ) : null}
      {discarded.length > 0 ? (
        <Disclosure
          icon={ListFilter}
          title={discarded.length === 1 ? '1 ruta descartada' : `${formatCount(discarded.length)} rutas descartadas`}
          meta="Se admiten de la mitad a 1,6 veces la distancia pedida"
        >
          <ul className="wk-discarded">
            {discarded.map(({ card, motivo }) => (
              <li key={card.id}>
                <b>{card.nombre}</b>: {motivo}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </section>
  );
}

function RankedItem({ item, onAdapt }: { item: RankedWikiloc; onAdapt: (card: WikilocCard) => void }) {
  const { card, etiqueta, motivo } = item;
  return (
    <li className="wk-card">
      <h3 className="wk-name">{card.nombre}</h3>
      <p className="wk-meta">{cardFigures(card)}</p>
      {etiqueta ? <DifficultyChip level={etiqueta} /> : null}
      <p className="wk-why">{motivo}</p>
      <AdaptButton card={card} onAdapt={onAdapt} />
    </li>
  );
}
