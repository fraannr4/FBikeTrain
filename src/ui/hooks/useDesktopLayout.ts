import { useSyncExternalStore } from 'react';

/** Mismo umbral que escritorio.css; no monta paneles extra en el móvil. */
export function useDesktopLayout(query = '(min-width: 1024px)'): boolean {
  const subscribe = (notify: () => void) => {
    if (typeof window.matchMedia !== 'function') return () => {};
    const media = window.matchMedia(query);
    media.addEventListener('change', notify);
    return () => media.removeEventListener('change', notify);
  };
  return useSyncExternalStore(subscribe, () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches, () => false);
}
