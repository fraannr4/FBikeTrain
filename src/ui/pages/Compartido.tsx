import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ImportReport } from '../../import/importService';
import { importReferenceRoute } from '../../routes/library';
import { readSharedFiles, savePendingSharedFiles, sharedDestination, type SharedDestination } from '../../pwa/sharedFiles';
import { useImporter } from '../importer';
import { Page } from '../components/Page';
import { ImportReportView } from '../components/ImportReportView';
import { CyclingLoader } from '../components/CyclingLoader';
import '../styles/compartido.css';

type Item = { file: File; destination?: SharedDestination; error?: string; saved?: boolean };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function Compartido() {
  const [params] = useSearchParams();
  const id = params.get('envio');
  const incomingError = params.get('error');
  const importer = useImporter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [report, setReport] = useState<ImportReport>();
  useEffect(() => {
    let live = true;
    setItems(null); setError(''); setDone(false); setReport(undefined);
    if (incomingError) {
      setError(incomingError === 'size' ? 'El envío supera el límite de 20 ficheros o 50 MB.' : incomingError === 'empty' ? 'La otra app no ha enviado ningún fichero. Comparte el archivo GPX, TCX o FIT, en lugar del enlace.' : 'No se han podido guardar los ficheros. Comprueba el espacio disponible y vuelve a compartirlos.');
      setItems([]);
      return;
    }
    if (!id) { setItems([]); return; }
    void readSharedFiles(id).then(files => Promise.all(files.map(async file => {
      try { return { file, destination: await sharedDestination(file) }; }
      catch (e) { return { file, error: message(e) }; }
    }))).then(result => { if (live) setItems(result); }).catch(e => {
      if (live) { setItems([]); setError(`No se puede leer el envío: ${message(e)}`); }
    });
    return () => { live = false; };
  }, [id, incomingError]);

  async function start() {
    if (!items || busy) return;
    setBusy(true); setError('');
    const next = items.map(item => ({ ...item }));
    const acknowledge = () => id ? savePendingSharedFiles(id, next.filter(item => !item.saved).map(item => item.file)) : Promise.resolve();
    try {
      for (const item of next.filter(item => item.destination === 'route' && !item.saved)) {
        try { await importReferenceRoute(item.file); item.saved = true; item.error = undefined; }
        catch (e) { item.error = message(e); }
        if (item.saved) await acknowledge();
      }
      const activities = next.filter(item => item.destination === 'activity' && !item.saved);
      if (activities.length) {
        const imported = await importer(activities.map(item => item.file), () => {});
        setReport(imported);
        activities.forEach(item => {
          const skipped = imported.skipped.find(entry => entry.file === item.file.name);
          item.saved = !skipped;
          item.error = skipped?.reason;
        });
        await acknowledge();
      }
      const completed = next.every(item => !item.destination || item.saved);
      if (completed && id) await savePendingSharedFiles(id, []);
      setDone(completed);
    } catch (e) { setError(`La importación se ha interrumpido: ${message(e)}. Puedes reintentar; las salidas no se duplican.`); }
    finally { setItems(next); setBusy(false); }
  }
  const routes = items?.filter(item => item.destination === 'route').length ?? 0;
  const activities = items?.filter(item => item.destination === 'activity').length ?? 0;
  const savedRoutes = items?.filter(item => item.destination === 'route' && item.saved).length ?? 0;
  async function discard() {
    if (!id || busy) return;
    try { await savePendingSharedFiles(id, []); setItems([]); setDone(false); setError(''); }
    catch { setError('No se ha podido descartar el envío. Inténtalo de nuevo.'); }
  }
  return <Page title="Ficheros compartidos" back="/mas" variant="narrow" className="page--compartido"
    lead="Recibe rutas y salidas desde otras apps. Los ficheros se leen aquí, en tu teléfono.">
    {error && <p className="banner banner--error" role="alert">{error}</p>}
    {items === null || busy ? <CyclingLoader label={busy ? 'Importando los ficheros…' : 'Leyendo el envío…'} /> : null}
    {items && items.length > 0 && <section className="section" aria-label="Envío recibido">
      <div className="section-h"><h2 className="section-title">{items.length} {items.length === 1 ? 'fichero recibido' : 'ficheros recibidos'}</h2></div>
      <ul className="shared-list">{items.map((item, index) => <li className="card shared-file" key={index}>
        <strong>{item.file.name}</strong>
        <span className={item.error ? 'shared-error' : ''}>{item.error ?? (item.destination === 'route' ? item.saved ? 'Guardado en la biblioteca' : 'Ruta · Biblioteca de rutas' : item.saved ? 'Procesado · Consulta el informe' : 'Actividad · Historial de salidas')}</span>
        {item.destination && !item.saved && !/\.fit$/i.test(item.file.name) && <label className="field">
          <span className="field-label">Guardar {item.file.name} como</span>
          <select className="input" disabled={busy} value={item.destination} onChange={event => {
            const destination = event.target.value as SharedDestination;
            setItems(rows => rows?.map((row, i) => i === index ? { ...row, destination, error: undefined } : row) ?? null);
          }}>
            <option value="route">Ruta de referencia · Biblioteca</option>
            <option value="activity">Actividad realizada · Historial</option>
          </select>
        </label>}
      </li>)}</ul>
      {!done && <p className="run-sub">Si el GPX viene de Wikiloc para preparar una ruta, elige Biblioteca aunque incluya horas. El historial es para tus salidas realizadas. El envío se conserva hasta procesarlo o descartarlo, durante un máximo de 24 horas.</p>}
      {!done && items.some(item => item.destination && !item.saved) && <button className="btn btn--primary btn--block" disabled={busy} onClick={() => void start()}>Importar ficheros</button>}
      {!done && <button className="btn btn--ghost btn--block" disabled={busy} onClick={() => void discard()}>Descartar envío</button>}
    </section>}
    {items?.length === 0 && !error && <p className="banner">No hay ficheros pendientes. El envío puede haber caducado, haberse procesado o descartado. Vuelve a compartir el archivo desde la otra app.</p>}
    {done && <p role="status">{savedRoutes > 0 ? `${savedRoutes} ${savedRoutes === 1 ? 'ruta guardada' : 'rutas guardadas'} en la biblioteca. ` : ''}Envío procesado.</p>}
    {report && <ImportReportView report={report} />}
    {!busy && items !== null && <div className="shared-actions">
      {(routes > 0 || activities === 0) && <Link className="btn btn--secondary btn--block" to="/rutas/biblioteca">Ir a la biblioteca</Link>}
      {(activities > 0 || routes === 0) && <Link className="btn btn--secondary btn--block" to="/historial">Ir al historial</Link>}
    </div>}
  </Page>;
}
