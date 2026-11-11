import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FBT_READY, READY_TIMEOUT_MS } from '../../bookmarklet/protocol';
import { isWikilocUrl } from '../../routes/wikilocLimits';
import { saveNearby, saveReceivedTrack, WikilocMessageSchema } from '../../routes/wikilocNearby';
import { Page } from '../components/Page';
import { StateView } from '../components/StateView';
import { useToast } from '../components/Toast';
import { formatCount } from '../format';
import { CircleAlert, Clock, ExternalLink, LoaderCircle } from '../icons';

type Phase = 'waiting' | 'no-opener' | 'invalid' | 'error' | 'timeout';

/** Origen de una página de Wikiloc: https, sin puerto, wikiloc.com o un subdominio suyo. */
const isWikilocOrigin = (origin: string) => isWikilocUrl(origin) && new URL(origin).origin === origin;

/** Margen sobre la espera del marcador antes de decir que no han llegado datos. */
const WAIT_MS = READY_TIMEOUT_MS + 5_000;

const BACK = (
  <Link className="btn btn--secondary" to="/rutas/wikiloc">
    Ir a Rutas de Wikiloc cerca
  </Link>
);

/**
 * `#/rutas/wikiloc/recibir`: la ventana que abre el marcador. Avisa a la pestaña de Wikiloc de que está
 * lista y acepta un único mensaje de esa ventana con origen `https://*.wikiloc.com`. Lo valida con el
 * esquema del marcador, lo guarda y lleva a la lista o a la adaptación. Nunca pinta HTML recibido.
 */
export function WikilocRecibir() {
  const navigate = useNavigate();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>(() => (window.opener ? 'waiting' : 'no-opener'));

  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) return;
    let done = false;
    let alive = true;
    const onMessage = async (event: MessageEvent) => {
      if (done || event.source !== opener || !isWikilocOrigin(event.origin)) return;
      const parsed = WikilocMessageSchema.safeParse(event.data);
      if (!parsed.success) {
        setPhase('invalid');
        return;
      }
      done = true;
      const message = parsed.data;
      try {
        if (message.kind === 'list') {
          await saveNearby(message.rutas);
          if (!alive) return;
          const n = message.rutas.length;
          toast(n === 1 ? 'Recibida 1 ruta de Wikiloc' : `Recibidas ${formatCount(n)} rutas de Wikiloc`, { tone: 'good' });
          navigate('/rutas/wikiloc', { replace: true });
        } else {
          await saveReceivedTrack(message);
          if (!alive) return;
          toast(`Recibida «${message.nombre}»`, { tone: 'good' });
          navigate('/rutas/wikiloc/adaptar', { replace: true });
        }
      } catch {
        if (alive) setPhase('error');
      }
    };
    window.addEventListener('message', onMessage);
    // Solo el aviso, sin datos: no hace falta conocer el subdominio de Wikiloc que abrió la app.
    opener.postMessage(FBT_READY, '*');
    const timer = setTimeout(() => {
      if (!done && alive) setPhase((p) => (p === 'waiting' ? 'timeout' : p));
    }, WAIT_MS);
    return () => {
      alive = false;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };
  }, [navigate, toast]);

  let view;
  if (phase === 'no-opener') {
    view = (
      <StateView
        icon={ExternalLink}
        level={2}
        title="Abre esta pantalla desde el marcador"
        text="Aquí llegan las rutas que envía el marcador «→ FBikeTrain» desde una página de Wikiloc."
        action={BACK}
      />
    );
  } else if (phase === 'invalid') {
    view = (
      <StateView
        icon={CircleAlert}
        tone="error"
        level={2}
        title="Los datos recibidos no son válidos"
        text="No se ha guardado nada. El marcador puede estar desactualizado: vuelve a instalarlo desde Rutas de Wikiloc cerca."
        action={BACK}
      />
    );
  } else if (phase === 'error') {
    view = (
      <StateView
        icon={CircleAlert}
        tone="error"
        level={2}
        title="No se han podido guardar los datos"
        text="El almacenamiento del navegador no responde. Vuelve a pulsar el marcador en Wikiloc."
        action={BACK}
      />
    );
  } else if (phase === 'timeout') {
    view = (
      <StateView
        icon={Clock}
        level={2}
        title="No han llegado datos del marcador"
        text="Vuelve a la pestaña de Wikiloc y pulsa otra vez el marcador."
        action={BACK}
      />
    );
  } else {
    view = (
      <StateView
        icon={LoaderCircle}
        level={2}
        title="Esperando los datos del marcador"
        text="Llegan en unos segundos desde la pestaña de Wikiloc."
      />
    );
  }

  return (
    <Page title="Recibir de Wikiloc" back="/rutas/wikiloc" variant="narrow" busy={phase === 'waiting'}>
      <section className="section card" aria-live="polite">
        {view}
      </section>
    </Page>
  );
}
