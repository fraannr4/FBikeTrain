import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

function subscribe(cb: () => void): () => void {
  if (!hasMatchMedia()) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}

const getReduced = (): boolean => hasMatchMedia() && window.matchMedia(QUERY).matches;
const serverReduced = (): boolean => false;

/** `true` si el sistema pide movimiento reducido. Sin `matchMedia`, `false`. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getReduced, serverReduced);
}
