import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ImportReport } from '../../import/importService';
import { importReferenceRoute } from '../../routes/library';
import { releaseSharedFiles, sharedDestination, takeSharedFiles, type SharedDestination } from '../../pwa/sharedFiles';
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
    void takeSharedFiles(id).then(files => Promise.all(files.map(async file => {
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
    try {
      for (const item of next.filter(item => item.destination === 'route' && !item.saved && !item.error)) {
        try { await importReferenceRoute(item.file); item.saved = true; }
        catch (e) { item.error = message(e); }
      }
      const activities = next.filter(item => item.destination === 'activity' && !item.saved && !item.error);
      if (activities.length) {
        setReport(await importer(activities.map(item => item.file), () => {}));
        activities.forEach(item => { item.saved = true; });
      }
      setDone(true);
      if (id) releaseSharedFiles(id);
    } catch (e) { setError(`La importación se ha interrumpido: ${message(e)}. Puedes reintentar; las salidas no se duplican.`); }
    finally { setItems(next); setBusy(false); }
  }
  const routes = items?.filter(item => item.destination === 'route').length ?? 0;
  const activities = items?.filter(item => item.destination === 'activity').length ?? 0;
  const savedRoutes = items?.filter(item => item.destination === 'route' && item.saved).length ?? 0;
  return <Page title="Ficheros compartidos" back="/mas" variant="narrow" className="page--compartido"
    lead="Recibe rutas y salidas desde otras apps. Los ficheros se leen aquí, en tu teléfono.">
    {error && <p className="banner banner--error" role="alert">{error}</p>}
    {items === null || busy ? <CyclingLoader label={busy ? 'Importando los ficheros…' : 'Leyendo el envío…'} /> : null}
    {items && items.length > 0 && <section className="section" aria-label="Envío recibido">
      <div className="section-h"><h2 className="section-title">{items.length} {items.length === 1 ? 'fichero recibido' : 'ficheros recibidos'}</h2></div>
      <ul className="shared-list">{items.map((item, index) => <li className="card shared-file" key={index}>
        <strong>{item.file.name}</strong>
        <span className={item.error ? 'shared-error' : ''}>{item.error ?? (item.destination === 'route' ? item.saved ? 'Guardado en la biblioteca' : 'Ruta · Biblioteca de rutas' : item.saved ? 'Procesado · Consulta el informe' : 'Actividad · Historial de salidas')}</span>
      </li>)}</ul>
      {!done && <p className="run-sub">Las rutas se guardan como referencia. Las actividades se importan con la comprobación habitual de duplicados.</p>}
      {!done && items.some(item => item.destination && !item.error && !item.saved) && <button className="btn btn--primary btn--block" disabled={busy} onClick={() => void start()}>Importar ficheros</button>}
    </section>}
    {items?.length === 0 && !error && <p className="banner">No hay ficheros pendientes. El envío puede haber caducado o ya se ha abierto. Vuelve a compartir el archivo desde la otra app.</p>}
    {done && <p role="status">{savedRoutes > 0 ? `${savedRoutes} ${savedRoutes === 1 ? 'ruta guardada' : 'rutas guardadas'} en la biblioteca. ` : ''}Envío procesado.</p>}
    {report && <ImportReportView report={report} />}
    {!busy && items !== null && <div className="shared-actions">
      {(routes > 0 || activities === 0) && <Link className="btn btn--secondary btn--block" to="/rutas/biblioteca">Ir a la biblioteca</Link>}
      {(activities > 0 || routes === 0) && <Link className="btn btn--secondary btn--block" to="/historial">Ir al historial</Link>}
    </div>}
  </Page>;
}
