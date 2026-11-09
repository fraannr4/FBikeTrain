import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { isAbort } from '../../ai/abort';
import { createSharedSpliceAdvisor, SHARED_AI_ENABLED } from '../../ai/sharedClient';
import { adviseSplice, type SpliceAdvice } from '../../ai/spliceAdvisor';
import { useAccount } from '../../auth/AccountBoundary';
import { listActivities } from '../../db/repo';
import { computeReference } from '../../metrics/reference';
import { listReferenceRoutes, RouteLibraryError, type ReferenceRoute } from '../../routes/library';
import { ORS_DAILY_LIMIT, ORS_MINUTE_LIMIT, OrsError } from '../../routes/ors';
import { chooseOrsAccess, hasOrsAccess, sessionToken, SHARED_ORS_LIMITS, sharedOrsEnabled } from '../../routes/orsProxy';
import { orsConnectors, spliceGpx, spliceRoutes, type DiscardReason, type SpliceOption, type SpliceResult } from '../../routes/splice';
import { loadSettings } from '../../settings/settings';
import type { Settings } from '../../domain/types';
import { Page } from '../components/Page';
import { RideMap, type MapOverlay } from '../components/RideMap';
import { formatCount, formatDuration, formatKm, formatMeters, formatNumber } from '../format';
import { Download } from '../icons';
import { referenceRange } from '../routes/routeView';
import '../styles/library.css';
import '../styles/splice.css';

const REASON_TEXT: Record<DiscardReason, string> = {
  'sin carretera': 'sin carretera entre las rutas',
  autopista: 'por autopista',
  'carretera principal': 'con demasiada carretera principal',
  'sin asfaltar': 'sin asfaltar',
  pistas: 'por pistas',
  'firme desconocido': 'con firme desconocido',
  salto: 'que no llegan a las rutas',
  'demasiados puntos': 'demasiado largas para un solo track',
  'sin datos': 'sin datos de vía',
};

/** «Ningún empalme válido: 2 conectores sin carretera entre las rutas, 1 por autopista». */
function noOptionsText(discarded: SpliceResult['discarded']): string {
  const counts = new Map<DiscardReason, number>();
  for (const { reason } of discarded) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const parts = [...counts].map(([reason, n]) => `${n} ${n === 1 ? 'conector' : 'conectores'} ${REASON_TEXT[reason]}`);
  return `No hay un empalme válido para bici de carretera${parts.length ? `: ${parts.join(', ')}` : ''}. Prueba con otras rutas o recorta sus extremos en la biblioteca.`;
}

/** Los errores de ORS (cuota, red) y de tamaño del recorrido ya traen un texto para el usuario. */
const failure = (e: unknown) => (e instanceof OrsError || e instanceof RouteLibraryError ? e.message : 'No se ha podido calcular el empalme. Vuelve a probar.');

type Names = { A: string; B: string };

function title(o: SpliceOption, names: Names): string {
  const [first, second] = o.order === 'AB' ? (['A', 'B'] as const) : (['B', 'A'] as const);
  const reversed = [first, second].filter(k => o.reversed[k]).map(k => `«${names[k]}» al revés`);
  return `Primero «${names[first]}», luego «${names[second]}»${reversed.length ? ` · ${reversed.join(', ')}` : ''}`;
}

function OptionCard({ option, names, advice, selected, onSelect }: { option: SpliceOption; names: Names; advice: SpliceAdvice | null; selected: boolean; onSelect: () => void }) {
  const recommended = advice?.id === option.id;
  return (
    <li className={`card splice-option${selected ? ' splice-option--selected' : ''}`}>
      <div className="splice-option-head">
        {recommended && <span className="chip splice-badge">Recomendada</span>}
        {option.alternativeOf && <span className="chip">Alternativa parecida</span>}
      </div>
      <h3 className="splice-option-title">{title(option, names)}</h3>
      <dl className="library-metrics">
        <div><dt>Distancia</dt><dd>{formatKm(option.distanceM, 1)}</dd></div>
        <div><dt>Desnivel</dt><dd>{option.elevGainM === null ? 'Sin altitud' : formatMeters(Math.round(option.elevGainM))}</dd></div>
        <div><dt>Vías principales</dt><dd>{formatNumber(option.mainRoadPct, 1)} %</dd></div>
      </dl>
      <p className="help">
        Conectores por carretera: {formatKm(option.connectorM, 1)} · Sin repetir tramos: {formatKm(option.distinctM, 1)}
        {option.estTimeS !== null && <> · Unas {formatDuration(option.estTimeS, 'short')} a tu ritmo</>}
        {option.difficulty && <> · {option.difficulty}</>}
      </p>
      {option.backtrackM > 0 && <p className="splice-warning">Vuelve {formatKm(option.backtrackM, 1)} por el mismo tramo en sentido contrario.</p>}
      {recommended && advice && (
        <div className="splice-advice">
          <p>{advice.motivo}</p>
          <p className="help">{advice.source === 'ia' ? 'Recomendación de la IA: solo ha visto estas cifras, no el mapa.' : 'Elegida por las cifras: la más corta sin vías principales.'}</p>
          {advice.aviso && <p className="help">{advice.aviso}</p>}
        </div>
      )}
      <button type="button" className="btn btn--secondary btn--block" aria-pressed={selected} onClick={onSelect}>
        {selected ? 'Opción en el mapa' : 'Ver esta opción en el mapa'}
      </button>
    </li>
  );
}

export function Empalmar() {
  const account = useAccount();
  const [routes, setRoutes] = useState<ReferenceRoute[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [firstId, setFirstId] = useState('');
  const [secondId, setSecondId] = useState('');
  const [returnToStart, setReturnToStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<{ options: SpliceOption[]; names: Names } | null>(null);
  const [advice, setAdvice] = useState<SpliceAdvice | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mapSection = useRef<HTMLElement>(null);
  // Al elegir otra opción, el mapa que cambia suele quedar fuera de la pantalla en el móvil: se trae a la vista.
  const showOption = (id: string) => {
    setSelectedId(id);
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    mapSection.current?.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    mapSection.current?.focus({ preventScroll: true });
  };
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([listReferenceRoutes(), loadSettings()])
      .then(([rows, s]) => { if (live) { setRoutes(rows); setSettings(s); } })
      .catch(() => { if (live) { setRoutes([]); setError('No se ha podido leer tu biblioteca de rutas.'); } });
    return () => { live = false; abort.current?.abort(); };
  }, []);

  const shared = sharedOrsEnabled() && account !== null;
  const access = settings ? chooseOrsAccess(settings.ors.apiKey, account) : '';
  const canRoute = settings !== null && hasOrsAccess(access);
  const ready = canRoute && firstId !== '' && secondId !== '' && firstId !== secondId && !busy;

  async function run() {
    const a = routes?.find(r => r.id === firstId);
    const b = routes?.find(r => r.id === secondId);
    if (!a || !b || !settings || !ready) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setError(''); setNotice('Calculando los conectores por carretera…'); setResult(null); setAdvice(null);
    try {
      const reference = await listActivities(referenceRange(Date.now())).then(acts => computeReference(acts, Date.now())).catch(() => null);
      const out = await spliceRoutes(a, b, { returnToStart }, { connectors: orsConnectors(access), reference, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (out.options.length === 0) { setNotice(''); setError(noOptionsText(out.discarded)); return; }
      setNotice(out.stoppedBy ? `Búsqueda cortada: ${out.stoppedBy.message} Te enseñamos lo que ya estaba calculado.` : 'Comparando las opciones…');
      const sharedAi = SHARED_AI_ENABLED && account ? createSharedSpliceAdvisor(sessionToken(account.client)) : undefined;
      const advised = await adviseSplice(out.options, { personal: settings.llm, shared: sharedAi, signal: controller.signal });
      if (controller.signal.aborted) return;
      const first = advised ? out.options.filter(o => o.id === advised.id) : [];
      setResult({ options: [...first, ...out.options.filter(o => o.id !== advised?.id)], names: { A: a.name, B: b.name } });
      setAdvice(advised);
      setSelectedId(advised?.id ?? out.options[0].id);
      if (!out.stoppedBy) setNotice('');
    } catch (e) {
      if (isAbort(e) || controller.signal.aborted) { setNotice('Cálculo cancelado.'); return; }
      setNotice(''); setError(failure(e));
    } finally {
      setBusy(false); abort.current = null;
    }
  }

  const selected = result?.options.find(o => o.id === selectedId) ?? null;
  const overlays = useMemo<MapOverlay[]>(() => (selected?.pieces ?? [])
    .filter(p => p.source === 'conector' || p.source === 'regreso')
    .map(p => ({ path: selected!.points.slice(p.from, p.to + 1), kind: p.source === 'regreso' ? 'return' : 'connector' })), [selected]);

  function download() {
    if (!selected || !result) return;
    try {
      const name = `Empalme ${result.names.A} y ${result.names.B}`.slice(0, 120);
      const url = URL.createObjectURL(new Blob([spliceGpx(name, selected)], { type: 'application/gpx+xml' }));
      const link = document.createElement('a');
      link.href = url; link.download = `empalme-${Math.round(selected.distanceM / 1000)}km.gpx`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setNotice('GPX preparado. Ábrelo en la app de iGPSPORT para pasarlo al BSC200S.');
    } catch { setError('No se ha podido preparar el GPX.'); }
  }

  const option = (r: ReferenceRoute) => (
    <option key={r.id} value={r.id}>{r.name} · {formatKm(r.summary.distanceM, 1)} · {r.summary.closed ? 'circular' : 'abierta'}</option>
  );

  return (
    <Page title="Empalmar dos rutas" back="/rutas/biblioteca" variant="narrow" className="page--library" busy={busy}
      lead="Une dos rutas de tu biblioteca en una sola: las que abres en GPX o TCX y las que guardas desde Rutas o Rutas con IA. Los conectores los calcula el motor de carreteras, sin autopistas ni autovías.">
      <section className="section card library-panel" aria-label="Elige las rutas">
        <h2 className="card-title">Las dos rutas</h2>
        {routes !== null && routes.length < 2 && !error && (
          <p className="help">
            Necesitas al menos dos rutas en la biblioteca. <Link to="/rutas/biblioteca">Abre un GPX o TCX</Link>, o genera una en{' '}
            <Link to="/rutas">Rutas</Link> o <Link to="/rutas/ia">Rutas con IA</Link> y pulsa «Guardar en la biblioteca».
          </p>
        )}
        <fieldset className="library-fields" disabled={busy || routes === null}>
          <label className="field"><span className="field-label">Primera ruta</span>
            <select className="input" value={firstId} onChange={e => setFirstId(e.target.value)}>
              <option value="">Elige una ruta</option>{routes?.map(option)}
            </select>
          </label>
          <label className="field"><span className="field-label">Segunda ruta</span>
            <select className="input" value={secondId} onChange={e => setSecondId(e.target.value)}>
              <option value="">Elige una ruta</option>{routes?.map(option)}
            </select>
          </label>
          {firstId !== '' && firstId === secondId && <p className="help">Elige dos rutas distintas.</p>}
          <label className="splice-check"><input type="checkbox" checked={returnToStart} onChange={e => setReturnToStart(e.target.checked)} /><span>Volver al inicio al terminar</span></label>
          <p className="help">Probamos los dos órdenes. Una ruta circular también se prueba al revés; una abierta, no, porque puede tener tramos de sentido único.</p>
        </fieldset>
        {settings && !canRoute && (
          <p className="help">Falta tu clave de rutas. <Link to="/ajustes?abrir=claves">Ir a Ajustes</Link></p>
        )}
        <button type="button" className="btn btn--primary btn--block" disabled={!ready} onClick={run}>Calcular empalme</button>
        {busy && <button type="button" className="btn btn--secondary btn--block" onClick={() => abort.current?.abort()}>Cancelar cálculo</button>}
        <p className="help">
          Cada empalme usa de 1 a {formatCount(4)} consultas del motor de carreteras
          {shared ? ` (servicio común: ${SHARED_ORS_LIMITS}).` : ` (tu clave: ${formatCount(ORS_DAILY_LIMIT)} al día y ${ORS_MINUTE_LIMIT} por minuto).`}
        </p>
      </section>
      {error && <p className="library-error" role="alert">{error}</p>}
      {notice && <p className="library-notice" role="status">{notice}</p>}
      {result && selected && (
        <>
          <section className="section card library-panel" aria-label="Mapa del empalme" ref={mapSection} tabIndex={-1}>
            <RideMap points={selected.points} overlays={overlays} label="Mapa del empalme elegido" className="splice-map" interactive />
            <ul className="splice-legend" aria-label="Leyenda del mapa">
              <li><span className="splice-swatch splice-swatch--route" aria-hidden="true" />Rutas originales: «{result.names.A}» y «{result.names.B}»</li>
              <li><span className="splice-swatch splice-swatch--connector" aria-hidden="true" />Conector por carretera</li>
              {selected.pieces.some(p => p.source === 'regreso') && <li><span className="splice-swatch splice-swatch--return" aria-hidden="true" />Regreso al inicio</li>}
            </ul>
            <p className="help">Se exporta la opción del mapa: {selected.order === 'AB' ? `«${result.names.A}» y luego «${result.names.B}»` : `«${result.names.B}» y luego «${result.names.A}»`}{selected.alternativeOf ? ', alternativa' : ''}, {formatKm(selected.distanceM, 1)}.</p>
            <button type="button" className="btn btn--primary btn--block" onClick={download}><Download className="ic" aria-hidden="true" />Exportar GPX</button>
          </section>
          <section className="section" aria-label="Opciones">
            <ul className="splice-options" aria-label="Opciones de empalme">
              {result.options.map(o => <OptionCard key={o.id} option={o} names={result.names} advice={advice} selected={o.id === selectedId} onSelect={() => showOption(o.id)} />)}
            </ul>
            <p className="help">Las cifras las calcula el código. La IA, si está activa, solo ve distancia, desnivel, vías principales, solapes y retrocesos de cada opción; nunca el trazado ni tu Casa. El firme y los sentidos de las rutas originales no se verifican.</p>
          </section>
        </>
      )}
    </Page>
  );
}
