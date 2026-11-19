import { useLayoutEffect, useRef } from 'react';
import { useReducedMotion } from '../theme/motion';

export const REVEAL_TIMING: KeyframeAnimationOptions = {
  duration: 320,
  easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
};

/** Entrada al llegar los datos o cambiar de vista, sin remontar hijos ni retrasar la operación.
 * Solo opacidad: los mapas, hojas y botones fijos conservan su sistema de coordenadas. */
export function useContentReveal<T extends HTMLElement>(busy: boolean, identity?: string | null) {
  const ref = useRef<T>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    if (busy || reduced || !ref.current?.animate) return;
    const animation = ref.current.animate([{ opacity: 0.5 }, { opacity: 1 }], REVEAL_TIMING);
    return () => animation.cancel();
  }, [busy, identity, reduced]);
  return ref;
}
