import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import { NavHistoryProvider } from './navHistory';
import { isSheetState } from './sheetRoute';
import { TabBar } from './TabBar';
import { usePlanBadge } from './usePlanBadge';

/**
 * Armazón: «Saltar al contenido», contenido, barra inferior de cinco pestañas (carril lateral
 * desde 900 px) y avisos. Cada pantalla pinta su propia barra superior (`AppBar`).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const mainRef = useRef<HTMLElement>(null);
  const { pathname, state } = useLocation();
  const navType = useNavigationType();
  const planBadge = usePlanBadge(pathname);
  const overSheet = isSheetState(state);

  // Una pantalla nueva empieza arriba; al volver atrás (POP) o al abrir una hoja sobre la lista, no se toca.
  // Solo cuenta el cambio de ruta: cambiar la búsqueda de la dirección (?orden=…) no es pantalla nueva.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (navType !== 'POP' && !overSheet) window.scrollTo(0, 0);
  }, [pathname, navType, overSheet]);

  // Con HashRouter, ir a «#contenido» cambiaría de ruta: se mueve el foco a mano.
  const skip = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    mainRef.current?.focus();
  };

  return (
    <div className="app">
      <a className="skip" href="#contenido" onClick={skip}>
        Saltar al contenido
      </a>
      <ToastProvider>
        <NavHistoryProvider>
          <main id="contenido" ref={mainRef} tabIndex={-1} className="main">
            {children}
          </main>
        </NavHistoryProvider>
        <TabBar pathname={pathname} planBadge={planBadge} />
      </ToastProvider>
    </div>
  );
}
