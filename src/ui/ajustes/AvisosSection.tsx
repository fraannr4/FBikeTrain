import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { disablePush, enablePush, getPushState, PushError, type PushState } from '../../pwa/push';
import { Disclosure } from '../components/Disclosure';
import { Skeleton } from '../components/Skeleton';
import { Bell, CircleAlert, TriangleAlert } from '../icons';

type View = PushState | 'loading' | 'failed';

const META: Record<View, string> = {
  loading: 'Cargando…', failed: 'No disponible', unsupported: 'No disponible', 'needs-install': 'Instala la app',
  denied: 'Bloqueados', off: 'Desactivados', on: 'Activados',
};
const ERRORS: Record<string, string> = {
  save: 'No se han podido activar los avisos. Inténtalo de nuevo.',
  limit: 'Ya tienes avisos en 10 dispositivos. Desactívalos en otro antes de añadir este.',
  unsupported: 'Este navegador no puede activar los avisos ahora mismo. Recarga la app e inténtalo de nuevo.',
};

function Notice({ children, role }: { children: string; role?: 'alert' }) {
  return (
    <p className="status-line" data-tone="warn" role={role}>
      <TriangleAlert className="ic" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Avisos push de retos y solicitudes de amistad. El permiso del navegador se pide solo al activar el
 * interruptor, nunca al cargar la pantalla.
 */
export function AvisosSection({ client, defaultOpen }: { client: SupabaseClient; defaultOpen: boolean }) {
  const [view, setView] = useState<View>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getPushState().then(
      state => { if (alive) setView(state); },
      () => { if (alive) setView('failed'); },
    );
    return () => { alive = false; };
  }, []);

  async function toggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (next) await enablePush(client); else await disablePush(client);
      setView(next ? 'on' : 'off');
    } catch (cause) {
      if (cause instanceof PushError && cause.code === 'denied') setView('denied');
      else setError(ERRORS[cause instanceof PushError ? cause.code : 'save']);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Disclosure id="avisos" name="ajustes" icon={Bell} accent="time" title="Avisos" meta={META[view]} defaultOpen={defaultOpen}>
      {view === 'loading' ? <Skeleton width="60%" /> : null}
      {view === 'failed' ? <Notice>No se ha podido comprobar el estado de los avisos. Vuelve a abrir Ajustes.</Notice> : null}
      {view === 'unsupported' ? <Notice>Este navegador no admite avisos. Prueba con Chrome, Edge o Firefox, o con la app instalada en el móvil.</Notice> : null}
      {view === 'needs-install' ? (
        <>
          <Notice>Añade la app a la pantalla de inicio para recibir avisos</Notice>
          <p className="help">En Safari, pulsa Compartir, elige Añadir a pantalla de inicio y abre la app desde su icono.</p>
        </>
      ) : null}
      {view === 'denied' ? (
        <Notice>Has bloqueado los avisos de este sitio. Para recibirlos, permite las notificaciones de este sitio en los ajustes del navegador o del sistema y vuelve aquí.</Notice>
      ) : null}
      {view === 'off' || view === 'on' ? (
        <label className="switch-line">
          <span className="row-main">
            <span className="row-title" id="sw-avisos">Recibir avisos en este dispositivo</span>
            <span className="row-meta" id="sw-avisos-d">Te avisamos de retos y de solicitudes de amistad. Los avisos no llevan nombres ni ubicaciones.</span>
          </span>
          <input
            type="checkbox" className="switch-input" checked={view === 'on'} disabled={busy}
            aria-labelledby="sw-avisos" aria-describedby="sw-avisos-d"
            onChange={event => void toggle(event.target.checked)}
          />
          <span className="switch" aria-hidden="true" />
        </label>
      ) : null}
      {error ? (
        <p className="status-line" data-tone="error" role="alert">
          <CircleAlert className="ic" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </Disclosure>
  );
}
