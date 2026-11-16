import { useState } from 'react';
import { useGarminConnections } from '../../connections/GarminProvider';
import { Banner } from './Banner';
import { formatCount } from '../format';

/** Un único botón: Garmin hace el resto en su web. Conectado, las salidas llegan solas. */
export function GarminConnection() {
  const garmin = useGarminConnections();
  const [actionError, setActionError] = useState('');
  if (!garmin) return null;
  const blocked = !garmin.ready || garmin.busy;
  async function run(action: () => Promise<void>) {
    setActionError('');
    try { await action(); }
    catch { setActionError('No se pudo completar la conexión con Garmin. Vuelve a intentarlo.'); }
  }
  const report = garmin.result?.report;
  const pending = garmin.ready && !garmin.available;
  const renew = garmin.reconnectRequired || garmin.permissionRequired;
  return <section className="activity-connection garmin-connection" aria-labelledby="garmin-connect-title">
    <h2 className="sub-h" id="garmin-connect-title">Garmin Connect</h2>
    {!garmin.ready ? <p role="status">Comprobando la conexión con Garmin…</p> : null}
    {!garmin.connected ? <>
      <button type="button" className="btn btn--primary btn--block" disabled={blocked || !garmin.available} onClick={() => void run(garmin.connect)}>Conectar con Garmin</button>
      {pending ? <>
        <Banner>Pendiente de la aprobación de Garmin</Banner>
        <p className="help">Garmin está revisando la solicitud de FBikeTrain. Cuando la apruebe, este botón se activará y tus salidas llegarán solas.</p>
        <p className="help">Mientras tanto, hazlo a mano. Exporta el FIT desde Garmin Connect y súbelo en Importar.</p>
        <a className="btn btn--secondary btn--block" href="#/importar">Ir a Importar</a>
      </> : garmin.available ? <p className="help">Se abrirá la web de Garmin para que autorices a FBikeTrain. Tu contraseña se queda en Garmin.</p> : null}
    </> : <>
      <div className="connection-status" aria-live="polite">
        <p>Cuenta Garmin conectada.</p>
        {renew ? <>
          <p>{garmin.reconnectRequired
            ? 'La conexión con Garmin ha caducado. Vuelve a autorizarla para recibir tus salidas.'
            : 'Garmin no ha dado acceso a las actividades. Vuelve a autorizarlo para recibir tus salidas.'}</p>
          <button type="button" className="btn btn--primary btn--block" disabled={blocked} onClick={() => void run(garmin.connect)}>Conectar con Garmin</button>
        </> : garmin.receptionAvailable === false
          ? <p>La recepción de salidas de Garmin todavía no está activa. Mientras tanto, importa el FIT a mano.</p>
          : <p>Las salidas nuevas llegan solas: se importan al abrir la app.</p>}
        <p>{garmin.lastSyncAt ? `Última sincronización: ${new Date(garmin.lastSyncAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}.` : 'Todavía no ha llegado ninguna salida desde Garmin.'}</p>
      </div>
      <button type="button" className="btn btn--ghost btn--block" aria-label="Desconectar Garmin" disabled={blocked} onClick={() => void run(garmin.disconnect)}>Desconectar</button>
      <p className="help">Desconectar retira el permiso en Garmin y borra la conexión del servidor. Las salidas ya importadas se quedan.</p>
    </>}
    {garmin.busy ? <p role="status">Comprobando salidas de Garmin…</p> : null}
    {garmin.error || actionError ? <p role="alert">{garmin.error || actionError}</p> : null}
    {report && (report.added || report.duplicates || report.skipped.length) ? <div className="connection-status" aria-live="polite">
      <p>{formatCount(report.added)} {report.added === 1 ? 'salida nueva' : 'salidas nuevas'} de Garmin. {formatCount(report.duplicates)} ya estaban guardadas.</p>
      {report.notCycling ? <p>{formatCount(report.notCycling)} actividades no ciclistas descartadas.</p> : null}
      {report.skipped.length ? <p>Quedan {formatCount(report.skipped.length)} archivos pendientes de importar. Se reintentará solo.</p> : null}
    </div> : null}
    <a className="connection-privacy" href="#/privacidad">Cómo tratamos tus datos de Garmin</a>
  </section>;
}
