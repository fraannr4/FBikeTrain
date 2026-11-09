import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router-dom';
import { countActivities, listActivities } from '../../db/repo';
import type { LatLng, Settings } from '../../domain/types';
import { computeReference, type UserReference } from '../../metrics/reference';
import type { Target } from '../../metrics/score';
import type { GenerateResult } from '../../routes/generator';
import { gpxFileName, toGpx } from '../../routes/gpx';
import { ORS_DAILY_LIMIT } from '../../routes/ors';
import { getOrsUsage, type OrsUsage } from '../../routes/orsUsage';
import { loadSettings, saveSettings } from '../../settings/settings';
import { Banner } from '../components/Banner';
import { Carousel } from '../components/Carousel';
import { CyclingLoader } from '../components/CyclingLoader';
import { DifficultyBars } from '../components/Chip';
import { Dock } from '../components/Dock';
import { List, ListRow } from '../components/ListRow';
import { Page } from '../components/Page';
import { RouteForm } from '../components/RouteForm';
import { Sheet } from '../components/Sheet';
import { Skeleton } from '../components/Skeleton';
import { StateView } from '../components/StateView';
import { useToast } from '../components/Toast';
import { formatCount } from '../format';
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Download,
  KeyRound,
  LoaderCircle,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  SlidersHorizontal,
  Sparkles,
  Upload,
} from '../icons';
import { RouteCard, RouteCardSkeleton, type RouteCardData } from '../routes/RouteCard';
import { RouteMapSheet } from '../routes/RouteMapSheet';
import {
  clockTime,
  defaultTarget,
  levelOf,
  nameRoutes,
  referenceRange,
  rejectSummary,
  renewsAt,
  toCardData,
} from '../routes/routeView';
import { START_TEXT, StartChoice, startPoint, type PickedPoints, type StartKind } from '../routes/StartChoice';
import { useRouteSearch, type SearchProgress } from '../routes/useRouteSearch';

const FORM_ID = 'rutas-form';
const GPX_HELP_KEY = 'fbt-gpx-ayuda';

type Request = { target: Target; kind: StartKind; start: LatLng | null };
type Run = Request & { start: LatLng; at: number; result: GenerateResult; cards: RouteCardData[] };
type Context = { settings: Settings; reference: UserReference | null; hasActivities: boolean };
type SheetId = 'gen' | 'gpx' | 'key' | 'map' | null;

/** Las últimas rutas de esta sesión: siguen ahí al volver a la pestaña (no se guardan en disco). */
let lastRun: Run | null = null;

/** Olvida las rutas de esta sesión (al borrar los datos, o entre pruebas). */
export function forgetRoutes(): void {
  lastRun = null;
}

function gpxHelpSeen(): boolean {
  try {
    const seen = localStorage.getItem(GPX_HELP_KEY) === '1';
    localStorage.setItem(GPX_HELP_KEY, '1');
    return seen;
  } catch {
    return true; // sin almacenamiento: la ayuda sigue a mano en la fila de abajo
  }
}

/** Descarga el GPX con un enlace temporal. `false` si el navegador no deja. */
function downloadGpx(name: string, coords: Run['result']['routes'][number]['coords'], file: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([toGpx(name, coords)], { type: 'application/gpx+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
}

const routesWord = (n: number) => (n === 1 ? '1 ruta' : `${formatCount(n)} rutas`);

/**
 * Rutas: lo que pides (distancia, desnivel, dificultad y de dónde sales), la generación con su
 * progreso y las propuestas en un carrusel con «Exportar GPX» sobre la barra. Sin clave de ORS,
 * lleva a Ajustes; con la cuota del día gastada, lo dice y deja exportar lo que ya hay.
 */
export function Rutas() {
  const toast = useToast();
  const search = useRouteSearch();
  const [ctx, setCtx] = useState<Context | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [usage, setUsage] = useState<OrsUsage | null>(null);
  const [request, setRequest] = useState<Request | null>(lastRun);
  const [kind, setKind] = useState<StartKind>(lastRun?.kind ?? 'casa');
  const [points, setPoints] = useState<PickedPoints>({ aqui: null, mapa: null });
  const [run, setRun] = useState<Run | null>(lastRun);
  const [sheet, setSheet] = useState<SheetId>(null);
  const [index, setIndex] = useState(0);
  const [gpx, setGpx] = useState<{ file: string; name: string } | null>(null);
  const [mapRoute, setMapRoute] = useState<RouteCardData | null>(null);
  const focusAfter = useRef<'loading' | 'results' | null>(null);
  const loadingTitle = useRef<HTMLHeadingElement>(null);
  const resultsTitle = useRef<HTMLHeadingElement>(null);

  const refreshUsage = useCallback(() => {
    getOrsUsage(Date.now()).then(setUsage, () => {});
  }, []);

  useEffect(() => {
    let alive = true;
    const now = Date.now();
    // Solo la ventana de la referencia: con miles de salidas, leerlas todas tarda segundos en el móvil.
    Promise.all([loadSettings(), listActivities(referenceRange(now)), countActivities(), getOrsUsage(now)]).then(
      ([settings, acts, total, u]) => {
        if (!alive) return;
        const reference = computeReference(acts, now);
        setCtx({ settings, reference, hasActivities: total > 0 });
        setUsage(u);
        if (!lastRun) {
          setRequest({ target: defaultTarget(reference), kind: settings.home ? 'casa' : 'mapa', start: null });
          setKind(settings.home ? 'casa' : 'mapa');
        }
      },
      () => alive && setLoadFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  const home = ctx?.settings.home ?? null;
  const hasKey = !!ctx && ctx.settings.ors.apiKey.trim() !== '';
  const spent = !!usage && usage.count >= ORS_DAILY_LIMIT;
  const quotaOut = spent || search.errorKind === 'quota_day';
  const renew = spent && usage ? renewsAt(usage.windowStart, Date.now()) : null;
  const start = startPoint(kind, home, points);

  const failed = !search.busy && search.error !== null && !(search.errorKind === 'quota_day' && run);
  const phase = !ctx
    ? 'boot'
    : !hasKey
      ? 'nokey'
      : search.busy
        ? 'loading'
        : failed
          ? 'error'
          : run
            ? 'results'
            : 'empty';

  useEffect(() => {
    const want = focusAfter.current;
    if (want === 'loading' && phase === 'loading') loadingTitle.current?.focus();
    if (want === 'results' && phase === 'results') {
      resultsTitle.current?.focus();
      focusAfter.current = null;
    }
  }, [phase]);

  const go = async (req: Request & { start: LatLng }) => {
    focusAfter.current = 'loading';
    const result = await search.run(req.start, req.target);
    refreshUsage();
    if (!result) return;
    const names = nameRoutes(result.routes, req.start);
    const next: Run = { ...req, at: Date.now(), result, cards: result.routes.map((r, i) => toCardData(r, names[i])) };
    lastRun = next;
    setRun(next);
    setIndex(0);
    focusAfter.current = 'results';
    if (result.routes.length > 0) {
      toast(`${result.routes.length === 1 ? '1 ruta generada' : `${result.routes.length} rutas generadas`}`, { tone: 'good' });
    }
  };

  const submit = (target: Target) => {
    if (!start || quotaOut) return;
    const req = { target, kind, start };
    setRequest(req);
    setSheet(null);
    void go(req);
  };

  const retry = () => {
    if (request?.start && !quotaOut) void go({ ...request, start: request.start });
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

  const exportRoute = (card: RouteCardData) => {
    const route = run?.result.routes.find((r) => r.id === card.id);
    if (!route) return;
    const file = gpxFileName(route);
    if (!downloadGpx(card.name, route.coords, file)) {
      toast('Este navegador no deja descargar el GPX.', { tone: 'error' });
      return;
    }
    setGpx({ file, name: card.name });
    if (!gpxHelpSeen()) setSheet('gpx');
    else toast(`GPX exportado: ${file}`, { tone: 'good', action: { label: 'Cómo pasarlo', onClick: () => setSheet('gpx') } });
  };

  const cards = run?.cards ?? [];
  const current = cards[Math.min(index, cards.length - 1)] ?? null;
  const gpxInfo =
    gpx ??
    (current && run
      ? { file: gpxFileName(run.result.routes.find((r) => r.id === current.id) ?? current), name: current.name }
      : null);

  const openMap = useCallback((c: RouteCardData) => {
    setMapRoute(c);
    setSheet('map');
  }, []);

  // Sin punto de salida, el botón dice qué falta (la ayuda de «Sale de» queda tapada por el dock).
  const generateLabel = quotaOut ? (
    <>
      <Clock className="ic" aria-hidden="true" />
      {renew ? `Cuota agotada, vuelve ${renew}` : 'Cuota de hoy agotada'}
    </>
  ) : !start ? (
    <>
      {kind === 'aqui' ? <Navigation className="ic" aria-hidden="true" /> : <MapPin className="ic" aria-hidden="true" />}
      {kind === 'aqui' ? 'Falta tu ubicación' : 'Elige el inicio en el mapa'}
    </>
  ) : (
    <>
      <Route className="ic" aria-hidden="true" />
      Generar 5 rutas
    </>
  );
  const canGenerate = !!start && !quotaOut;
  const generateButton = (cls: string) => (
    <button type="submit" form={FORM_ID} className={quotaOut ? `${cls} btn--quota` : cls} disabled={!canGenerate}>
      {generateLabel}
    </button>
  );

  const form = request ? (
    <RouteForm id={FORM_ID} initial={request.target} reference={ctx?.reference ?? null} onSubmit={submit}>
      <StartChoice
        home={home}
        kind={kind}
        points={points}
        onKind={setKind}
        onPick={(k, p) => setPoints((ps) => ({ ...ps, [k]: p }))}
        onSaveHome={(p) => void saveHome(p)}
      />
    </RouteForm>
  ) : null;

  const usageLine = usage ? (
    <p className="field-help rutas-usage">
      {`Consultas ORS hoy: ${formatCount(Math.min(usage.count, ORS_DAILY_LIMIT))} de ${formatCount(ORS_DAILY_LIMIT)} (cuenta de este navegador)`}
    </p>
  ) : null;

  // En el arranque, la cabecera ya ocupa lo mismo que con el formulario: nada salta al llegar.
  const booting = phase === 'boot' && !loadFailed;
  let kicker: ReactNode;
  if (booting) kicker = <Skeleton width="11em" className="kicker-sk" />;
  else if (phase === 'nokey') kicker = 'Falta un paso';
  else if (phase === 'loading') kicker = 'Generando…';
  else if (phase === 'error') kicker = <KickerState icon="error">No se han podido generar</KickerState>;
  else if (quotaOut && (phase === 'empty' || phase === 'results'))
    kicker = <KickerState icon="warn">{renew ? `Cuota agotada hasta ${renew.replace(/^a /, '')}` : 'Cuota de hoy agotada'}</KickerState>;
  else if (phase === 'empty') kicker = 'Aún no has generado rutas';

  const showRecipe = !!request && (phase === 'results' || phase === 'loading' || phase === 'error');
  const hasRef = !!ctx?.reference;

  return (
    <>
      <Page
        title="Rutas"
        className="page--rutas"
        kicker={kicker}
        busy={phase === 'boot' || phase === 'loading'}
        lead={
          phase === 'empty' || booting ? (
            <>
              Elige distancia y desnivel. Te propondremos <b>hasta 5 rutas de carretera</b>, con su forma y su perfil.
            </>
          ) : undefined
        }
        actions={
          <Link className="icon-btn" to="/rutas/ia" aria-label="Pregunta a la IA">
            <Sparkles className="ic" aria-hidden="true" />
          </Link>
        }
      >
        <section className="section"><List inset><ListRow to="/rutas/biblioteca" icon={Upload} accent="dist" title="Abrir una ruta de Wikiloc o un GPX" meta="Analiza, recorta, modifica y exporta tu propia versión" /></List></section>
        {loadFailed ? (
          <section className="section card">
            <StateView
              icon={CircleAlert}
              tone="error"
              level={2}
              title="No se han podido leer tus ajustes"
              text="El almacenamiento del navegador no responde. Recarga la página."
            />
          </section>
        ) : null}

        {quotaOut && (phase === 'empty' || phase === 'results') ? (
          <Banner tone="warn">
            <b>Cuota de hoy agotada.</b>{' '}
            {renew
              ? `Tu clave gratuita de OpenRouteService ha llegado al límite diario y se renueva ${renew}.`
              : 'Tu clave gratuita de OpenRouteService ha llegado al límite diario. Se renueva 24 h después de la primera consulta del día.'}
            {run && run.cards.length > 0 ? ' Tus últimas rutas siguen aquí y puedes exportarlas.' : ''}
          </Banner>
        ) : null}

        {ctx && !ctx.hasActivities && (phase === 'empty' || phase === 'results') ? (
          <Banner
            action={
              <Link className="btn btn--ghost" to="/importar">
                <Upload className="ic" aria-hidden="true" />
                Importar salidas
              </Link>
            }
          >
            <b>Importa tus salidas para ajustar las rutas a tu nivel.</b> Mientras, las rutas salen sin dificultad ni tiempo
            para ti.
          </Banner>
        ) : null}

        {showRecipe && request ? (
          <section className="section rutas-recipe" aria-label="Tu petición">
            <Recipe request={request} reference={ctx?.reference ?? null} at={phase === 'results' ? run?.at : undefined} onOpen={() => setSheet('gen')} />
          </section>
        ) : null}

        {phase === 'nokey' ? (
          <section className="section card" aria-label="Falta la clave de rutas">
            <StateView
              icon={KeyRound}
              level={2}
              title="Falta tu clave de rutas"
              text="Las rutas se calculan con OpenRouteService, gratis con tu propia clave. Pégala en Ajustes y vuelve aquí."
              action={
                <div className="rutas-actions">
                  <Link className="btn btn--primary" to="/ajustes?abrir=claves">
                    <SlidersHorizontal className="ic" aria-hidden="true" />
                    Ir a Ajustes
                  </Link>
                  <button type="button" className="btn btn--ghost" onClick={() => setSheet('key')}>
                    Cómo conseguirla
                  </button>
                </div>
              }
            />
          </section>
        ) : null}

        {booting ? <GeneratorSkeleton /> : null}

        {phase === 'empty' && form ? (
          <section className="section card gen-inline" aria-label="Elige tu ruta">
            {form}
            {usageLine}
          </section>
        ) : null}

        {phase === 'loading' ? (
          <Generating progress={search.progress} kind={request?.kind ?? kind} titleRef={loadingTitle} onCancel={search.cancel} />
        ) : null}

        {phase === 'error' ? (
          <section className="section card" aria-label="Error al generar">
            <StateView
              icon={CircleAlert}
              tone="error"
              level={2}
              title="No se han podido generar las rutas"
              text={search.error}
              action={
                quotaOut ? (
                  <button type="button" className="btn btn--secondary" onClick={() => setSheet('gen')}>
                    <SlidersHorizontal className="ic" aria-hidden="true" />
                    Cambiar petición
                  </button>
                ) : (
                  <button type="button" className="btn btn--secondary" onClick={retry}>
                    <RefreshCw className="ic" aria-hidden="true" />
                    Reintentar
                  </button>
                )
              }
            />
          </section>
        ) : null}

        {phase === 'results' && run ? (
          <section className="section rutas-res" aria-labelledby="r-res-t">
            <div className="section-h">
              <h2 className="section-title" id="r-res-t" tabIndex={-1} ref={resultsTitle}>
                {cards.length === 0 ? 'Sin rutas' : `${routesWord(cards.length)}${hasRef ? ' para ti' : ''}`}
              </h2>
            </div>
            {run.result.stoppedBy && cards.length > 0 ? (
              <Banner tone="warn">
                {`La búsqueda se ha cortado: han llegado ${routesWord(cards.length)}. ${run.result.stoppedBy.message}`}
              </Banner>
            ) : null}
            {cards.length > 0 ? (
              <Carousel
                label="Rutas generadas"
                items={cards}
                getKey={(c) => c.id}
                resetKey={run.at}
                onIndexChange={setIndex}
                renderItem={(c, i) => (
                  <RouteCard
                    route={c}
                    variant={i === 0 ? 'best' : 'normal'}
                    rank={{ n: i + 1, of: cards.length }}
                    className="rcard--docked"
                    onDownload={exportRoute}
                    onMap={openMap}
                  />
                )}
              />
            ) : (
              <div className="card">
                <StateView
                  icon={Route}
                  title="No ha salido ninguna ruta"
                  text={rejectSummary(run.result.rejected)}
                  action={
                    <button type="button" className="btn btn--secondary" onClick={() => setSheet('gen')}>
                      <SlidersHorizontal className="ic" aria-hidden="true" />
                      Cambiar petición
                    </button>
                  }
                />
              </div>
            )}
            {cards.length > 0 ? (
              <List inset>
                <ListRow
                  icon={Download}
                  accent="time"
                  title="Cómo pasar el GPX al iGPSPORT"
                  meta="BSC200S, en tres pasos con la app"
                  onClick={() => setSheet('gpx')}
                />
              </List>
            ) : null}
          </section>
        ) : null}

        {phase !== 'loading' ? (
          // La otra forma de pedir rutas, como en el prototipo (rutas.html, #r-ia).
          <section className="section" aria-label="Rutas con IA">
            <List inset>
              <ListRow
                to="/rutas/ia"
                icon={Sparkles}
                accent="elev"
                title="Pregunta a la IA"
                meta="Cuatro preguntas y te propone rutas explicadas"
              />
            </List>
          </section>
        ) : null}
      </Page>

      {phase === 'empty' && request ? <Dock>{generateButton('btn btn--primary')}</Dock> : null}
      {phase === 'results' && current ? (
        <Dock narrow>
          <button
            type="button"
            className="btn btn--primary"
            aria-label={`Exportar GPX de ${current.name}, ruta ${index + 1} de ${cards.length}`}
            onClick={() => exportRoute(current)}
          >
            <Download className="ic" aria-hidden="true" />
            Exportar GPX
            <span className="dock-tag" aria-hidden="true">
              {index + 1} de {cards.length}
            </span>
          </button>
        </Dock>
      ) : null}

      <Sheet
        open={sheet === 'gen' && !!request}
        onClose={() => setSheet(null)}
        title="Qué ruta quieres"
        footer={generateButton('btn btn--primary btn--block btn--lg')}
      >
        {form}
        {usageLine}
      </Sheet>

      <RouteMapSheet route={mapRoute} open={sheet === 'map'} onClose={() => setSheet(null)} onExport={exportRoute} />

      <Sheet
        open={sheet === 'gpx'}
        onClose={() => setSheet(null)}
        title="Llévala al iGPSPORT"
        sub={gpxInfo ? `Para el BSC200S. El archivo es ${gpxInfo.file}.` : 'Para el BSC200S.'}
        footer={
          <button type="button" className="btn btn--secondary btn--block" onClick={() => setSheet(null)}>
            Entendido
          </button>
        }
      >
        <ol className="howto">
          <li>
            <span>
              Pulsa <b>Exportar GPX</b>. El archivo se guarda en Descargas.
            </span>
          </li>
          <li>
            <span>
              Abre la app <b>iGPSPORT</b>, ve a <b>Rutas</b> e importa el archivo.
            </span>
          </li>
          <li>
            <span>
              Sincroniza el BSC200S. En el ciclocomputador, abre <b>Rutas</b> y elige{' '}
              {gpxInfo ? `«${gpxInfo.name}»` : 'la ruta'}.
            </span>
          </li>
        </ol>
      </Sheet>

      <Sheet
        open={sheet === 'key'}
        onClose={() => setSheet(null)}
        title="Tu clave de rutas"
        sub="Gratis y en dos minutos. La clave se queda en este navegador."
        footer={
          <Link className="btn btn--primary btn--block" to="/ajustes?abrir=claves">
            <SlidersHorizontal className="ic" aria-hidden="true" />
            Ir a Ajustes
          </Link>
        }
      >
        <ol className="howto">
          <li>
            <span>
              Crea una cuenta gratuita en <b>openrouteservice.org</b>.
            </span>
          </li>
          <li>
            <span>En tu panel, pide una clave del plan gratuito.</span>
          </li>
          <li>
            <span>
              Cópiala y pégala en <b>Ajustes</b>, en el apartado <b>Claves</b>.
            </span>
          </li>
        </ol>
      </Sheet>
    </>
  );
}

/** Alto del control de cada grupo del generador (distancia, desnivel, dificultad, sale de) a 390 px. */
const SK_CONTROLS = [74, 46, 74, 75];

/** El generador en carga, con su forma y su alto: la fila de la IA no salta cuando llega el formulario. */
function GeneratorSkeleton() {
  return (
    <section className="section card gen-inline gen-sk" aria-busy="true">
      <span className="sr-only">Cargando el generador</span>
      <div className="gen" aria-hidden="true">
        {SK_CONTROLS.map((h, i) => (
          <div className="gen-group" key={i}>
            <Skeleton width="34%" height={21} />
            <Skeleton variant="box" height={h} />
          </div>
        ))}
        <Skeleton variant="box" height={64} />
      </div>
      <div className="sk-stack gen-sk-help" aria-hidden="true">
        <Skeleton width="92%" />
        <Skeleton width="58%" />
      </div>
    </section>
  );
}

function KickerState({ icon, children }: { icon: 'warn' | 'error'; children: ReactNode }) {
  const Icon = icon === 'warn' ? Clock : CircleAlert;
  return (
    <span className={`kicker-state kicker-state--${icon}`}>
      <Icon className="ic" aria-hidden="true" />
      {children}
    </span>
  );
}

/** Lo que has pedido, en una fila que abre el generador en una hoja. */
function Recipe({
  request,
  reference,
  at,
  onOpen,
}: {
  request: Request;
  reference: UserReference | null;
  at?: number;
  onOpen: () => void;
}) {
  const { target } = request;
  const elev = target.elevGainM ?? 0;
  const level = levelOf({ distanceM: target.distanceM, elevGainM: elev }, reference);
  const meta = `${START_TEXT[request.kind]}, circular${target.preferNew ? ', carretera nueva' : ''}${
    at !== undefined ? ` · hoy ${clockTime(at)}` : ''
  }`;
  return (
    <button type="button" className="receta" aria-haspopup="dialog" onClick={onOpen}>
      <span className="row-lead" data-m="dist" aria-hidden="true">
        <SlidersHorizontal className="ic" />
      </span>
      <span className="row-main">
        <span className="receta-figs">
          <span>
            <b>{formatCount(target.distanceM / 1000)}</b>km
          </span>
          <span>
            <b>{formatCount(elev)}</b>m
          </span>
          <span>
            <DifficultyBars level={level} />
            {level}
          </span>
        </span>
        <span className="receta-meta">{meta}</span>
      </span>
      <span className="receta-go">
        <span className="receta-go-t">Cambiar</span>
        <ChevronRight className="ic" aria-hidden="true" />
      </span>
    </button>
  );
}

const STEP_PLACE: Record<StartKind, string> = { casa: 'Casa', aqui: 'ti', mapa: 'ese punto' };

/** Generando: cuántos recorridos lleva ORS, por qué paso va y el botón de cancelar. */
function Generating({
  progress,
  kind,
  titleRef,
  onCancel,
}: {
  progress: SearchProgress | null;
  kind: StartKind;
  titleRef: Ref<HTMLHeadingElement>;
  onCancel: () => void;
}) {
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 1;
  const step = done === 0 ? 0 : done < total ? 1 : 2;
  const frac = Math.min(1, done / total);
  const steps = [
    `Buscando carreteras alrededor de ${STEP_PLACE[kind]}`,
    `Trazando ${formatCount(total)} recorridos con OpenRouteService`,
    'Coloreando los perfiles por pendiente',
  ];
  return (
    <section className="section" aria-labelledby="r-carga-t">
      <div className="card gen-progress">
        <div className="card-h">
          <span className="card-ic" data-m="dist" aria-hidden="true">
            <Route className="ic" />
          </span>
          <h2 className="card-title" id="r-carga-t" tabIndex={-1} ref={titleRef}>
            Generando rutas
          </h2>
        </div>
        <CyclingLoader compact />
        <div className="gen-progress-h">
          <p className="gen-progress-v">
            {formatCount(done)} <span className="u">de {formatCount(total)}</span>
          </p>
          <p className="meta">recorridos trazados</p>
        </div>
        <div
          className="genbar"
          role="progressbar"
          aria-label="Progreso de la generación"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(frac * 100)}
        >
          <i style={{ '--p': frac } as CSSProperties} />
        </div>
        <ol className="gensteps">
          {steps.map((text, i) => {
            const state = i < step ? 'done' : i === step ? 'now' : 'todo';
            const Icon = state === 'done' ? CircleCheck : state === 'now' ? LoaderCircle : Clock;
            return (
              <li key={text} data-s={state} aria-current={state === 'now' ? 'step' : undefined}>
                <Icon className={state === 'now' ? 'ic spin' : 'ic'} aria-hidden="true" />
                <span>{text}</span>
              </li>
            );
          })}
        </ol>
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
