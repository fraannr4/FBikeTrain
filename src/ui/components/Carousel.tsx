import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardedRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ChevronLeft, ChevronRight } from '../icons';
import { useReducedMotion } from '../theme/motion';

export type CarouselHandle = { go: (index: number) => void; index: () => number };

type Props<T> = {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string;
  /** Nombre del carrusel: «Propuestas de ruta». */
  label: string;
  /** Cuando cambia la tarjeta visible (al deslizar o con las flechas). */
  onIndexChange?: (index: number) => void;
  /** Al cambiar (otra búsqueda, otro filtro), el carrusel vuelve a la primera tarjeta. */
  resetKey?: unknown;
  className?: string;
};

function CarouselInner<T>(
  { items, renderItem, getKey, label, onIndexChange, resetKey, className }: Props<T>,
  ref: ForwardedRef<CarouselHandle>,
) {
  const track = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const onIndexRef = useRef(onIndexChange);
  onIndexRef.current = onIndexChange;
  const reduced = useReducedMotion();
  const count = items.length;

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return 0;
    const s = el.children;
    if (s.length < 2) return 0;
    if (el.scrollLeft >= el.scrollWidth - el.clientWidth - 2) return s.length - 1;
    const w = (s[1] as HTMLElement).offsetLeft - (s[0] as HTMLElement).offsetLeft;
    return w > 0 ? Math.max(0, Math.min(s.length - 1, Math.round(el.scrollLeft / w))) : 0;
  }, []);

  const go = useCallback(
    (i: number) => {
      const el = track.current;
      if (!el || el.children.length === 0) return;
      const n = Math.max(0, Math.min(el.children.length - 1, i));
      const first = el.children[0] as HTMLElement;
      const target = el.children[n] as HTMLElement;
      el.scrollTo?.({ left: target.offsetLeft - first.offsetLeft, behavior: reduced ? 'auto' : 'smooth' });
    },
    [reduced],
  );

  useImperativeHandle(ref, () => ({ go, index: () => indexRef.current }), [go]);

  // Con otras tarjetas (otra búsqueda), vuelve a la primera.
  useEffect(() => {
    const el = track.current;
    if (el) el.scrollLeft = 0;
    indexRef.current = 0;
    setIndex(0);
  }, [count, resetKey]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const i = measure();
        if (i === indexRef.current) return;
        indexRef.current = i;
        setIndex(i);
        onIndexRef.current?.(i);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [measure]);

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.target !== e.currentTarget || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    go(indexRef.current + (e.key === 'ArrowRight' ? 1 : -1));
  };

  return (
    <div className={className ? `carousel-wrap ${className}` : 'carousel-wrap'}>
      {/* La pista se recorre con las flechas: necesita el foco. */}
      <ul ref={track} className="carousel" tabIndex={0} aria-label={label} onKeyDown={onKeyDown}>
        {items.map((it, i) => (
          <li key={getKey(it, i)} aria-label={`${i + 1} de ${count}`}>
            {renderItem(it, i)}
          </li>
        ))}
      </ul>
      {count > 1 ? (
        <div className="pager">
          <button
            type="button"
            className="icon-btn"
            aria-label="Anterior"
            aria-disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            <ChevronLeft className="ic" aria-hidden="true" />
          </button>
          <div className="pager-mid">
            <span className="pager-count" aria-live="polite">
              {index + 1} de {count}
            </span>
            <span className="pager-dots" aria-hidden="true">
              {items.map((it, i) => (
                <i key={getKey(it, i)} data-on={i === index ? '' : undefined} />
              ))}
            </span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Siguiente"
            aria-disabled={index === count - 1}
            onClick={() => go(index + 1)}
          >
            <ChevronRight className="ic" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Carrusel deslizable: una tarjeta y el asomo de la siguiente, con «snap» y paginador («2 de 5»,
 * puntos y flechas). Las flechas del teclado mueven la pista cuando tiene el foco.
 */
export const Carousel = forwardRef(CarouselInner) as <T>(
  props: Props<T> & { ref?: ForwardedRef<CarouselHandle> },
) => ReturnType<typeof CarouselInner>;
