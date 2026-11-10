import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isAbort } from '../../ai/abort';
import { aiGoal } from '../../ai/goalContext';
import { createSharedSpliceAdvisor, SHARED_AI_ENABLED } from '../../ai/sharedClient';
import { adviseSplice, type SpliceAdvice } from '../../ai/spliceAdvisor';
import { useAccount } from '../../auth/AccountBoundary';
import { listGoals } from '../../calendar/calendarRepo';
import { getTrack, listActivities } from '../../db/repo';
import { localDay } from '../../metrics/calendar';
import { computeReference } from '../../metrics/reference';
import { listReferenceRoutes, RouteLibraryError, saveSplicedRoute, type ReferenceRoute } from '../../routes/library';
import { ORS_DAILY_LIMIT, ORS_MINUTE_LIMIT, OrsError } from '../../routes/ors';
import { chooseOrsAccess, hasOrsAccess, sessionToken, SHARED_ORS_LIMITS, sharedOrsEnabled } from '../../routes/orsProxy';
import { activityToSpliceInput, orsConnectors, spliceGpx, spliceRoutes, type DiscardReason, type SpliceInput, type SpliceLetter, type SpliceOption, type SpliceResult } from '../../routes/splice';
import { loadSettings } from '../../settings/settings';
import type { Settings, StoredActivity } from '../../domain/types';
import { Page } from '../components/Page';
import { RideMap, type MapOverlay } from '../components/RideMap';
import { formatCount, formatDuration, formatKm, formatMeters, formatNumber } from '../format';
import { Download } from '../icons';
import { referenceRange } from '../routes/routeView';
import { shortDate } from '../salida/model';
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

/** Salidas del historial que se ofrecen como tramo: las más recientes con track. */
const MAX_RIDES = 50;
const PICK_LABELS = ['Primera ruta', 'Segunda ruta', 'Tercera ruta (opcional)'] as const;

/** «Ningún empalme válido: 2 conectores sin carretera entre las rutas, 1 por autopista». */
function noOptionsText(discarded: SpliceResult['discarded']): string {
  const counts = new Map<DiscardReason, number>();
  for (const { reason } of discarded) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const parts = [...counts].map(([reason, n]) => `${n} ${n === 1 ? 'conector' : 'conectores'} ${REASON_TEXT[reason]}`);
  return `No hay un empalme válido para bici de carretera${parts.length ? `: ${parts.join(', ')}` : ''}. Prueba con otras rutas o recorta sus extremos en la biblioteca.`;
}

/** Los errores de ORS (cuota, red) y de tamaño del recorrido ya traen un texto para el usuario. */
const failure = (e: unknown) => (e instanceof OrsError || e instanceof RouteLibraryError ? e.message : 'No se ha podido calcular el empalme. Vuelve a probar.');

type Names = Partial<Record<SpliceLetter, string>>;

/** «Costa y Interior» o «Costa, Interior y Sierra». */
const enumerate = (items: string[]) => `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
const quoted = (name: string | undefined) => `«${name ?? ''}»`;

/** «“Costa”, luego “Interior” y después “Sierra”», en el orden recorrido. */
function sequence(o: SpliceOption, names: Names): string {
  const [first, second, third] = ([...o.order] as SpliceLetter[]).map(k => quoted(names[k]));
  return third ? `${first}, luego ${second} y después ${third}` : `${first}, luego ${second}`;
}

function title(o: SpliceOption, names: Names): string {
  const reversed = ([...o.order] as SpliceLetter[]).filter(k => o.reversed[k]).map(k => `${quoted(names[k])} al revés`);
  return `Primero ${sequence(o, names)}${reversed.length ? ` · ${reversed.join(', ')}` : ''}`;
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
  const [params] = useSearchParams();
  const [routes, setRoutes] = useState<ReferenceRoute[] | null>(null);
  const [rides, setRides] = useState<StoredActivity[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  // Valores `lib:<id>` (biblioteca) o `act:<id>` (salida del historial); el tercero es opcional.
  const [picks, setPicks] = useState<string[]>(() => [params.get('primera') ?? '', '', '']);
  const [returnToStart, setReturnToStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<{ options: SpliceOption[]; names: Names } | null>(null);
  const [advice, setAdvice] = useState<SpliceAdvice | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
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
    Promise.all([listReferenceRoutes(), loadSettings(), listActivities()])
      .then(([rows, s, acts]) => {
        if (!live) return;
        setRoutes(rows); setSettings(s);
        setRides(acts.filter(a => a.hasTrack).sort((a, b) => b.startTime - a.startTime).slice(0, MAX_RIDES));
      })
      .catch(() => { if (live) { setRoutes([]); setError('No se ha podido leer tu biblioteca de rutas.'); } });
    return () => { live = false; abort.current?.abort(); };
  }, []);

  const shared = sharedOrsEnabled() && account !== null;
  const access = settings ? chooseOrsAccess(settings.ors.apiKey, account) : '';
  const canRoute = settings !== null && hasOrsAccess(access);
  const chosen = picks.filter(v => v !== '');
  const distinct = new Set(chosen).size === chosen.length;
  const ready = canRoute && picks[0] !== '' && picks[1] !== '' && distinct && !busy;
  const pick = (i: number, value: string) => setPicks(p => p.map((v, k) => (k === i ? value : v)));

  /** El tramo elegido: la ruta de la biblioteca o la salida con los puntos GPS de su track. */
  async function resolve(value: string): Promise<SpliceInput> {
    const id = value.slice(4);
    if (value.startsWith('lib:')) {
      const route = routes?.find(r => r.id === id);
      if (!route) throw new RouteLibraryError('Esa ruta ya no está en la biblioteca.');
      return route;
    }
    const ride = rides.find(a => a.id === id);
    const track = await getTrack(id);
    if (!ride || !track) throw new RouteLibraryError('Esa salida no tiene un track válido para empalmar.');
    return activityToSpliceInput(ride, track);
  }

  async function run() {
    if (!settings || !ready) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setError(''); setNotice('Calculando los conectores por carretera…'); setResult(null); setAdvice(null); setSavedIds(new Set());
    try {
      const inputs = await Promise.all(chosen.map(resolve));
      const names: Names = { A: inputs[0].name, B: inputs[1].name, ...(inputs[2] ? { C: inputs[2].name } : {}) };
      const now = Date.now();
      const acts = await listActivities(referenceRange(now)).catch(() => null);
      const reference = acts ? computeReference(acts, now) : null;
      // El objetivo vigente, solo cifras; si no se puede leer, la IA no lo recibe.
      const objetivo = acts ? await listGoals().then(goals => aiGoal(goals, acts, now, localDay(now))).catch(() => null) : null;
      const out = await spliceRoutes(inputs, { returnToStart }, { connectors: orsConnectors(access), reference, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (out.options.length === 0) { setNotice(''); setError(noOptionsText(out.discarded)); return; }
      setNotice(out.stoppedBy ? `Búsqueda cortada: ${out.stoppedBy.message} Te enseñamos lo que ya estaba calculado.` : 'Comparando las opciones…');
      const sharedAi = SHARED_AI_ENABLED && account ? createSharedSpliceAdvisor(sessionToken(account.client)) : undefined;
      const advised = await adviseSplice(out.options, { personal: settings.llm, shared: sharedAi, signal: controller.signal, objetivo });
      if (controller.signal.aborted) return;
      const first = advised ? out.options.filter(o => o.id === advised.id) : [];
      setResult({ options: [...first, ...out.options.filter(o => o.id !== advised?.id)], names });
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
  const names = result ? (['A', 'B', 'C'] as const).map(k => result.names[k]).filter((n): n is string => n !== undefined) : [];
  const spliceName = `Empalme ${enumerate(names)}`.slice(0, 120);

  function download() {
    if (!selected || !result) return;
    try {
      const url = URL.createObjectURL(new Blob([spliceGpx(spliceName, selected)], { type: 'application/gpx+xml' }));
      const link = document.createElement('a');
      link.href = url; link.download = `empalme-${Math.round(selected.distanceM / 1000)}km.gpx`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setNotice('GPX preparado. Ábrelo en la app de iGPSPORT para pasarlo al BSC200S.');
    } catch { setError('No se ha podido preparar el GPX.'); }
  }

  async function save() {
    if (!selected || savedIds.has(selected.id)) return;
    try {
      await saveSplicedRoute(spliceName, selected.points);
      setSavedIds(ids => new Set(ids).add(selected.id));
      setError(''); setNotice('Guardada en la biblioteca.');
    } catch (e) { setError(failure(e)); }
  }

  const options = (
    <>
      <option value="">Elige una ruta</option>
      {routes && routes.length > 0 && (
        <optgroup label="Biblioteca">
          {routes.map(r => <option key={r.id} value={`lib:${r.id}`}>{r.name} · {formatKm(r.summary.distanceM, 1)} · {r.summary.closed ? 'circular' : 'abierta'}</option>)}
        </optgroup>
      )}
      {rides.length > 0 && (
        <optgroup label="Salidas">
          {rides.map(a => <option key={a.id} value={`act:${a.id}`}>{a.name?.trim() || 'Salida sin nombre'} · {shortDate(a.startTime, Date.now())} · {formatKm(a.totals.distanceM, 1)}</option>)}
        </optgroup>
      )}
    </>
  );
  const saved = selected !== null && savedIds.has(selected.id);

  return (
    <Page title="Empalmar rutas" back="/rutas/biblioteca" variant="narrow" className="page--library" busy={busy}
      lead="Une dos o tres tramos en una sola ruta: rutas de tu biblioteca (las que abres en GPX o TCX y las que guardas desde Rutas o Rutas con IA) y salidas de tu historial con track. Los conectores los calcula el motor de carreteras, sin autopistas ni autovías.">
      <section className="section card library-panel" aria-label="Elige las rutas">
        <h2 className="card-title">Los tramos</h2>
        {routes !== null && routes.length + rides.length < 2 && !error && (
          <p className="help">
            Necesitas al menos dos tramos: rutas de la biblioteca o salidas con track. <Link to="/rutas/biblioteca">Abre un GPX o TCX</Link>, o genera una en{' '}
            <Link to="/rutas">Rutas</Link> o <Link to="/rutas/ia">Rutas con IA</Link> y pulsa «Guardar en la biblioteca».
          </p>
        )}
        <fieldset className="library-fields" disabled={busy || routes === null}>
          {PICK_LABELS.map((label, i) => (
            <label key={label} className="field"><span className="field-label">{label}</span>
              <select className="input" value={picks[i]} onChange={e => pick(i, e.target.value)}>{options}</select>
            </label>
          ))}
          {!distinct && <p className="help">Elige rutas distintas.</p>}
          <label className="splice-check"><input type="checkbox" checked={returnToStart} onChange={e => setReturnToStart(e.target.checked)} /><span>Volver al inicio al terminar</span></label>
          <p className="help">Con dos rutas probamos los dos órdenes; con tres, el orden en que las eliges. Una ruta circular también se prueba al revés; una abierta, no, porque puede tener tramos de sentido único.</p>
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
              <li><span className="splice-swatch splice-swatch--route" aria-hidden="true" />Rutas originales: {enumerate(names.map(quoted))}</li>
              <li><span className="splice-swatch splice-swatch--connector" aria-hidden="true" />Conector por carretera</li>
              {selected.pieces.some(p => p.source === 'regreso') && <li><span className="splice-swatch splice-swatch--return" aria-hidden="true" />Regreso al inicio</li>}
            </ul>
            <p className="help">Se exporta la opción del mapa: {sequence(selected, result.names)}{selected.alternativeOf ? ', alternativa' : ''}, {formatKm(selected.distanceM, 1)}.</p>
            <button type="button" className="btn btn--primary btn--block" onClick={download}><Download className="ic" aria-hidden="true" />Exportar GPX</button>
            <button type="button" className="btn btn--secondary btn--block" disabled={saved} onClick={save}>{saved ? 'Guardada en la biblioteca' : 'Guardar en la biblioteca'}</button>
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
