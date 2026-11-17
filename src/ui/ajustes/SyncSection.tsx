import { requestSync, useSyncStatus, type SyncStatus } from '../../sync/status';
import { Disclosure } from '../components/Disclosure';
import { formatCount } from '../format';
import { CircleAlert, RefreshCw, TriangleAlert } from '../icons';

const META: Record<SyncStatus['phase'], string> = {
  idle: 'Al día', syncing: 'Sincronizando…', offline: 'Sin conexión', error: 'Pendiente', full: 'Copia llena',
};

function summary(status: SyncStatus): string {
  if (status.phase === 'syncing') return 'Sincronizando tus datos…';
  if (status.phase === 'offline') return 'Sin conexión. Tus cambios se guardan aquí y se suben al volver la red.';
  if (status.pending > 0 && status.waitingTracks === 0) {
    return status.pending === 1 ? 'Queda 1 dato por subir.' : `Quedan ${formatCount(status.pending)} datos por subir.`;
  }
  if (status.lastAt === null) return 'Se sincroniza sola al abrir la app y después de cada cambio.';
  const time = new Date(status.lastAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return `Todo al día. Última sincronización a las ${time}.`;
}

/** Sincronización entre dispositivos: qué se sube, en qué estado está y un botón para forzarla. */
export function SyncSection({ defaultOpen }: { defaultOpen: boolean }) {
  const status = useSyncStatus();
  const meta = status.pending > 0 && status.phase === 'idle' ? 'Pendiente' : META[status.phase];
  return (
    <Disclosure id="sincronizacion" name="ajustes" icon={RefreshCw} accent="time" title="Sincronización" meta={meta} defaultOpen={defaultOpen}>
      <p className="help">
        Tus salidas con su recorrido, tus rutas, el plan, los objetivos, Casa y tus umbrales se guardan
        cifrados en tu cuenta y aparecen en cualquier dispositivo donde inicies sesión. Las claves de
        servicio propias no salen de este dispositivo.
      </p>
      {status.phase === 'error' || status.phase === 'full' ? null : (
        <p className="status-line" data-tone="info" role="status">
          <RefreshCw className="ic" aria-hidden="true" />
          <span>{summary(status)}</span>
        </p>
      )}
      {status.waitingTracks > 0 ? (
        <p className="status-line" data-tone="warn">
          <TriangleAlert className="ic" aria-hidden="true" />
          <span>
            {status.waitingTracks === 1 ? '1 recorrido espera' : `${formatCount(status.waitingTracks)} recorridos esperan`} a que
            haya wifi para no gastar datos móviles.
          </span>
        </p>
      ) : null}
      {status.phase === 'error' ? (
        <p className="status-line" data-tone="error" role="alert">
          <CircleAlert className="ic" aria-hidden="true" />
          <span>No se ha podido sincronizar. Se reintenta sola en unos minutos.</span>
        </p>
      ) : null}
      {status.phase === 'full' ? (
        <p className="status-line" data-tone="error" role="alert">
          <CircleAlert className="ic" aria-hidden="true" />
          <span>La copia de tu cuenta está llena y no admite más datos. Lo que ya está sincronizado sigue a salvo.</span>
        </p>
      ) : null}
      <button
        type="button" className="btn btn--secondary btn--block"
        disabled={status.phase === 'syncing' || status.phase === 'offline'} onClick={requestSync}
      >
        <RefreshCw className="ic" aria-hidden="true" />
        Sincronizar ahora
      </button>
    </Disclosure>
  );
}
