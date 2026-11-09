import { useEffect, useState, type RefObject } from 'react';

type Size = { width: number; height: number };

/** Ancho y alto del elemento, con `ResizeObserver` y un pequeño retardo para no repintar en cada píxel. */
export function useElementSize(ref: RefObject<Element>, debounceMs = 60): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      const r = el.getBoundingClientRect();
      const next = { width: Math.round(r.width), height: Math.round(r.height) };
      setSize((s) => (s.width === next.width && s.height === next.height ? s : next));
    };
    read();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(read, debounceMs);
    });
    ro.observe(el);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [ref, debounceMs]);

  return size;
}

/** Ancho del elemento en px (0 hasta que se mide). */
export function useElementWidth(ref: RefObject<Element>, debounceMs = 60): number {
  return useElementSize(ref, debounceMs).width;
}
