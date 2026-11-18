import { useCallback, useSyncExternalStore } from 'react';

/** Mismo umbral que escritorio.css; no monta paneles extra en el móvil. */
export const DESKTOP_QUERY = '(min-width: 1024px)';
/** Escritorio ancho: lista y detalle a la vez. */
export const WIDE_QUERY = '(min-width: 1280px)';

export function useDesktopLayout(query: string = DESKTOP_QUERY): boolean {
  // Identidad estable: si cambiara en cada render, React se daría de baja y de alta cada vez.
  const subscribe = useCallback((notify: () => void) => {
    if (typeof window.matchMedia !== 'function') return () => {};
    const media = window.matchMedia(query);
    media.addEventListener('change', notify);
    return () => media.removeEventListener('change', notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches, () => false);
}
