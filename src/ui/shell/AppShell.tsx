import { GarminAttributionProvider } from '../components/ActivitySource';
import { useLayoutEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import { NavHistoryProvider } from './navHistory';
import { isSheetState } from './sheetRoute';
import { TabBar } from './TabBar';
import { usePlanBadge } from './usePlanBadge';
import { GentePendingProvider, useGenteCounts } from './GentePendingContext';
import { useAccount } from '../../auth/AccountBoundary';
import { ConnectionsProvider } from '../../connections/ConnectionsProvider';
import { CommunitySync } from '../../social/CommunitySync';
import { DeviceSync } from '../../sync/DeviceSync';
import { GarminProvider } from '../../connections/GarminProvider';
import { useReducedMotion } from '../theme/motion';
import { REVEAL_TIMING } from '../hooks/useContentReveal';
import { tabOf } from './screens';

/**
 * Armazón: «Saltar al contenido», contenido, barra inferior de cinco pestañas (carril lateral
 * desde 900 px, con el grupo «Gente») y avisos. Cada pantalla pinta su propia barra superior (`AppBar`).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const mainRef = useRef<HTMLElement>(null);
  const { pathname, state } = useLocation();
  const navType = useNavigationType();
  const planBadge = usePlanBadge(pathname);
  const account = useAccount();
  const gente = useGenteCounts(account, pathname);
  const overSheet = isSheetState(state);
  const reduced = useReducedMotion();

  // Una pantalla nueva empieza arriba; al volver atrás (POP) o al abrir una hoja sobre la lista, no se toca.
  // Solo cuenta el cambio de ruta: cambiar la búsqueda de la dirección (?orden=…) no es pantalla nueva.
  const lastPath = useRef(pathname);
  useLayoutEffect(() => {
    if (lastPath.current === pathname) return;
    const previous = lastPath.current;
    lastPath.current = pathname;
    if (navType !== 'POP' && !overSheet) window.scrollTo(0, 0);
    // La cabecera acompaña el cambio de pestaña. No transformar main: contiene controles fixed.
    // Web Animations reinicia y cancela el movimiento sin forzar una lectura de layout.
    const main = mainRef.current;
    let animation: Animation | undefined;
    if (main && !overSheet) {
      const tabs = ['inicio', 'historial', 'rutas', 'plan', 'gente', 'mas'];
      const direction = Math.sign(tabs.indexOf(tabOf(pathname)) - tabs.indexOf(tabOf(previous)));
      const head = main.querySelector<HTMLElement>('.page-head');
      if (!reduced && head?.animate) {
        animation = head.animate([
          { transform: `translate(${direction * 10}px, ${direction ? 0 : 6}px)` },
          { transform: 'none' },
        ], REVEAL_TIMING);
      }
      // La barra de pestañas va después del contenido: si el foco se quedara en ella, el siguiente
      // Tab saltaría a la pestaña vecina. Si la pantalla ya ha puesto su propio foco, no se toca.
      const active = document.activeElement;
      if (active && active !== document.body && !main.contains(active)) main.focus({ preventScroll: true });
    }
    return () => animation?.cancel();
  }, [pathname, navType, overSheet, reduced]);

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
        <CommunitySync />
        <DeviceSync />
        <ConnectionsProvider>
        <GarminProvider>
        <GarminAttributionProvider><NavHistoryProvider>
          <main id="contenido" ref={mainRef} tabIndex={-1} className="main">
            <GentePendingProvider value={gente}>{children}</GentePendingProvider>
          </main>
        </NavHistoryProvider></GarminAttributionProvider>
        <TabBar pathname={pathname} planBadge={planBadge} gente={gente} />
        </GarminProvider>
        </ConnectionsProvider>
      </ToastProvider>
    </div>
  );
}
