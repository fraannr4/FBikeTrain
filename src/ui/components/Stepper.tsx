import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { formatNumber } from '../format';
import { Minus, Plus } from '../icons';

type Props = {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  /** Nombre del valor: «Distancia». Da nombre al grupo y a los botones («Menos distancia»). */
  label: string;
  /** Unidad tras la cifra: «km». */
  unit?: string;
  decimals?: number;
  className?: string;
};

const FIRST_DELAY_MS = 420;
const SLOW_MS = 90;
const FAST_MS = 55;

/**
 * Cifra grande entre «−» y «+». Pulsar suma un paso; mantener pulsado repite y acelera (tras 6
 * repeticiones va más deprisa; tras 12, de dos en dos pasos). Con teclado, cada pulsación es un paso.
 * El lector de pantalla oye el valor una vez, al soltar, y no cada cifra intermedia.
 */
export function Stepper({ value, onChange, min, max, step, label, unit, decimals = 0, className }: Props) {
  const current = useRef(value);
  current.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [announced, setAnnounced] = useState('');

  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v / step) * step));
  const set = (v: number) => {
    const next = clamp(v);
    if (next !== current.current) {
      current.current = next;
      onChangeRef.current(next);
    }
  };
  const text = (v: number) => `${formatNumber(v, decimals)}${unit ? ` ${unit}` : ''}`;

  const stop = () => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
    setAnnounced(text(current.current));
  };
  // Al desmontar con el botón pulsado, no queda un temporizador vivo.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const press = (dir: 1 | -1) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button > 0) return;
    set(current.current + dir * step);
    let n = 0;
    const rep = (delay: number) => {
      timer.current = setTimeout(() => {
        n++;
        set(current.current + dir * step * (n > 12 ? 2 : 1));
        rep(n > 6 ? FAST_MS : SLOW_MS);
      }, delay);
    };
    rep(FIRST_DELAY_MS);
  };
  // Teclado (detail 0): un paso por pulsación. El puntero ya lo sumó en pointerdown.
  const click = (dir: 1 | -1) => (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail !== 0) return;
    set(current.current + dir * step);
    setAnnounced(text(current.current));
  };

  const atMin = value <= min;
  const atMax = value >= max;
  const name = label.toLocaleLowerCase('es-ES');

  return (
    <div className={className ? `stepper ${className}` : 'stepper'} role="group" aria-label={label}>
      <button
        type="button"
        className="stepper-btn"
        aria-label={`Menos ${name}`}
        aria-disabled={atMin}
        onPointerDown={atMin ? undefined : press(-1)}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onClick={atMin ? undefined : click(-1)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Minus className="ic" aria-hidden="true" />
      </button>
      <output className="stepper-v">
        <span className="fig">{formatNumber(value, decimals)}</span>
        {unit ? <span className="u">{unit}</span> : null}
      </output>
      <button
        type="button"
        className="stepper-btn"
        aria-label={`Más ${name}`}
        aria-disabled={atMax}
        onPointerDown={atMax ? undefined : press(1)}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onClick={atMax ? undefined : click(1)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Plus className="ic" aria-hidden="true" />
      </button>
      <span className="sr-only" aria-live="polite">
        {announced}
      </span>
    </div>
  );
}
