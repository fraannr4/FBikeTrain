import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { X } from '../icons';
import { useReducedMotion } from '../theme/motion';

type Props = {
  open: boolean;
  /** La pide el botón de cerrar, Escape, un toque en el fondo o el arrastre del asa. */
  onClose: () => void;
  title: string;
  /** Línea bajo el título. */
  sub?: ReactNode;
  /** Pie fijo (botones a todo el ancho). */
  footer?: ReactNode;
  /** Nombre accesible del botón de cerrar; por defecto, «Cerrar». */
  closeLabel?: string;
  /** Acción extra junto al botón de cerrar. */
  headerAction?: ReactNode;
  id?: string;
  className?: string;
  children?: ReactNode;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const EXIT_MS = 260;
const EXIT_REDUCED_MS = 180;

/**
 * Hoja inferior: `<dialog>` modal con asa, título, cuerpo con desplazamiento propio y pie fijo.
 * Sube en 320 ms con la curva de cajón y baja más rápido; con movimiento reducido solo funde.
 * Se cierra con el botón, Escape, un toque en el fondo o arrastrando el asa hacia abajo (por
 * distancia o por velocidad). El foco queda atrapado dentro y, al cerrar, vuelve a quien la abrió.
 * El contenido solo se pinta mientras está abierta o cerrándose.
 */
export function Sheet({ open, onClose, title, sub, footer, closeLabel = 'Cerrar', headerAction, id, className, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = `${useId()}-t`;
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const trigger = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  if (open && !mounted) setMounted(true);

  // Abrir: showModal, bloquear el fondo y, en el fotograma siguiente, deslizar.
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d || !open) return;
    if (d.open) {
      // Se volvió a abrir mientras bajaba: sube otra vez sin cerrar el diálogo.
      d.classList.add('is-open');
      d.style.transform = '';
      return;
    }
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    d.classList.remove('is-open');
    d.style.transform = '';
    d.showModal();
    document.documentElement.style.overflow = 'hidden';
    void d.offsetHeight;
    const raf = requestAnimationFrame(() => d.classList.add('is-open'));
    const first = d.querySelector<HTMLElement>('[autofocus]') ?? d.querySelector<HTMLElement>('.sheet-title');
    first?.focus({ preventScroll: true });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Cerrar: bajar y, al acabar la transición (o al plazo), cerrar el diálogo y devolver el foco.
  useEffect(() => {
    const d = ref.current;
    if (!d || open || !d.open) return;
    d.classList.remove('is-open', 'is-dragging');
    d.style.transform = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (d.open) d.close();
      document.documentElement.style.overflow = '';
      trigger.current?.focus({ preventScroll: true });
      setMounted(false);
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === d) finish();
    };
    d.addEventListener('transitionend', onEnd);
    const t = window.setTimeout(finish, reduced ? EXIT_REDUCED_MS : EXIT_MS);
    return () => {
      d.removeEventListener('transitionend', onEnd);
      window.clearTimeout(t);
    };
  }, [open, reduced]);

  // Al desmontar con la hoja abierta, el fondo vuelve a desplazarse.
  useEffect(
    () => () => {
      document.documentElement.style.overflow = '';
    },
    [],
  );

  const onCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault(); // Escape: que cierre la hoja con su transición
    onCloseRef.current();
  };

  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    const d = ref.current;
    if (!d || e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (e.clientY < r.top || e.clientX < r.left || e.clientX > r.right) onCloseRef.current();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const d = ref.current;
    if (!d) return;
    const f = Array.from(d.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => !n.closest('[hidden]'));
    if (f.length === 0) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !d.contains(document.activeElement))) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  };

  // Arrastre del asa y la cabecera: abajo sigue al dedo; arriba, con fricción.
  const drag = useRef<{ id: number; y0: number; t0: number; dy: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const d = ref.current;
    if (!d || drag.current || e.button > 0) return;
    if ((e.target as Element).closest('button, a, input')) return;
    drag.current = { id: e.pointerId, y0: e.clientY, t0: performance.now(), dy: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    d.classList.add('is-dragging');
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = ref.current;
    const g = drag.current;
    if (!d || !g || e.pointerId !== g.id) return;
    g.dy = e.clientY - g.y0;
    const y = g.dy >= 0 ? g.dy : -Math.sqrt(-g.dy) * 2.2;
    d.style.transform = `translateY(${y}px)`;
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const d = ref.current;
    const g = drag.current;
    if (!d || !g || e.pointerId !== g.id) return;
    drag.current = null;
    d.classList.remove('is-dragging');
    const v = g.dy / Math.max(1, performance.now() - g.t0); // px/ms
    if (g.dy > d.offsetHeight * 0.32 || (g.dy > 24 && v > 0.45)) onCloseRef.current();
    else d.style.transform = '';
  };

  return (
    <dialog
      ref={ref}
      id={id}
      className={className ? `sheet ${className}` : 'sheet'}
      aria-labelledby={titleId}
      onCancel={onCancel}
      onClick={onBackdrop}
      onKeyDown={onKeyDown}
    >
      {mounted ? (
        <>
          <div
            className="sheet-grab"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          >
            <span className="sheet-handle" aria-hidden="true" />
            <div className="sheet-h">
              <h2 className="sheet-title" id={titleId} tabIndex={-1} dir="auto">
                {title}
              </h2>
              {headerAction}
              <button type="button" className="icon-btn" aria-label={closeLabel} onClick={() => onCloseRef.current()}>
                <X className="ic" aria-hidden="true" />
              </button>
            </div>
            {sub ? <p className="sheet-sub">{sub}</p> : null}
          </div>
          <div className="sheet-body">{children}</div>
          {footer ? <div className="sheet-foot">{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  );
}
