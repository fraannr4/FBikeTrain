import { useState, useSyncExternalStore } from 'react';
import { canInstall, installApp, subscribeInstall } from '../../pwa/register';

export function InstallApp() {
  const available = useSyncExternalStore(subscribeInstall, canInstall, () => false);
  const [error, setError] = useState(false);
  const installed = window.matchMedia('(display-mode: standalone)').matches;
  return <section className="section" aria-label="Instalar la app">
    {available ? <button className="btn btn--secondary btn--block" onClick={() => {
      void installApp().catch(() => setError(true));
    }}>Instalar la app</button> : null}
    <p className="run-sub">{error ? 'No se pudo abrir el aviso. Prueba desde el menú del navegador.' : installed ? 'Ya estás usando la app instalada.' : available ? 'Añade FBikeTrain al teléfono para recibir ficheros compartidos.' : 'Para instalar la app, usa el menú del navegador.'}</p>
  </section>;
}
