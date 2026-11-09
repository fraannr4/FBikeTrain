import type { ReactNode } from 'react';
import type { Accent } from '../accent';

type Props = {
  /** Hecho, de 0 en adelante: pasado 1, la primera vuelta se atenúa y lo que sobra va encima. */
  value: number;
  /** Ritmo esperado, de 0 a 1: la muesca (solo mientras no se ha llegado). */
  pace?: number;
  /** Lo que dice el anillo, completo. */
  label: string;
  accent?: Accent;
  /** Centro: cifra (`.ring-v`) y texto pequeño (`.ring-s`). */
  children?: ReactNode;
};

const R = 50;
const C = 2 * Math.PI * R;
const TOPO = [36, 28, 20];

function Arc({ f, lap }: { f: number; lap?: boolean }) {
  return (
    <circle
      className={lap ? 'arc arc--lap' : 'arc'}
      cx="60"
      cy="60"
      r={R}
      strokeDasharray={`${(f * C).toFixed(1)} ${C.toFixed(1)}`}
      transform="rotate(-90 60 60)"
    />
  );
}

/** Anillo de objetivo sobre curvas de nivel, con la muesca del ritmo (como FBT.ring). */
export function Ring({ value, pace, label, accent, children }: Props) {
  const p = Number.isFinite(value) ? Math.max(0, value) : 0;
  const showNotch = pace !== undefined && pace > 0 && pace < 1 && p < 1;
  const a = ((pace ?? 0) * 2 - 0.5) * Math.PI;
  return (
    <div className="ring-wrap" data-m={accent}>
      <svg className="ring" viewBox="0 0 120 120" role="img" aria-label={label}>
        {TOPO.map((r, i) => (
          <ellipse key={r} className="topo" cx={60 + i * 1.5} cy={60 - i} rx={r * 1.06} ry={r * 0.94} />
        ))}
        <circle className="track" cx="60" cy="60" r={R} />
        {p > 1 ? (
          <>
            <Arc f={1} lap />
            <Arc f={Math.min(p - 1, 1)} />
          </>
        ) : p > 0 ? (
          <Arc f={p} />
        ) : null}
        {showNotch ? (
          <line
            className="notch"
            x1={(60 + Math.cos(a) * (R - 9)).toFixed(1)}
            y1={(60 + Math.sin(a) * (R - 9)).toFixed(1)}
            x2={(60 + Math.cos(a) * (R + 9)).toFixed(1)}
            y2={(60 + Math.sin(a) * (R + 9)).toFixed(1)}
          />
        ) : null}
      </svg>
      {children ? (
        <div className="ring-c" aria-hidden="true">
          {children}
        </div>
      ) : null}
    </div>
  );
}
