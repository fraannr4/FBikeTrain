import { Component, lazy, type ComponentType, type ReactNode } from 'react';
import { RefreshCw, TriangleAlert } from '../icons';
import { StateView } from '../components/StateView';

const RELOAD_KEY = 'fbiketrain-chunk-reload';
const RELOAD_WINDOW_MS = 15_000;

const reloadPage = () => window.location.reload();

/**
 * Tras un despliegue, una pestaña abierta pide fragmentos con nombre antiguo y el servidor ya no
 * los tiene. La primera vez se recarga la web para coger la versión nueva; si vuelve a fallar
 * enseguida (sin red), se enseña un estado con «Reintentar» en lugar de recargar en bucle.
 */
function recoverOnce(error: unknown, reload: () => void): Promise<never> {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
  } catch {
    /* Sin sessionStorage no se puede recordar el intento: se prefiere el estado de error. */
    last = Date.now();
  }
  if (Date.now() - last < RELOAD_WINDOW_MS) return Promise.reject(error);
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* Ya cubierto arriba. */
  }
  reload();
  // La recarga sustituye la página: la carga queda pendiente y se ve el fallback.
  return new Promise<never>(() => {});
}

class LoadBoundary extends Component<{ onRetry: () => void; children: () => ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  retry = () => {
    this.props.onRetry();
    this.setState({ failed: false });
  };
  render() {
    if (!this.state.failed) return this.props.children();
    return (
      <StateView
        tone="error"
        level={2}
        icon={TriangleAlert}
        title="No se ha podido cargar esta pantalla"
        text="Revisa la conexión y vuelve a intentarlo."
        action={
          <button type="button" className="btn btn--primary" onClick={this.retry}>
            <RefreshCw className="ic" aria-hidden="true" />
            Reintentar
          </button>
        }
      />
    );
  }
}

/** Pantalla que se descarga al entrar en ella. Exige un `Suspense` por encima. */
export function lazyPage(
  load: () => Promise<{ default: ComponentType }>,
  reload: () => void = reloadPage,
): ComponentType & { preload: () => void } {
  const make = () => lazy(() => load().catch((error: unknown) => recoverOnce(error, reload)));
  let Inner = make();
  const Page = () => (
    <LoadBoundary onRetry={() => { Inner = make(); }}>
      {() => <Inner />}
    </LoadBoundary>
  );
  /** Descarga el fragmento sin pintarlo; un fallo aquí no molesta, ya reintentará al entrar. */
  Page.preload = () => { void load().catch(() => {}); };
  return Page;
}

/** Precarga fragmentos cuando el navegador está ocioso, salvo con ahorro de datos o conexión lenta. */
export function preloadWhenIdle(pages: { preload: () => void }[]): () => void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')) return () => {};
  const run = () => pages.forEach((page) => page.preload());
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: 4000 });
    return () => cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 2500);
  return () => window.clearTimeout(id);
}
