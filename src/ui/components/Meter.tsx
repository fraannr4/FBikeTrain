import type { CSSProperties, ReactNode } from 'react';
import type { Accent } from '../accent';

type Props = {
  /** Hecho, de 0 a 1 (más de 1 llena la barra). */
  value: number;
  /** Dónde deberías ir para llegar a tiempo, de 0 a 1: la muesca. Sin él, no hay muesca. */
  pace?: number;
  /** Lo que dice la barra, completo: «25 % del objetivo; vas 41 km por delante del ritmo». */
  label: string;
  /** Color de la métrica; por defecto, el de «bien». */
  accent?: Accent;
  /** Leyenda bajo la barra (`.meter-legend`). */
  legend?: ReactNode;
};

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** Medidor de objetivo con la muesca del ritmo esperado. */
export function Meter({ value, pace, label, accent, legend }: Props) {
  const style = { '--p': clamp01(value), ...(pace !== undefined ? { '--pace': clamp01(pace) } : {}) } as CSSProperties;
  return (
    <>
      <div className="meter" role="img" aria-label={label} data-m={accent} style={style}>
        <i />
        {pace !== undefined ? <b /> : null}
      </div>
      {legend ? <div className="meter-legend">{legend}</div> : null}
    </>
  );
}
