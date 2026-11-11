import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { isAbort } from '../../ai/abort';
import { useAccount } from '../../auth/AccountBoundary';
import type { Settings } from '../../domain/types';
import { adaptRoute, type AdaptedRoute, type AdaptMode } from '../../routes/adapt';
import { parseReferenceRoute, RouteLibraryError, routePointsToGpx, saveAdaptedRoute, type ParsedReferenceRoute } from '../../routes/library';
import { OrsError } from '../../routes/ors';
import { chooseOrsAccess, sharedOrsEnabled } from '../../routes/orsProxy';
import { loadReceivedTrack, loadWikilocRequest, type WikilocRequest, type WikilocTrackMessage } from '../../routes/wikilocNearby';
import { loadSettings } from '../../settings/settings';
import { Banner } from '../components/Banner';
import { CyclingLoader } from '../components/CyclingLoader';
import { Page } from '../components/Page';
import { RideMap } from '../components/RideMap';
import { SegmentedControl } from '../components/SegmentedControl';
import { StateView } from '../components/StateView';
import { useToast } from '../components/Toast';
import { formatKm, formatMeters } from '../format';
import { CircleAlert, Download, ExternalLink, Flag, Folder, House, KeyRound, RefreshCw, Route, SlidersHorizontal } from '../icons';
import { GpxHelpSheet } from '../routes/gpxExport';
import { sendGpx } from '../routes/sendGpx';
import '../styles/library.css';
import '../styles/wikiloc.css';

type Loaded =
  | { kind: 'none' }
  | { kind: 'unreadable'; message: string }
  | { kind: 'ready'; track: WikilocTrackMessage; original: ParsedReferenceRoute; request: WikilocRequest | null; settings: Settings };
type Run = { mode: AdaptMode; result: AdaptedRoute } | { mode: AdaptMode; error: string };

const MODES: { value: AdaptMode; label: string; icon: typeof House }[] = [
  { value: 'mi-inicio', label: 'Desde mi inicio', icon: House },
  { value: 'inicio-ruta', label: 'Desde el inicio de la ruta', icon: Flag },
];
const UNEXPECTED = 'Ha fallado algo inesperado al adaptar la ruta. Vuelve a probar.';

const nearText = (m: number) => (m < 1000 ? formatMeters(m) : formatKm(m, 1));
const fileName = (r: AdaptedRoute) => `wikiloc-adaptada-${Math.round(r.distanceM / 1000)}km.gpx`;

/**
 * Adaptación de la ruta recibida de Wikiloc: sale de tu inicio o del de la ruta, se acerca a la distancia
 * pedida y se valida. Enseña mapa CyclOSM, cifras y avisos; una adaptación rechazada no se guarda ni se envía.
 */
export function WikilocAdaptar() {
  const account = useAccount();
  const toast = useToast();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mode, setMode] = useState<AdaptMode>('mi-inicio');
  const [runs, setRuns] = useState<Partial<Record<AdaptMode, Run>>>({});
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [help, setHelp] = useState<{ file: string; name: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([loadReceivedTrack(), loadWikilocRequest(), loadSettings()])
      .then(([received, request, settings]) => {
        if (!alive) return;
        if (received.state !== 'ok') {
          setLoaded({ kind: 'none' });
          return;
        }
        const { track } = received;
        try {
          const original = parseReferenceRoute(track.gpx, `wikiloc-${track.id}.gpx`, track.url);
          setLoaded({ kind: 'ready', track, original, request, settings });
        } catch (e) {
          setLoaded({ kind: 'unreadable', message: e instanceof RouteLibraryError ? e.message : 'El fichero no es un GPX válido.' });
        }
      })
      .catch(() => alive && setLoadFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const ready = loaded?.kind === 'ready' ? loaded : null;
  const sharedOrs = sharedOrsEnabled() && account !== null;
  const hasKey = !!ready && (sharedOrs || ready.settings.ors.apiKey.trim() !== '');
  const orsAccess = useMemo(() => (ready ? chooseOrsAccess(ready.settings.ors.apiKey, account) : null), [ready, account]);
  const current = runs[mode];
  const canAdapt = !!ready?.request && hasKey && !!orsAccess;

  useEffect(() => {
    if (!ready?.request || !orsAccess || !canAdapt || current) return;
    const controller = new AbortController();
    const { request, original } = ready;
    adaptRoute(
      original.points,
      { start: request.start, mode, targetKm: request.distanceKm, ...(request.elevGainM !== null ? { targetGainM: request.elevGainM } : {}) },
      { ors: orsAccess, signal: controller.signal },
    ).then(
      (result) => !controller.signal.aborted && setRuns((r) => ({ ...r, [mode]: { mode, result } })),
      (e: unknown) => {
        if (controller.signal.aborted || isAbort(e)) return;
        const message = e instanceof OrsError || e instanceof RangeError ? e.message : UNEXPECTED;
        setRuns((r) => ({ ...r, [mode]: { mode, error: message } }));
      },
    );
    return () => controller.abort();
  }, [ready, orsAccess, canAdapt, mode, current, attempt]);

  const retry = () => {
    setRuns((r) => ({ ...r, [mode]: undefined }));
    setAttempt((n) => n + 1);
  };

  const result = current && 'result' in current ? current.result : null;
  const usable = result && !result.rejected ? result : null;

  const save = async () => {
    if (!ready || !usable || saving) return;
    setSaving(true);
    try {
      const route = await saveAdaptedRoute(ready.original, usable.coords, { name: ready.track.nombre, sourceUrl: ready.track.url, author: ready.track.autor });
      setSavedId(route.id);
      toast('Guardada en la biblioteca', { tone: 'good' });
    } catch (e) {
      toast(e instanceof RouteLibraryError ? e.message : 'No se ha podido guardar la ruta. Vuelve a probar.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const send = async () => {
    if (!ready || !usable) return;
    const name = ready.track.nombre;
    const file = fileName(usable);
    const outcome = await sendGpx(routePointsToGpx(name, usable.coords), file, name);
    if (outcome === 'failed') toast('Este navegador no deja descargar el GPX.', { tone: 'error' });
    if (outcome === 'downloaded') {
      setHelp({ file, name });
      toast(`GPX descargado: ${file}`, { tone: 'good', action: { label: 'Cómo pasarlo', onClick: () => setHelpOpen(true) } });
    }
  };

  let body;
  if (loadFailed) {
    body = (
      <section className="section card">
        <StateView icon={CircleAlert} tone="error" level={2} title="No se han podido leer tus datos" text="El almacenamiento del navegador no responde. Recarga la página." />
      </section>
    );
  } else if (!loaded) {
    body = null;
  } else if (loaded.kind === 'none') {
    body = (
      <section className="section card">
        <StateView
          icon={Route}
          level={2}
          title="No hay ninguna ruta recibida"
          text="En Rutas de Wikiloc cerca, pulsa «Adaptar esta ruta» y, en su ficha de Wikiloc, toca el marcador «→ FBikeTrain». Las rutas recibidas se borran a los 7 días."
          action={<WikilocLink />}
        />
      </section>
    );
  } else if (loaded.kind === 'unreadable') {
    body = (
      <section className="section card">
        <StateView icon={CircleAlert} tone="error" level={2} title="El GPX recibido no se puede usar" text={loaded.message} action={<WikilocLink />} />
      </section>
    );
  } else {
    const { track, request } = loaded;
    body = (
      <>
        <section className="section card library-panel" aria-labelledby="wk-ruta">
          <h2 className="card-title" id="wk-ruta">
            {track.nombre}
          </h2>
          <a className="btn btn--ghost btn--wrap" href={track.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="ic" aria-hidden="true" />
            {track.autor ? `Ver en Wikiloc · ${track.autor}` : 'Ver en Wikiloc'}
          </a>
          {request ? (
            <p className="wk-recipe">
              {`Para ${formatKm(request.distanceKm * 1000)}${request.elevGainM !== null ? ` y ${formatMeters(request.elevGainM)} de desnivel` : ''}. `}
              <Link to="/rutas/wikiloc">Cambiar</Link>
            </p>
          ) : null}
        </section>

        {!request ? (
          <section className="section card">
            <StateView
              icon={SlidersHorizontal}
              level={2}
              title="Falta lo que quieres hacer hoy"
              text="Escribe la distancia y elige tu inicio en Rutas de Wikiloc cerca. La ruta recibida sigue guardada."
              action={<WikilocLink />}
            />
          </section>
        ) : !hasKey ? (
          <section className="section card">
            <StateView
              icon={KeyRound}
              level={2}
              title="Falta tu clave de rutas"
              text="Los tramos de unión se calculan con OpenRouteService, gratis con tu propia clave. Pégala en Ajustes y vuelve aquí."
              action={
                <Link className="btn btn--primary" to="/ajustes?abrir=claves">
                  <SlidersHorizontal className="ic" aria-hidden="true" />
                  Ir a Ajustes
                </Link>
              }
            />
          </section>
        ) : (
          <>
            <section className="section" aria-label="Salida">
              <SegmentedControl label="Salida" className="wk-salida" options={MODES} value={mode} onChange={setMode} />
              <p className="field-help">
                {mode === 'mi-inicio'
                  ? 'Empieza y acaba en tu inicio, rotando el circuito o uniéndolo por carretera.'
                  : 'La ruta tal cual, solo con recorte o alargado.'}
              </p>
            </section>
            {!current ? (
              <section className="section card library-panel" role="status">
                <CyclingLoader compact />
                <p>Adaptando la ruta: rotar, unir con carreteras y ajustar la distancia…</p>
              </section>
            ) : 'error' in current ? (
              <section className="section card">
                <StateView
                  icon={CircleAlert}
                  tone="error"
                  level={2}
                  title="No se ha podido adaptar la ruta"
                  text={current.error}
                  action={
                    <button type="button" className="btn btn--secondary" onClick={retry}>
                      <RefreshCw className="ic" aria-hidden="true" />
                      Reintentar
                    </button>
                  }
                />
              </section>
            ) : (
              <AdaptedView result={current.result} mode={mode} />
            )}
            {usable ? (
              <section className="section card library-panel" aria-label="Llévatela">
                <button type="button" className="btn btn--primary btn--block" onClick={() => void send()}>
                  <Download className="ic" aria-hidden="true" />
                  Enviar al iGPSPORT
                </button>
                <button type="button" className="btn btn--secondary btn--block" disabled={saving || savedId !== null} onClick={() => void save()}>
                  <Folder className="ic" aria-hidden="true" />
                  {savedId ? 'Guardada en la biblioteca' : 'Guardar en la biblioteca'}
                </button>
                <p className="help">
                  En Android se abre la hoja de compartir para elegir la app de iGPSPORT; en el ordenador, se descarga el GPX.
                </p>
              </section>
            ) : null}
          </>
        )}
      </>
    );
  }

  return (
    <>
      <Page title="Adaptar ruta de Wikiloc" back="/rutas/wikiloc" variant="narrow" className="page--wikiloc" busy={!loaded && !loadFailed}>
        {body}
      </Page>
      <GpxHelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} gpx={help} />
    </>
  );
}

function WikilocLink() {
  return (
    <Link className="btn btn--secondary" to="/rutas/wikiloc">
      Ir a Rutas de Wikiloc cerca
    </Link>
  );
}

function AdaptedView({ result, mode }: { result: AdaptedRoute; mode: AdaptMode }) {
  return (
    <section className="section card library-panel" aria-label="Ruta adaptada">
      {result.rejected ? (
        <Banner tone="error">
          <b>No se puede usar esta adaptación.</b> {result.rejected} Prueba con la otra salida o elige otra ruta.
        </Banner>
      ) : null}
      <RideMap points={result.coords} label="Mapa de la ruta adaptada" className="wk-map" interactive />
      <dl className="library-metrics wk-metrics">
        <div>
          <dt>Distancia</dt>
          <dd>{formatKm(result.distanceM)}</dd>
        </div>
        <div>
          <dt>Desnivel</dt>
          <dd>{result.elevGainM === null ? 'Sin altitud' : formatMeters(result.elevGainM)}</dd>
        </div>
        <div>
          <dt>Conectores</dt>
          <dd>{formatKm(result.connectorM)}</dd>
        </div>
        <div>
          <dt>Pasa a</dt>
          <dd>{nearText(result.passesNearM)}</dd>
        </div>
      </dl>
      <p className="help">
        {`La ruta original pasa a ${nearText(result.passesNearM)} de tu inicio.`}
        {mode === 'mi-inicio' && result.rotated ? ' Se ha rotado el circuito para empezar y acabar en tu inicio.' : ''}
        {' Los conectores son las carreteras de unión y de regreso que calcula OpenRouteService.'}
      </p>
      {result.warnings.length > 0 ? (
        <ul className="wk-warnings" aria-label="Avisos">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
