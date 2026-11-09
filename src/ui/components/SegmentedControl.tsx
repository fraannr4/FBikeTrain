import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from '../icons';

/** `lead`: marca propia antes del texto (las barras de dificultad), en lugar de `icon`. Va con aria-hidden. */
type Option<T extends string> = { value: T; label: string; icon?: LucideIcon; lead?: ReactNode };

type Props<T extends string> = {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Indicador neutro en vez del relleno de acción. */
  quiet?: boolean;
  className?: string;
};

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const indStyle = (i: number): CSSProperties => ({ transform: `translateX(${i * 100}%)` });

/**
 * Segmentado para elegir un valor dentro de una pantalla (periodo, tema): `div[role=group]` con
 * botones `aria-pressed`. El indicador `.seg-ind` se desliza con `transform`. Flechas izquierda y
 * derecha cambian de opción.
 */
export function SegmentedControl<T extends string>({ label, options, value, onChange, quiet, className }: Props<T>) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = refs.current.findIndex((b) => b === document.activeElement);
    if (i < 0) return;
    const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(options[next].value);
  };

  return (
    <div
      role="group"
      aria-label={label}
      className={cx('seg', quiet && 'seg--quiet', className)}
      style={{ '--n': options.length } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      <span className="seg-ind" aria-hidden="true" style={indStyle(index)} />
      {options.map(({ value: v, label: text, icon: Icon, lead }, i) => (
        <button
          key={v}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v)}
        >
          {Icon ? <Icon className="ic" aria-hidden="true" /> : lead}
          <span>{text}</span>
        </button>
      ))}
    </div>
  );
}

export type NavItem = { to: string; label: string; icon?: LucideIcon };

/** Última posición del indicador por segmentado, para deslizarlo entre pantallas. */
const lastIndex = new Map<string, number>();

/**
 * Segmentado de vistas que son pantallas distintas (Historial: Salidas, Subidas, Repetidas; Plan:
 * Calendario, Objetivos): `nav.seg.seg--quiet` con enlaces y `aria-current="page"`. Al cambiar de
 * vista, el indicador sale de donde estaba en la pantalla anterior y se desliza a la nueva. Cambiar de
 * vista sustituye la entrada del historial: «atrás» sale de la pestaña, no recorre las vistas.
 */
export function SegmentedNav({ label, items, current }: { label: string; items: NavItem[]; current: string }) {
  const index = Math.max(
    0,
    items.findIndex((it) => it.to === current),
  );
  const ind = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ind.current;
    const from = lastIndex.get(label);
    lastIndex.set(label, index);
    if (!el || from === undefined || from === index) return;
    el.style.transition = 'none';
    el.style.transform = `translateX(${from * 100}%)`;
    void el.offsetWidth; // fija la posición de partida antes de la transición
    el.style.transition = '';
    el.style.transform = `translateX(${index * 100}%)`;
  }, [label, index]);

  return (
    <nav aria-label={label} className="seg seg--quiet" style={{ '--n': items.length } as CSSProperties}>
      <span ref={ind} className="seg-ind" aria-hidden="true" style={indStyle(index)} />
      {items.map((it, i) => (
        <Link key={it.to} to={it.to} replace aria-current={i === index ? 'page' : undefined}>
          {it.icon ? <it.icon className="ic" aria-hidden="true" /> : null}
          <span>{it.label}</span>
        </Link>
      ))}
    </nav>
  );
}
