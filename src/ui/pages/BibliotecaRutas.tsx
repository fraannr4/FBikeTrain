import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAccount } from '../../auth/AccountBoundary';
import { db } from '../../db/db';
import type { LatLng } from '../../domain/types';
import { haversineM } from '../../import/summary';
import { applyRoadEdit, type RoadEdit } from '../../routes/libraryEdit';
import { chooseOrsAccess, sharedOrsEnabled } from '../../routes/orsProxy';
import {
  importReferenceRoute, importReferenceRoutes, listReferenceRoutes, saveReferenceRoute, deleteReferenceRoute,
  trimReferenceRoute, reverseReferenceRoute, restoreReferenceRoute, changeReferenceRouteStart,
  referenceRouteToGpx, referenceSite, type ReferenceRoute,
} from '../../routes/library';
import { loadSettings } from '../../settings/settings';
import { Field } from '../components/Field';
import { Page } from '../components/Page';
import { RideMap } from '../components/RideMap';
import { Sheet } from '../components/Sheet';
import { StartPointCanvas } from '../components/StartPointCanvas';
import { ProfileSvg } from '../charts/ProfileSvg';
import { reduceProfile } from '../profile';
import { formatKm, formatMeters, formatCount } from '../format';
import { Download, Upload } from '../icons';
import '../styles/library.css';

const failure = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar el cambio. Inténtalo de nuevo.';
let pendingDraft: { database: string; route: ReferenceRoute } | null = null;

export function BibliotecaRutas() {
  const account = useAccount();
  const navigate = useNavigate();
  const [routes, setRoutes] = useState<ReferenceRoute[]>([]);
  const [draft, setDraft] = useState<ReferenceRoute | null>(() => pendingDraft?.database === db.name ? pendingDraft.route : null);
  const [dirty, setDirty] = useState(pendingDraft?.database === db.name);
  const [sourceUrl, setSourceUrl] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(0); const [to, setTo] = useState(1);
  const [latitude, setLatitude] = useState(''); const [longitude, setLongitude] = useState('');
  const parsedLatitude = latitude.trim() === '' ? NaN : Number(latitude.replace(',', '.'));
  const parsedLongitude = longitude.trim() === '' ? NaN : Number(longitude.replace(',', '.'));
  const point: LatLng | null = Number.isFinite(parsedLatitude) && Math.abs(parsedLatitude) <= 90 && Number.isFinite(parsedLongitude) && Math.abs(parsedLongitude) <= 180 ? { lat: parsedLatitude, lng: parsedLongitude } : null;
  const pickPoint = (p: LatLng) => { setLatitude(String(p.lat)); setLongitude(String(p.lng)); };
  const clearPoint = () => { setLatitude(''); setLongitude(''); };
  const [mapRevision, setMapRevision] = useState(0);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [editKind, setEditKind] = useState<RoadEdit['kind']>('extend');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; abort.current?.abort(); };
  }, []);
  useEffect(() => {
    let live = true;
    setLoading(true);
    listReferenceRoutes().then(rows => { if (live) setRoutes(rows); }).catch(e => { if (live) setError(failure(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [loadAttempt]);
  useEffect(() => { setFrom(0); setTo(Math.max(1, (draft?.points.length ?? 2) - 1)); clearPoint(); }, [draft?.id, draft?.points]);
  useEffect(() => { pendingDraft = dirty && draft ? { database: db.name, route: draft } : null; }, [dirty, draft]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const guard = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank') return;
      const url = new URL(link.href);
      if (url.origin === location.origin && url.pathname === location.pathname && url.hash.startsWith('#/') && url.hash !== location.hash) {
        event.preventDefault(); event.stopPropagation(); setLeaveTo(url.hash.slice(1));
      }
    };
    window.addEventListener('beforeunload', warn); document.addEventListener('click', guard, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', guard, true); };
  }, [dirty]);

  const distances = useMemo(() => {
    const out = [0]; const points = draft?.points ?? [];
    for (let i = 1; i < points.length; i++) out.push(out[i - 1] + haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng));
    return out;
  }, [draft?.points]);
  const profile = useMemo(() => {
    const points = draft?.points ?? [];
    return points.every(p => p.ele !== undefined) ? reduceProfile(points.map((p, i) => ({ dM: distances[i], ele: p.ele! }))) : [];
  }, [draft?.points, distances]);
  const totalPoints = draft?.points.length ?? 2;
  function choose(route: ReferenceRoute) {
    setDraft(structuredClone(route)); setDirty(false); setError(''); setNotice(''); clearPoint(); setMapRevision(n => n + 1);
  }
  function edit(next: ReferenceRoute) { setDraft(next); setDirty(true); setMapRevision(n => n + 1); setError(''); setNotice('Cambio preparado. Guarda para conservarlo.'); }
  function local(operation: (route: ReferenceRoute) => ReferenceRoute) {
    if (!draft || busy) return;
    try { edit(operation(draft)); } catch (e) { setError(failure(e)); }
  }
  async function imported(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []); e.target.value = '';
    const file = files[0];
    if (!file || busy || dirty) return;
    setBusy(true); setError(''); setNotice('');
    if (files.length > 1 || /\.zip$/i.test(file.name)) {
      try {
        const { imported: added, failed } = await importReferenceRoutes(files);
        if (!alive.current) return;
        setRoutes(rows => [...added, ...rows]);
        setNotice(`${added.length === 1 ? '1 ruta importada' : `${formatCount(added.length)} rutas importadas`}. No se ha añadido ninguna salida al historial.`);
        if (failed.length) setError(`${failed.length === 1 ? '1 fichero no se ha importado' : `${formatCount(failed.length)} ficheros no se han importado`}: ${failed.slice(0, 5).map(f => `${f.name} (${f.message})`).join('; ')}${failed.length > 5 ? '…' : ''}`);
      } catch (err) { if (alive.current) setError(failure(err)); }
      finally { if (alive.current) setBusy(false); }
      return;
    }
    try {
      const route = await importReferenceRoute(file, sourceUrl);
      if (!alive.current) return;
      setRoutes(rows => [route, ...rows]); choose(route); setNotice('Ruta analizada. No se ha añadido ninguna salida al historial.');
    } catch (err) { if (alive.current) setError(failure(err)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function save() {
    if (!draft || busy) return;
    setBusy(true); setError('');
    try {
      const saved = await saveReferenceRoute(draft);
      if (!alive.current) return;
      setRoutes(rows => [saved, ...rows.filter(r => r.id !== saved.id)]); setDraft(saved); setDirty(false); setNotice('Cambios guardados. El fichero original se conserva.');
    } catch (e) { if (alive.current) setError(failure(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  function download() {
    if (!draft) return;
    try {
      const url = URL.createObjectURL(new Blob([referenceRouteToGpx(draft)], { type: 'application/gpx+xml' }));
      const a = document.createElement('a'); a.href = url; a.download = 'fbiketrain-ruta.gpx'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      setNotice('GPX preparado con el trazado que estás viendo.');
    } catch (e) { setError(failure(e)); }
  }
  function downloadOriginal() {
    if (!draft) return;
    try {
      const url = URL.createObjectURL(new Blob([draft.originalXml], { type: 'application/xml' }));
      const a = document.createElement('a'); a.href = url; a.download = draft.sourceFileName; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      setNotice('Fichero original preparado, sin tus modificaciones.');
    } catch (e) { setError(failure(e)); }
  }
  async function roadEdit() {
    if (!draft || !point || busy) return;
    const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError(''); setNotice('Calculando la conexión por carretera…');
    try {
      const settings = await loadSettings();
      const next = await applyRoadEdit(draft, { kind: editKind, point, from, to }, chooseOrsAccess(settings.ors.apiKey, account), controller.signal);
      if (alive.current && !controller.signal.aborted) edit(next);
    } catch (e) { if (alive.current && !controller.signal.aborted) setError(failure(e)); }
    finally { if (alive.current) { setBusy(false); if (controller.signal.aborted) setNotice('Cambio cancelado. Tu ruta sigue igual.'); } abort.current = null; }
  }
  async function remove() {
    if (!draft || busy) return;
    setBusy(true); setError('');
    try { await deleteReferenceRoute(draft.id); if (alive.current) { setRoutes(rows => rows.filter(r => r.id !== draft.id)); setDraft(null); setDirty(false); setDeleteOpen(false); setNotice('Ruta quitada de la biblioteca.'); } }
    catch (e) { if (alive.current) setError(failure(e)); }
    finally { if (alive.current) setBusy(false); }
  }

  return <Page title="Biblioteca de rutas" back="/rutas" variant="narrow" className="page--library" lead="Abre un GPX o TCX de Wikiloc u otra fuente, analiza el recorrido y prepara tu propia versión.">
    <section className="section card library-panel" aria-label="Añadir un recorrido">
      <h2 className="card-title">Tu fichero, como punto de partida</h2>
      <p className="help">En Wikiloc, descarga la ruta como archivo GPX y elígelo aquí desde Archivos o Descargas. También funciona en iPhone. Añadir una ruta no cambia tus estadísticas.</p>
      <Field label="Enlace de origen (opcional)" type="url" maxLength={2000} placeholder="https://…" value={sourceUrl} disabled={busy || dirty || loading} onChange={e => setSourceUrl(e.target.value)} help="Solo guardamos la referencia: el enlace no descarga el recorrido automáticamente." />
      <label className="btn btn--primary btn--block"><Upload className="ic" aria-hidden="true" />Elegir GPX, TCX o ZIP<input className="sr-only" type="file" multiple accept=".gpx,.tcx,.zip,application/gpx+xml,application/vnd.garmin.tcx+xml,application/xml,text/xml,application/zip" aria-label="Elegir GPX, TCX o ZIP" disabled={busy || dirty || loading} onChange={imported} /></label>
      <p className="help">Puedes elegir varios a la vez o un ZIP con muchos: hasta 200 rutas por vez. Cada ruta, hasta 10 MB y 50.000 puntos, con un único recorrido continuo. Tus rutas se guardan en este dispositivo; exporta el GPX para conservar una copia.</p>
    </section>
    {error && <p className="library-error" role="alert">{error} {loading ? null : <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setLoadAttempt(n => n + 1)}>Volver a leer la biblioteca</button>}</p>}
    {notice && <p className="library-notice" role="status">{notice}</p>}
    {loading ? <p role="status">Leyendo tu biblioteca…</p> : routes.length > 0 && <section className="section library-list" aria-label="Tus recorridos">{routes.map(route => <button className="library-row" type="button" key={route.id} disabled={busy || dirty} aria-pressed={draft?.id === route.id} onClick={() => choose(route)}><b>{route.name}</b><span>{formatKm(route.summary.distanceM, 1)} · {route.format.toUpperCase()}</span></button>)}</section>}
    {!loading && routes.length >= 2 && <Link className="btn btn--secondary btn--block" to="/rutas/empalmar">Empalmar rutas</Link>}
    {draft && <>
      <section className="section card library-panel" aria-label="Recorrido analizado">
        <Field label="Nombre de la ruta" value={draft.name} maxLength={120} disabled={busy} onChange={e => { setDraft({ ...draft, name: e.target.value }); setDirty(true); }} />
        <dl className="library-metrics"><div><dt>Distancia</dt><dd>{formatKm(draft.summary.distanceM, 1)}</dd></div><div><dt>Desnivel</dt><dd>{draft.summary.elevGainM === null ? 'Sin altitud' : formatMeters(draft.summary.elevGainM)}</dd></div><div><dt>Trazado</dt><dd>{draft.summary.closed ? 'Circular' : 'Abierto'}</dd></div></dl>
        <p className="help">{formatCount(draft.summary.pointCount)} puntos · Desnivel geométrico calculado del fichero. Firme y sentidos del fichero sin verificar. No estimamos tiempos a partir de datos que el fichero no contiene.</p>
        {draft.sourceUrl ? <a className="btn btn--ghost btn--wrap" href={draft.sourceUrl} target="_blank" rel="noopener noreferrer">Origen: {referenceSite(draft.sourceUrl) === 'wikiloc' ? 'Wikiloc' : 'enlace'}{draft.author ? ` · ${draft.author}` : ''}</a> : draft.author && <p className="help">Autor: {draft.author}</p>}
        <RideMap points={draft.points} label="Mapa de tu ruta de referencia" interactive />
        <ProfileSvg profile={profile} label="Perfil de la ruta importada" axis height={100} />
        <button type="button" className="btn btn--primary btn--block" onClick={download} disabled={busy}><Download className="ic" aria-hidden="true" />Exportar GPX actual</button>
      </section>
      <section className="section card library-panel" aria-label="Ajustar el recorrido"><h2 className="card-title">Ajusta el recorrido</h2>
        <fieldset disabled={busy} className="library-fields">
          <label className="field"><span className="field-label">Inicio del tramo · {formatKm(distances[from] ?? 0, 1)}</span><input type="range" aria-label="Inicio del tramo" min={0} max={totalPoints - 2} value={from} onChange={e => { const v = Number(e.target.value); setFrom(v); if (v >= to) setTo(v + 1); }} /></label>
          <label className="field"><span className="field-label">Final del tramo · {formatKm(distances[to] ?? 0, 1)}</span><input type="range" aria-label="Final del tramo" min={from + 1} max={totalPoints - 1} value={to} onChange={e => setTo(Number(e.target.value))} /></label>
          <div className="library-actions"><button type="button" className="btn btn--secondary" onClick={() => local(r => trimReferenceRoute(r, from, to))}>Conservar solo el tramo</button><button type="button" className="btn btn--secondary" onClick={() => local(reverseReferenceRoute)}>Invertir recorrido</button>{draft.summary.closed && <button type="button" className="btn btn--secondary" onClick={() => local(r => changeReferenceRouteStart(r, from))}>Empezar en el punto elegido</button>}</div>
          <p className="help">Recortar o invertir no recalcula carreteras ni valida sentidos de circulación. El original permanece guardado.</p>
          <label className="field"><span className="field-label">Cambio por carretera</span><select className="input" value={editKind} onChange={e => setEditKind(e.target.value as RoadEdit['kind'])}><option value="extend">Prolongar desde el final</option><option value="prepend">Llegar a la ruta desde otro inicio</option><option value="detour">Desviar el tramo elegido por un punto</option></select></label>
          <p className="help">Elige el punto en el mapa o introduce sus coordenadas. {sharedOrsEnabled() && account ? 'La conexión usa el servicio común de rutas.' : <>La conexión usa tu clave de rutas de <Link to="/ajustes?abrir=claves">Ajustes</Link>.</>} No se envía a la IA.</p>
          <StartPointCanvas key={`${draft.id}-${mapRevision}-${editKind}`} value={point} home={draft.points[editKind === 'extend' ? totalPoints - 1 : 0]} onChange={pickPoint} />
          <div className="library-coordinate"><Field label="Latitud del punto" inputMode="decimal" value={latitude} help="Entre −90 y 90." onChange={e => setLatitude(e.target.value)} /><Field label="Longitud del punto" inputMode="decimal" value={longitude} help="Entre −180 y 180." onChange={e => setLongitude(e.target.value)} /></div>
          <button type="button" className="btn btn--secondary btn--block" disabled={!point} onClick={roadEdit}>Calcular cambio por carretera</button>
        </fieldset>
        {busy && abort.current && <button className="btn btn--secondary" type="button" onClick={() => abort.current?.abort()}>Cancelar cálculo</button>}
      </section>
      <section className="section card library-panel"><button className="btn btn--primary btn--block" type="button" disabled={!dirty || busy} onClick={save}>Guardar cambios</button>{dirty && <button className="btn btn--ghost" disabled={busy} onClick={() => { const saved = routes.find(r => r.id === draft.id); if (saved) choose(saved); }}>Descartar cambios sin guardar</button>}<button className="btn btn--secondary" type="button" disabled={busy} onClick={() => local(restoreReferenceRoute)}>Volver al trazado original</button><button className="btn btn--secondary" type="button" disabled={busy} onClick={downloadOriginal}>Descargar fichero original</button><button className="btn btn--ghost" type="button" disabled={busy} onClick={() => setDeleteOpen(true)}>Quitar de la biblioteca</button></section>
    </>}
    <Sheet open={deleteOpen} title="Quitar este recorrido" onClose={() => setDeleteOpen(false)} footer={<button className="btn btn--primary btn--block" type="button" disabled={busy} onClick={remove}>Quitar recorrido</button>}><p>Se quitará de este dispositivo, incluido su original. Las salidas realizadas no cambian.</p></Sheet>
    <Sheet open={leaveTo !== null} title="Tienes cambios sin guardar" onClose={() => setLeaveTo(null)} footer={<button className="btn btn--secondary btn--block" type="button" onClick={() => { const target = leaveTo; pendingDraft = null; setDirty(false); setLeaveTo(null); if (target) navigate(target); }}>Descartar y continuar</button>}><p>Puedes cerrar esta hoja para guardar primero. Si usas Atrás del navegador, conservaremos el borrador durante esta sesión.</p></Sheet>
  </Page>;
}
