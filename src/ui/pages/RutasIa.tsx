import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  buildLevelSummary,
  climbsInWindow,
  referenceFromAnswers,
  resolveReference,
  saveDeclaredReference,
  type InitialAnswers,
  type LevelSummary,
} from '../../ai/levelSummary';
import { chatJson, LlmError, type LlmErrorKind } from '../../ai/llm';
import { isAbort } from '../../ai/abort';
import { aiGoal } from '../../ai/goalContext';
import { runAiRoutes } from '../../ai/routePlanner';
import { createSharedAiPlanner, SHARED_AI_ENABLED } from '../../ai/sharedClient';
import { useAccount } from '../../auth/AccountBoundary';
import { listGoals } from '../../calendar/calendarRepo';
import { listActivities, listClimbEfforts } from '../../db/repo';
import type { ClimbEffort, LatLng, Settings } from '../../domain/types';
import { localDay } from '../../metrics/calendar';
import type { UserReference } from '../../metrics/reference';
import type { Target } from '../../metrics/score';
import { gpxFileName } from '../../routes/gpx';
import { loadVisitedCells } from '../../routes/history';
import { ORS_DAILY_LIMIT, OrsError } from '../../routes/ors';
import { chooseOrsAccess, sessionToken, SHARED_ORS_LIMITS, sharedOrsEnabled } from '../../routes/orsProxy';
import { routeSourcesEnabled } from '../../routes/sources/client';
import { getOrsUsage, type OrsUsage } from '../../routes/orsUsage';
import { loadSettings, saveSettings } from '../../settings/settings';
import { AiNeverList, AiRoutesCarousel, AiSeesList, AI_NEVER, aiShown, type ShownRoute } from '../components/AiRoutes';
import { Banner } from '../components/Banner';
import { CyclingLoader } from '../components/CyclingLoader';
import { Dock } from '../components/Dock';
import {
  AnswerList,
  AskCard,
  EMPTY_DRAFT,
  GuidedStep,
  NotesField,
  STEPS,
  STEP_TITLE,
  answerText,
  draftStart,
  firstOpenStep,
  stepDone,
  toAnswers,
  type Draft,
  type Step,
} from '../components/GuidedQuestions';
import { InitialQuestions } from '../components/InitialQuestions';
import { List, ListRow } from '../components/ListRow';
import { Page } from '../components/Page';
import { RouteForm } from '../components/RouteForm';
import { Sheet } from '../components/Sheet';
import { RideMap } from '../components/RideMap';
import { StateView } from '../components/StateView';
import { useToast } from '../components/Toast';
import { formatCount } from '../format';
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Download,
  Folder,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from '../icons';
import { downloadGpx, GpxHelpSheet } from '../routes/gpxExport';
import { RouteCardSkeleton, type RouteCardData } from '../routes/RouteCard';
import { RouteMapSheet } from '../routes/RouteMapSheet';
import { spliceHref, useSaveRoute } from '../routes/useSaveRoute';
import { nameRoutes, referenceRange, renewsAt, toCardData } from '../routes/routeView';
import { useRouteSearch } from '../routes/useRouteSearch';
import { useReducedMotion } from '../theme/motion';

const TITLE = 'Rutas con IA';
const FORM_ID = 'ia-manual-form';
/** Una búsqueda con IA: de 3 a 5 opciones, con 3 semillas cada una (`runAiRoutes`). */
const ORS_PER_SEARCH = 15;
/** Fallos de la IA que se arreglan en Ajustes: la clave rechazada o sin modelo. */
const KEY_CAUSES: ReadonlySet<LlmErrorKind> = new Set(['unauthorized', 'no_model']);
const UNEXPECTED = 'Ha fallado algo inesperado al preparar las rutas. Vuelve a probar en un momento.';

type Ctx = {
  settings: Settings;
  reference: UserReference | null;
  summary: LevelSummary | null;
  climbs: ClimbEffort[];
  usage: OrsUsage;
};

type Outcome =
  | { kind: 'routes'; source: 'ia' | 'manual'; at: number; shown: ShownRoute[]; warnings: string[] }
  | { kind: 'fallback'; message: string; cause: LlmErrorKind; suggested: Target }
  | { kind: 'error'; message: string };

/** Por dónde va la búsqueda con IA: el plan, las carreteras de ORS y las explicaciones. */
type Stage = 'plan' | 'ors' | 'explain';
type View = Step | 'propuestas';

/** Respuestas y propuestas de esta sesión: siguen ahí al volver a la pantalla (no se guardan en disco). */
let session: { draft: Draft; outcome: Outcome | null } = { draft: EMPTY_DRAFT, outcome: null };

/** Olvida las respuestas y las propuestas de esta sesión (al borrar los datos, o entre pruebas). */
export function forgetAiRoutes(): void {
  session = { draft: EMPTY_DRAFT, outcome: null };
}

function summaryFor(ref: UserReference | null, climbs: ClimbEffort[], now: number): LevelSummary | null {
  return ref ? buildLevelSummary(ref, climbsInWindow(climbs, ref, now)) : null;
}

/**
 * Rutas con IA (ia.html): cuatro preguntas, una por pantalla, el resumen con lo que verá la IA y las
 * propuestas explicadas. La IA convierte las respuestas en objetivos y explica las rutas; las
 * carreteras las pone ORS y las cifras, el código. Si la IA falla, el formulario manual ya relleno.
 */
export function RutasIa() {
  const account = useAccount();
  const sharedMode = SHARED_AI_ENABLED && account !== null;
  const sharedOrs = sharedOrsEnabled() && account !== null;
  const knownRoutes = routeSourcesEnabled() && account !== null;
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const reduced = useReducedMotion();
  const search = useRouteSearch();
  const saveRoute = useSaveRoute();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState<Draft>(session.draft);
  const [outcome, setOutcome] = useState<Outcome | null>(session.outcome);
  const [stage, setStage] = useState<Stage | null>(null);
  const [sheet, setSheet] = useState<'ia' | 'gpx' | 'map' | null>(null);
  const [index, setIndex] = useState(0);
  const [gpx, setGpx] = useState<{ file: string; name: string } | null>(null);
  const [mapRoute, setMapRoute] = useState<RouteCardData | null>(null);
  const [savingRef, setSavingRef] = useState(false);
  const runId = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    session.draft = draft;
  }, [draft]);
  useEffect(() => {
    session.outcome = outcome;
  }, [outcome]);

  useEffect(() => {
    let alive = true;
    const now = Date.now();
    // Solo la ventana de la referencia y las subidas de esas salidas: con miles de salidas, leerlas
    // todas tarda segundos en el móvil.
    const recent = listActivities(referenceRange(now)).then(
      async (acts) => [acts, await listClimbEfforts(acts.map((a) => a.id))] as const,
    );
    Promise.all([loadSettings(), recent, getOrsUsage(now)])
      .then(async ([settings, [acts, climbs], usage]) => {
        const reference = await resolveReference(acts, now);
        if (alive) setCtx({ settings, reference, summary: summaryFor(reference, climbs, now), climbs, usage });
      })
      .catch(() => alive && setLoadFailed(true));
    return () => {
      alive = false;
      runId.current++; // una búsqueda en curso ya no pinta nada
      abort.current?.abort();
      if (advance.current) clearTimeout(advance.current);
    };
  }, []);

  const refreshUsage = useCallback(() => {
    getOrsUsage(Date.now()).then((usage) => setCtx((c) => (c ? { ...c, usage } : c)), () => {});
  }, []);

  const home = ctx?.settings.home ?? null;
  const llm = ctx?.settings.llm;
  const llmReady = sharedMode || (!!llm && llm.apiKey.trim() !== '' && llm.model.trim() !== '');
  const orsReady = !!ctx && (sharedOrs || ctx.settings.ors.apiKey.trim() !== '');
  // El contador local es el de la clave personal; la cuota del servicio común la lleva el servidor.
  const quotaOut = !sharedOrs && !!ctx && ctx.usage.count >= ORS_DAILY_LIMIT;

  // El paso va en la URL (?paso=): el gesto atrás vuelve a la pregunta anterior y no saca de la IA.
  const wanted = params.get('paso');
  const open = firstOpenStep(draft, home);
  let view: View = STEPS.includes(wanted as Step) ? (wanted as Step) : wanted === 'propuestas' ? 'propuestas' : 'foco';
  if (view === 'propuestas' ? !outcome && !stage : STEPS.indexOf(view) > STEPS.indexOf(open)) view = open;

  const phase = loadFailed
    ? 'failed'
    : !ctx
      ? 'boot'
      : !llmReady || !orsReady
        ? 'nokey'
        : !ctx.reference
          ? 'initial'
          : view !== 'propuestas'
            ? 'question'
            : stage
              ? 'loading'
              : search.busy
                ? 'searching'
                : (outcome?.kind ?? 'loading');

  const goTo = useCallback(
    (to: View, replace = false) => navigate({ search: `?paso=${to}` }, { replace, state: { prev: view } }),
    [navigate, view],
  );

  // Atrás (gesto o flecha) durante la espera: se cancela y se vuelve al resumen.
  const lastView = useRef(view);
  useEffect(() => {
    const left = lastView.current === 'propuestas' && view !== 'propuestas';
    lastView.current = view;
    if (left && stage) {
      runId.current++;
      abort.current?.abort();
      setStage(null);
      search.cancel();
    }
  }, [view, stage, search]);

  // Al cambiar de pregunta, el foco va al título, que la anuncia; la página empieza arriba.
  // Al llegar a la pantalla (desde la carga), no: el foco sigue donde lo deja el navegador.
  const shownKey = phase === 'question' ? view : phase;
  const lastKey = useRef(shownKey);
  useEffect(() => {
    const from = lastKey.current;
    lastKey.current = shownKey;
    if (from === shownKey || from === 'boot') return;
    const h = document.querySelector<HTMLElement>('.page .page-title');
    if (!h) return;
    h.tabIndex = -1;
    h.focus({ preventScroll: true });
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  }, [shownKey]);

  // En apaisado, durante las preguntas, sin barra inferior (ia.css).
  useEffect(() => {
    document.body.toggleAttribute('data-ia-flow', phase === 'question');
    return () => document.body.removeAttribute('data-ia-flow');
  }, [phase]);

  const stepIndex = STEPS.indexOf(view as Step);

  const change = (patch: Partial<Draft>, next: boolean) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (advance.current) clearTimeout(advance.current);
    if (next && stepIndex >= 0 && stepIndex < STEPS.length - 1) {
      const to = STEPS[stepIndex + 1];
      advance.current = setTimeout(() => goTo(to), reduced ? 120 : 220);
    }
  };

  const prevStep = () => {
    if (stepIndex < 1) return;
    const p = STEPS[stepIndex - 1];
    if ((location.state as { prev?: View } | null)?.prev === p) navigate(-1);
    else goTo(p, true);
  };

  const saveHome = async (p: LatLng) => {
    try {
      const next = { ...(await loadSettings()), home: p };
      await saveSettings(next);
      setCtx((c) => (c ? { ...c, settings: next } : c));
      toast('Casa guardada', { tone: 'good' });
    } catch {
      toast('No se ha podido guardar Casa. Vuelve a probar.', { tone: 'error' });
    }
  };

  const saveInitial = async (a: InitialAnswers) => {
    setSavingRef(true);
    try {
      await saveDeclaredReference(a);
      const reference = referenceFromAnswers(a);
      setCtx((c) => (c ? { ...c, reference, summary: summaryFor(reference, c.climbs, Date.now()) } : c));
    } catch {
      toast('No se han podido guardar tus cifras. Vuelve a probar.', { tone: 'error' });
    } finally {
      setSavingRef(false);
    }
  };

  const ask = async () => {
    const answers = toAnswers(draft);
    const start = draftStart(draft, home);
    if (!ctx?.reference || !ctx.summary || !llm || !answers || !start || quotaOut) return;
    abort.current?.abort();
    const controller = (abort.current = new AbortController());
    const id = ++runId.current;
    const live = () => runId.current === id;
    // Las etapas de la espera salen de las llamadas a la IA: la primera es el plan; la segunda, la explicación.
    const chat = (<T,>(cfg: Settings['llm'], req: Parameters<typeof chatJson<T>>[1]) => {
      const isPlan = req.schemaName === 'plan_rutas';
      if (live()) setStage(isPlan ? 'plan' : 'explain');
      const out = chatJson(cfg, req);
      if (isPlan) out.then(() => live() && setStage('ors'), () => {});
      return out;
    }) as typeof chatJson;

    setStage('plan');
    setOutcome(null);
    goTo('propuestas', view === 'propuestas'); // «Reintentar» no apila otra entrada igual
    try {
      const visited = await loadVisitedCells();
      // El objetivo vigente, solo cifras; si no se puede leer, la IA no lo recibe.
      const now = Date.now();
      const goal = await Promise.all([listGoals(), listActivities(referenceRange(now))])
        .then(([goals, acts]) => aiGoal(goals, acts, now, localDay(now)), () => null);
      const sharedService = sharedMode && account ? createSharedAiPlanner(sessionToken(account.client)) : undefined;
      const shared = sharedService ? {
        plan: async (...args: Parameters<typeof sharedService.plan>) => {
          if (live()) setStage('plan');
          const data = await sharedService.plan(...args);
          if (live()) setStage('ors');
          return data;
        },
        explain: async (...args: Parameters<typeof sharedService.explain>) => {
          if (live()) setStage('explain');
          return sharedService.explain(...args);
        },
      } : undefined;
      const res = await runAiRoutes(
        { start, answers, reference: ctx.reference, summary: ctx.summary },
        { llm, orsKey: chooseOrsAccess(ctx.settings.ors.apiKey, account), visited, chat, signal: controller.signal, shared, sources: account?.client.functions, goal },
      );
      if (!live()) return;
      if (res.kind === 'routes') {
        setOutcome({ kind: 'routes', source: 'ia', at: Date.now(), shown: aiShown(res.routes), warnings: res.warnings });
        setIndex(0);
        const n = res.routes.length;
        if (n > 0) toast(n === 1 ? '1 ruta propuesta' : `${n} rutas propuestas`, { tone: 'good' });
      } else {
        setOutcome({ kind: 'fallback', message: res.message, cause: res.cause, suggested: res.suggested });
      }
    } catch (e) {
      if (live() && !isAbort(e)) setOutcome({ kind: 'error', message: e instanceof OrsError || e instanceof LlmError ? e.message : UNEXPECTED });
    } finally {
      if (live()) setStage(null);
      refreshUsage(); // también tras cancelar: las llamadas ya hechas cuentan
    }
  };

  const cancel = () => {
    runId.current++;
    abort.current?.abort();
    setStage(null);
    search.cancel();
    goTo('resumen', true);
  };

  const submitManual = async (target: Target) => {
    const start = draftStart(draft, home);
    if (!start || quotaOut) return;
    const result = await search.run(start, target);
    refreshUsage();
    if (!result) return;
    const names = nameRoutes(result.routes, start);
    setOutcome({
      kind: 'routes',
      source: 'manual',
      at: Date.now(),
      shown: result.routes.map((r, i) => ({ card: toCardData(r, names[i]), coords: r.coords, file: gpxFileName(r) })),
      warnings: result.stoppedBy ? [result.stoppedBy.message] : [],
    });
    setIndex(0);
  };

  const shown = outcome?.kind === 'routes' ? outcome.shown : [];
  const current = shown[Math.min(index, shown.length - 1)] ?? null;

  const exportRoute = (card: RouteCardData) => {
    const s = shown.find((x) => x.card.id === card.id);
    if (!s) return;
    if (!downloadGpx(card.name, s.coords, s.file)) {
      toast('Este navegador no deja descargar el GPX.', { tone: 'error' });
      return;
    }
    setGpx({ file: s.file, name: card.name });
    toast(`GPX exportado: ${s.file}`, { tone: 'good', action: { label: 'Cómo pasarlo', onClick: () => setSheet('gpx') } });
  };

  const openMap = useCallback((c: RouteCardData) => {
    setMapRoute(c);
    setSheet('map');
  }, []);

  /** «Empalmar con…»: la ruta pasa a la biblioteca y Empalmar se abre con ella de primer tramo. */
  const spliceWith = async (card: RouteCardData) => {
    const s = shown.find((x) => x.card.id === card.id);
    if (!s || outcome?.kind !== 'routes') return;
    const id = await saveRoute(`${outcome.at}:${card.id}`, card.name, s.coords, s.file);
    if (id) navigate(spliceHref(id));
  };

  // Cabecera: en las preguntas, el paso y la pregunta; en los estados, dónde estás y qué pasa.
  // El resumen cuenta como el último paso, como en el prototipo («Paso 4 de 4»); aquí son cinco porque
  // el plan añade la pregunta «¿Desde dónde sales?», que el prototipo no tiene.
  let kicker: ReactNode;
  let title = TITLE;
  if (phase === 'nokey') kicker = 'Falta un paso';
  else if (phase === 'initial') kicker = 'Antes de empezar';
  else if (phase === 'question') {
    kicker = `Paso ${stepIndex + 1} de ${STEPS.length}`;
    title = STEP_TITLE[view as Step];
  } else if (phase === 'loading' || phase === 'searching') {
    kicker = TITLE;
    title = 'Preparando tus rutas…';
  } else if (phase === 'error') {
    kicker = TITLE;
    title = 'No han salido las rutas';
  } else if (phase === 'fallback') {
    kicker = 'La IA no ha podido';
    title = 'Ajusta la ruta a mano';
  } else if (phase === 'routes' && outcome?.kind === 'routes') {
    const n = outcome.shown.length;
    kicker = outcome.source === 'ia' ? 'Propuestas de la IA' : 'Ajustadas a mano';
    title = n === 0 ? 'Sin rutas' : `${n === 1 ? '1 ruta' : `${formatCount(n)} rutas`} ${outcome.source === 'ia' ? 'para hoy' : 'para ti'}`;
  }

  const progress =
    phase === 'question' ? (
      <div
        className="qprog"
        role="progressbar"
        aria-label="Progreso"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={stepIndex + 1}
        aria-valuetext={`Paso ${stepIndex + 1} de ${STEPS.length}`}
      >
        {STEPS.map((s, i) => (
          <i key={s} data-on={i <= stepIndex ? '' : undefined} />
        ))}
      </div>
    ) : undefined;

  const usageLine = !ctx ? null : sharedOrs ? (
    <p className="field-help">
      {`Rutas por el servicio común: ${SHARED_ORS_LIMITS}. Cada búsqueda con IA usa hasta ${ORS_PER_SEARCH}.`}
    </p>
  ) : (
    <p className="field-help">
      {`Consultas ORS hoy: ${formatCount(Math.min(ctx.usage.count, ORS_DAILY_LIMIT))} de ${formatCount(ORS_DAILY_LIMIT)}. Cada búsqueda con IA usa hasta ${ORS_PER_SEARCH}.`}
    </p>
  );

  const quotaBanner =
    quotaOut && ctx ? (
      <Banner tone="warn">
        <b>Cuota de OpenRouteService agotada.</b>{' '}
        {`Has usado las ${formatCount(ORS_DAILY_LIMIT)} consultas gratuitas de hoy; se renueva ${renewsAt(ctx.usage.windowStart, Date.now())}.`}
      </Banner>
    ) : null;

  const startLine = `${draft.start === 'mapa' ? 'Desde el punto del mapa' : 'Desde Casa'}, ${answerText('zona', draft).toLowerCase()}`;

  return (
    <>
      <Page
        title={title}
        barTitle={TITLE}
        back="/rutas"
        className="page--ia"
        desktopMap={current ? <RideMap points={current.card.shape} label={`Mapa de ${current.card.name}`} /> : undefined}
        kicker={kicker}
        busy={phase === 'boot' || phase === 'loading' || phase === 'searching'}
        nav={progress}
        actions={
          <button type="button" className="icon-btn" aria-label="Qué ve la IA" onClick={() => setSheet('ia')}>
            <ShieldCheck className="ic" aria-hidden="true" />
          </button>
        }
      >
        {phase === 'failed' ? (
          <section className="section card">
            <StateView
              icon={CircleAlert}
              tone="error"
              level={2}
              title="No se han podido leer tus datos"
              text="El almacenamiento del navegador no responde. Recarga la página."
            />
          </section>
        ) : null}

        {phase === 'nokey' ? (
          <section className="section card" aria-label="Falta una clave">
            <StateView
              icon={KeyRound}
              level={2}
              title={llmReady ? 'Falta tu clave de rutas' : 'Falta tu clave de IA'}
              text={
                llmReady
                  ? 'Las carreteras las traza OpenRouteService con tu propia clave gratuita. Pégala en Ajustes y vuelve aquí.'
                  : 'Configura la IA en Ajustes: las propuestas explicadas usan tu propia clave y un modelo con salida JSON, por ejemplo openai/gpt-oss-20b. Mientras, puedes generar rutas con tus cifras.'
              }
              action={
                <div className="rutas-actions">
                  <Link className="btn btn--primary" to="/ajustes?abrir=claves">
                    <SlidersHorizontal className="ic" aria-hidden="true" />
                    Ir a Ajustes
                  </Link>
                  <Link className="btn btn--ghost" to="/rutas">
                    Generar sin IA
                  </Link>
                </div>
              }
            />
          </section>
        ) : null}

        {phase === 'initial' ? <InitialQuestions onSave={(a) => void saveInitial(a)} busy={savingRef} /> : null}

        {phase === 'question' && ctx?.reference ? (
          view === 'resumen' ? (
            <div className="section ia-summary" key="resumen">
              <AnswerList draft={draft} onEdit={(s) => goTo(s)} />
              <AskCard draft={draft} reference={ctx.reference} />
              {quotaBanner}
              <NotesField value={draft.notes} onChange={(notes) => setDraft((d) => ({ ...d, notes }))} />
              <section className="card" data-m="time" aria-labelledby="ia-sees-t">
                <div className="card-h">
                  <span className="card-ic" aria-hidden="true">
                    <ShieldCheck className="ic" />
                  </span>
                  <h2 className="card-title" id="ia-sees-t">
                    Lo que verá la IA
                  </h2>
                </div>
                <AiSeesList summary={ctx.summary} knownRoutes={knownRoutes} />
                <p className="card-foot">{AI_NEVER}</p>
              </section>
              {usageLine}
            </div>
          ) : (
            <section className="section q-panel" key={view} aria-label="Respuestas">
              <GuidedStep
                step={view as Exclude<Step, 'resumen'>}
                label={STEP_TITLE[view as Step]}
                draft={draft}
                reference={ctx.reference}
                home={home}
                onChange={change}
                onSaveHome={(p) => void saveHome(p)}
              />
              {view === 'foco' ? (
                <Banner
                  icon={ShieldCheck}
                  action={
                    <button type="button" className="btn btn--ghost" onClick={() => setSheet('ia')}>
                      Qué ve exactamente
                    </button>
                  }
                >
                  La IA solo ve <b>cifras resumidas</b>: nunca tus tracks ni dónde está Casa.
                </Banner>
              ) : null}
            </section>
          )
        ) : null}

        {phase === 'loading' ? <Waiting stage={stage ?? 'plan'} onCancel={cancel} /> : null}

        {phase === 'searching' ? (
          <Waiting stage="ors" progress={search.progress} onCancel={cancel} />
        ) : null}

        {phase === 'error' && outcome?.kind === 'error' ? (
          <section className="section card" aria-label="Error">
            <StateView
              icon={CircleAlert}
              tone="error"
              level={2}
              title="No se han podido pedir las rutas"
              text={`${outcome.message} Tus respuestas están guardadas.`}
              action={
                <Link className="btn btn--secondary" to="/ajustes?abrir=claves">
                  <KeyRound className="ic" aria-hidden="true" />
                  Revisar las claves
                </Link>
              }
            />
          </section>
        ) : null}

        {phase === 'fallback' && outcome?.kind === 'fallback' ? (
          <>
            <Banner
              tone="warn"
              action={
                KEY_CAUSES.has(outcome.cause) ? (
                  <Link className="btn btn--ghost" to="/ajustes?abrir=claves">
                    <KeyRound className="ic" aria-hidden="true" />
                    Revisar la clave
                  </Link>
                ) : undefined
              }
            >
              {outcome.message}
            </Banner>
            {search.error ? <Banner tone="error">{search.error}</Banner> : null}
            {quotaBanner}
            <section className="section card gen-inline" aria-label="Elige tu ruta">
              <RouteForm id={FORM_ID} initial={outcome.suggested} reference={ctx?.reference ?? null} onSubmit={(t) => void submitManual(t)} />
              <p className="field-help">{startLine}. El objetivo lo ha calculado el código con tus cifras.</p>
              {usageLine}
            </section>
          </>
        ) : null}

        {phase === 'routes' && outcome?.kind === 'routes' ? (
          <>
            <section className="section" aria-label="Tus respuestas">
              <button
                type="button"
                className="receta"
                aria-label={`Tus respuestas: ${['foco', 'tiempo', 'salida', 'zona'].map((s) => answerText(s as Step, draft)).join(', ')}. Cambiar respuestas`}
                onClick={() => goTo('resumen')}
              >
                <span className="row-lead" data-m="elev" aria-hidden="true">
                  <Sparkles className="ic" />
                </span>
                <span className="row-main">
                  <span className="receta-figs">
                    <span>
                      <b>{answerText('tiempo', draft)}</b>
                    </span>
                  </span>
                  <span className="receta-meta">{`${answerText('foco', draft)}, ${startLine.charAt(0).toLowerCase()}${startLine.slice(1)}`}</span>
                </span>
                <span className="receta-go">
                  <span className="receta-go-t">Cambiar</span>
                  <ChevronRight className="ic" aria-hidden="true" />
                </span>
              </button>
            </section>
            {outcome.warnings.map((w) => (
              <Banner key={w} tone="warn">
                {w}
              </Banner>
            ))}
            <section className="section" aria-label="Propuestas">
              {outcome.shown.length > 0 ? (
                <>
                  <AiRoutesCarousel
                    shown={outcome.shown}
                    resetKey={outcome.at}
                    onIndexChange={setIndex}
                    onExport={exportRoute}
                    onMap={openMap}
                    onSplice={(card) => void spliceWith(card)}
                  />
                  <List inset>
                    <ListRow
                      icon={Download}
                      accent="time"
                      title="Cómo pasar el GPX al iGPSPORT"
                      meta="BSC200S, en tres pasos con la app"
                      onClick={() => setSheet('gpx')}
                    />
                    {current ? (
                      <ListRow
                        icon={Folder}
                        accent="dist"
                        title="Guardar en la biblioteca"
                        meta="Para empalmarla con otra ruta"
                        ariaLabel={`Guardar «${current.card.name}» en la biblioteca`}
                        onClick={() =>
                          void saveRoute(`${outcome.at}:${current.card.id}`, current.card.name, current.coords, current.file)
                        }
                      />
                    ) : null}
                  </List>
                </>
              ) : (
                <div className="card">
                  <StateView
                    icon={Route}
                    title="No ha salido ninguna ruta de asfalto"
                    text="Prueba con otras respuestas: otro tiempo u otro punto de salida."
                    action={
                      <button type="button" className="btn btn--secondary" onClick={() => goTo('resumen')}>
                        <SlidersHorizontal className="ic" aria-hidden="true" />
                        Cambiar respuestas
                      </button>
                    }
                  />
                </div>
              )}
            </section>
          </>
        ) : null}
      </Page>

      {phase === 'question' ? (
        <QuestionDock
          showPrev={stepIndex > 0}
          showNext={view !== 'resumen' && stepDone(view as Step, draft, home)}
          isSummary={view === 'resumen'}
          quotaOut={quotaOut}
          onPrev={prevStep}
          onNext={() => goTo(STEPS[stepIndex + 1])}
          onAsk={() => void ask()}
        />
      ) : null}
      {phase === 'error' ? (
        <Dock>
          <button type="button" className="btn btn--primary" onClick={() => void ask()} disabled={quotaOut}>
            <RefreshCw className="ic" aria-hidden="true" />
            Reintentar
          </button>
        </Dock>
      ) : null}
      {phase === 'fallback' ? (
        <Dock>
          <button type="submit" form={FORM_ID} className="btn btn--primary" disabled={quotaOut}>
            <Route className="ic" aria-hidden="true" />
            Generar 5 rutas
          </button>
        </Dock>
      ) : null}
      {phase === 'routes' && current ? (
        <Dock narrow>
          <button
            type="button"
            className="btn btn--primary"
            aria-label={`Exportar GPX de ${current.card.name}, ruta ${index + 1} de ${shown.length}`}
            onClick={() => exportRoute(current.card)}
          >
            <Download className="ic" aria-hidden="true" />
            Exportar GPX
            <span className="dock-tag" aria-hidden="true">
              {index + 1} de {shown.length}
            </span>
          </button>
        </Dock>
      ) : null}

      <Sheet
        open={sheet === 'ia'}
        onClose={() => setSheet(null)}
        title="Qué ve la IA"
        sub="Solo interviene en las rutas. Las carreteras las traza OpenRouteService."
        footer={
          <button type="button" className="btn btn--secondary btn--block" onClick={() => setSheet(null)}>
            Entendido
          </button>
        }
      >
        <div className="sheet-group">
          <p className="sheet-group-title">Ve estas cifras resumidas</p>
          <AiSeesList summary={ctx?.summary ?? null} knownRoutes={knownRoutes} />
        </div>
        <div className="sheet-group">
          <p className="sheet-group-title">No ve nunca</p>
          <AiNeverList />
        </div>
      </Sheet>

      <RouteMapSheet route={mapRoute} open={sheet === 'map'} onClose={() => setSheet(null)} onExport={exportRoute} />

      <GpxHelpSheet
        open={sheet === 'gpx'}
        onClose={() => setSheet(null)}
        gpx={gpx ?? (current ? { file: current.file, name: current.card.name } : null)}
      />
    </>
  );
}

function QuestionDock({
  showPrev,
  showNext,
  isSummary,
  quotaOut,
  onPrev,
  onNext,
  onAsk,
}: {
  showPrev: boolean;
  showNext: boolean;
  isSummary: boolean;
  quotaOut: boolean;
  onPrev: () => void;
  onNext: () => void;
  onAsk: () => void;
}) {
  if (!showPrev && !showNext && !isSummary) return null;
  return (
    <Dock>
      {showPrev ? (
        <button type="button" className="btn btn--secondary dock-prev" onClick={onPrev}>
          <ChevronLeft className="ic" aria-hidden="true" />
          {/* Por debajo de 380 px solo queda la flecha; el texto sigue siendo el nombre del botón (ia.css). */}
          <span className="dock-prev-t">Anterior</span>
        </button>
      ) : null}
      {showNext ? (
        <button type="button" className="btn btn--primary" onClick={onNext}>
          Siguiente
        </button>
      ) : null}
      {isSummary ? (
        <button type="button" className="btn btn--primary" onClick={onAsk} disabled={quotaOut}>
          {quotaOut ? <Clock className="ic" aria-hidden="true" /> : <Sparkles className="ic" aria-hidden="true" />}
          {quotaOut ? 'Cuota de hoy agotada' : 'Pedir rutas a la IA'}
        </button>
      ) : null}
    </Dock>
  );
}

const WAIT_STEPS: { stage: Stage; text: string }[] = [
  { stage: 'plan', text: 'Pensando objetivos…' },
  { stage: 'ors', text: 'Buscando carreteras…' },
  { stage: 'explain', text: 'Explicando cada ruta…' },
];

/** Espera: por qué paso va (la IA, ORS y otra vez la IA) y el botón de cancelar. */
function Waiting({
  stage,
  progress,
  onCancel,
}: {
  stage: Stage;
  progress?: { done: number; total: number } | null;
  onCancel: () => void;
}) {
  const at = WAIT_STEPS.findIndex((s) => s.stage === stage);
  const steps = progress !== undefined ? WAIT_STEPS.slice(1, 2) : WAIT_STEPS;
  return (
    <section className="section" aria-label="Preparando tus rutas">
      <div className="card gen-progress">
        <CyclingLoader compact />
        {progress ? (
          <div
            className="genbar"
            role="progressbar"
            aria-label="Progreso de la búsqueda"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((progress.done / progress.total) * 100)}
          >
            <i style={{ '--p': Math.min(1, progress.done / progress.total) } as CSSProperties} />
          </div>
        ) : null}
        <ol className="gensteps">
          {steps.map((s) => {
            const i = WAIT_STEPS.indexOf(s);
            const state = i < at ? 'done' : i === at ? 'now' : 'todo';
            const Icon = state === 'done' ? CircleCheck : state === 'now' ? LoaderCircle : Clock;
            return (
              <li key={s.stage} data-s={state} aria-current={state === 'now' ? 'step' : undefined}>
                <Icon className={state === 'now' ? 'ic spin' : 'ic'} aria-hidden="true" />
                <span>{s.text}</span>
              </li>
            );
          })}
        </ol>
        <p className="meta">Suele tardar unos 10 segundos.</p>
        <button type="button" className="btn btn--secondary btn--block" onClick={onCancel}>
          Cancelar
        </button>
      </div>
      <ul className="carousel" aria-hidden="true">
        <li>
          <RouteCardSkeleton />
        </li>
        <li>
          <RouteCardSkeleton />
        </li>
      </ul>
    </section>
  );
}

