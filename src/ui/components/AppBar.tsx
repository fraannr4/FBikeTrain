import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from '../icons';
import { BrandMark } from '../shell/BrandMark';
import { useBack } from '../shell/navHistory';
import { useReducedMotion } from '../theme/motion';

type Props = {
  /** Nombre de la pantalla: aparece en la barra al desplazar, cuando el título grande ya no se ve. */
  title: string;
  /** Pantalla madre (ruta). Con ella, la barra lleva «Volver a X»; sin ella, la marca. */
  back?: string;
  /** Botones de icono a la derecha (`.icon-btn`, 44 × 44). */
  actions?: ReactNode;
};

/**
 * Barra superior compacta. Las pantallas raíz de cada pestaña llevan la marca; las demás, la flecha
 * de volver, que usa el historial si se llegó desde otra pantalla y dice a cuál vuelve. Se vuelve de
 * vidrio cuando el título grande (`.page-title`) pasa por debajo.
 */
export function AppBar({ title, back, actions }: Props) {
  const ref = useRef<HTMLElement>(null);
  useScrolled(ref);
  return (
    <header ref={ref} className="appbar">
      <div className="appbar-lead">{back ? <BackButton parent={back} /> : <Brand />}</div>
      <span className="appbar-title" aria-hidden="true">
        {title}
      </span>
      <div className="appbar-actions">{actions}</div>
    </header>
  );
}

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="FBikeTrain, inicio">
      <BrandMark />
      <span className="brand-name" aria-hidden="true">
        FBikeTrain
      </span>
    </Link>
  );
}

function BackButton({ parent }: { parent: string }) {
  const back = useBack(parent);
  useEdgeSwipe(back.go);
  return (
    <Link to={back.to} className="icon-btn" aria-label={back.label} onClick={back.onClick}>
      <ChevronLeft className="ic ic-lg" aria-hidden="true" />
    </Link>
  );
}

/** `data-scrolled` en la barra cuando el título grande de su página deja de verse. */
function useScrolled(ref: RefObject<HTMLElement>) {
  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const title = bar.parentElement?.querySelector('.page-title');
    if (title && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        ([e]) => bar.toggleAttribute('data-scrolled', !e.isIntersecting && e.boundingClientRect.top < 80),
        { rootMargin: `-${Math.round(bar.offsetHeight)}px 0px 0px 0px`, threshold: 0 },
      );
      io.observe(title);
      return () => io.disconnect();
    }
    const onScroll = () => bar.toggleAttribute('data-scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [ref]);
}

const EDGE = 16;
const GO = 72;
const MAX = 96;
/** Donde nace un arrastre propio, el gesto de volver no empieza. */
const DRAGGABLE = '[role="slider"], .scrub, .passes svg, .carousel, .chips-scroll';

/**
 * Volver deslizando desde el borde izquierdo (los primeros 16 px) hacia la derecha. Un círculo con la
 * flecha acompaña al dedo; pasados 72 px se vuelve azul y, al soltar, vuelve. Con movimiento
 * reducido solo aparece y desaparece. No nace con una hoja abierta ni sobre un control que se arrastra.
 */
function useEdgeSwipe(go: () => void) {
  const reduced = useReducedMotion();
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    if (!('ontouchstart' in window)) return;
    const ind = document.createElement('span');
    ind.className = 'edge-back';
    ind.setAttribute('aria-hidden', 'true');
    ind.innerHTML =
      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
    document.body.appendChild(ind);

    let t: { x0: number; y0: number; on: boolean; dx: number } | null = null;
    const paint = (dx: number) => {
      const ready = dx >= GO;
      ind.toggleAttribute('data-ready', ready);
      ind.style.opacity = String(Math.min(1, dx / GO));
      if (!reduced) ind.style.transform = `translateX(${Math.min(dx, MAX) - 56}px) scale(${ready ? 1.06 : 1})`;
    };
    const settle = () => {
      ind.classList.add('is-settling');
      ind.style.opacity = '0';
      ind.style.transform = '';
      ind.removeAttribute('data-ready');
      window.setTimeout(() => ind.classList.remove('is-settling'), 220);
    };
    const start = (e: TouchEvent) => {
      t = null;
      if (e.touches.length !== 1 || document.querySelector('dialog[open]')) return;
      const target = e.target as Element | null;
      if (target?.closest?.(DRAGGABLE)) return;
      const p = e.touches[0];
      if (p.clientX < EDGE) t = { x0: p.clientX, y0: p.clientY, on: false, dx: 0 };
    };
    const move = (e: TouchEvent) => {
      if (!t) return;
      const p = e.touches[0];
      const dx = p.clientX - t.x0;
      const dy = Math.abs(p.clientY - t.y0);
      if (!t.on) {
        if (dy > 12 && dy > dx) {
          t = null; // es un desplazamiento vertical
          return;
        }
        if (dx > 10) t.on = true;
        else return;
      }
      t.dx = dx;
      paint(dx);
    };
    const end = () => {
      if (!t) return;
      const ok = t.on && t.dx >= GO;
      t = null;
      settle();
      if (ok) goRef.current();
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
    return () => {
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
      ind.remove();
    };
  }, [reduced]);
}
