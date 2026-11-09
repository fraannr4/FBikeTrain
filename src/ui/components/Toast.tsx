import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from '../icons';
import { useReducedMotion } from '../theme/motion';

export type ToastTone = 'info' | 'good' | 'warn' | 'error';
export type ToastOptions = {
  tone?: ToastTone;
  /** Botón dentro del aviso: «Deshacer». Al pulsarlo, el aviso se cierra. */
  action?: { label: string; onClick: () => void };
  /** Milisegundos; por defecto 4 s, o 6 s con acción. */
  duration?: number;
};
/** Muestra un aviso y devuelve la función que lo cierra. */
export type ToastFn = (text: string, options?: ToastOptions) => () => void;

type Item = { id: number; text: string } & ToastOptions;

const ICONS: Record<ToastTone, LucideIcon> = { info: Info, good: CircleCheck, warn: TriangleAlert, error: CircleAlert };
const MAX = 3;
const EXIT_MS = 180;

const noop: ToastFn = () => () => {};
const ToastContext = createContext<ToastFn>(noop);

/** `toast('Ruta guardada', { tone: 'good' })`. Fuera de un `ToastProvider` no hace nada. */
export function useToast(): ToastFn {
  return useContext(ToastContext);
}

/**
 * Avisos abajo, encima de la barra inferior (o del dock). Como mucho tres; duran 4 s (6 s con
 * acción) y se pausan mientras se tienen pulsados o la pestaña está oculta.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const dismissers = useRef(new Map<number, () => void>());
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    dismissers.current.delete(id);
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastFn>((text, options = {}) => {
    const id = nextId.current++;
    setItems((list) => [...list, { id, text, ...options }]);
    return () => dismissers.current.get(id)?.();
  }, []);

  // Más de tres: se cierran los más antiguos.
  useEffect(() => {
    if (items.length <= MAX) return;
    items.slice(0, items.length - MAX).forEach((t) => dismissers.current.get(t.id)?.());
  }, [items]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Región viva sin role="status": la pantalla tiene sus propios estados de carga. */}
      <div className="toasts" aria-live="polite" aria-relevant="additions text">
        {items.map((t) => (
          <ToastItem
            key={t.id}
            item={t}
            register={(fn) => dismissers.current.set(t.id, fn)}
            onGone={() => remove(t.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  item,
  register,
  onGone,
}: {
  item: Item;
  register: (dismiss: () => void) => void;
  onGone: () => void;
}) {
  const tone = item.tone ?? 'info';
  const Icon = ICONS[tone];
  const reduced = useReducedMotion();
  const [state, setState] = useState<'enter' | 'shown' | 'exit'>('enter');
  const left = useRef(item.duration ?? (item.action ? 6000 : 4000));
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setState('exit');
  }, []);
  register(dismiss);

  const run = useCallback(() => {
    started.current = Date.now();
    timer.current = setTimeout(dismiss, left.current);
  }, [dismiss]);
  const pause = useCallback(() => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    left.current -= Date.now() - started.current;
  }, []);

  // Entrada: un fotograma con data-state="enter" para que la transición arranque.
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setState((s) => (s === 'enter' ? 'shown' : s))));
    run();
    const vis = () => (document.hidden ? pause() : timer.current === null && run());
    document.addEventListener('visibilitychange', vis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', vis);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [run, pause]);

  useEffect(() => {
    if (state !== 'exit') return;
    const t = setTimeout(() => onGoneRef.current(), reduced ? 0 : EXIT_MS);
    return () => clearTimeout(t);
  }, [state, reduced]);

  return (
    <div
      className="toast"
      data-tone={tone}
      data-state={state === 'shown' ? undefined : state}
      onPointerDown={pause}
      onPointerUp={() => {
        if (timer.current === null && state !== 'exit') run();
      }}
    >
      <Icon className="ic" aria-hidden="true" />
      <span className="toast-text">{item.text}</span>
      {item.action ? (
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            item.action?.onClick();
            dismiss();
          }}
        >
          {item.action.label}
        </button>
      ) : null}
    </div>
  );
}
