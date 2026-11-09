import { memo, useRef } from 'react';
import type { KmProfile } from '../climbView';
import { formatNumber } from '../format';
import { useElementSize } from '../hooks/useElementWidth';
import { gradeClass } from './grade';

type Props = {
  profile: KmProfile;
  /** Lo que dice el perfil, completo: inicio, cima y el kilómetro más duro. */
  label: string;
};

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const PAD_T = 26;
const PAD_B = 24;

/**
 * Perfil de puerto como en el libro de ruta (FBT.climb): un bloque por kilómetro, coloreado por su
 * pendiente (`--g0` a `--g5`), con la cifra encima y la del más duro en cursiva. Se mide y se vuelve
 * a pintar al cambiar de ancho, para que el texto no se deforme.
 */
export const ClimbChart = memo(function ClimbChart({ profile, label }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const size = useElementSize(ref);
  const W = size.width || 320;
  const H = size.height || 140;
  const { marks, eles, grades, lengthKm: L } = profile;

  const top = Math.max(...eles);
  const lo = eles[0] - (top - eles[0]) * 0.3;
  const span = top - lo || 1;
  const X = (km: number) => (km / L) * (W - 2) + 1;
  const Y = (e: number) => PAD_T + (1 - (e - lo) / span) * (H - PAD_T - PAD_B);
  const base = H - PAD_B;
  const steep = grades.indexOf(Math.max(...grades));
  const bw = X(1) - X(0);
  const every = bw >= 30 ? 1 : bw >= 15 ? 2 : 5;

  const ticks: { x: number; anchor: 'start' | 'middle'; text: string }[] = [];
  for (let k = 0; k < L; k += every) {
    if (X(L) - X(k) < 56) continue; // que la última marca no se pegue a «7,6 km»
    ticks.push({ x: k ? X(k) : 0, anchor: k ? 'middle' : 'start', text: String(k) });
  }
  const edge = eles.map((e, j) => `${j ? 'L' : 'M'}${f1(X(marks[j]))} ${f1(Y(e))}`).join('');

  return (
    <svg ref={ref} className="climb" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <g className="blocks">
        {grades.map((g, i) => {
          const x0 = f1(X(marks[i]));
          const x1 = f1(X(marks[i + 1]));
          return (
            <polygon
              key={i}
              className={`g${gradeClass(g)}`}
              points={`${x0},${base} ${x0},${f1(Y(eles[i]))} ${x1},${f1(Y(eles[i + 1]))} ${x1},${base}`}
            />
          );
        })}
      </g>
      <g className="cuts">
        {grades.map((_, i) =>
          i && X(marks[i + 1]) - X(marks[i]) >= 8 ? (
            <line key={i} x1={f1(X(marks[i]))} x2={f1(X(marks[i]))} y1={f1(Y(eles[i]))} y2={base} />
          ) : null,
        )}
      </g>
      <path className="edge" d={edge} />
      <line className="base" x1={0} x2={W} y1={base} y2={base} />
      <g className="labels" aria-hidden="true">
        {grades.map((g, i) => {
          const x0 = X(marks[i]);
          const x1 = X(marks[i + 1]);
          if (x1 - x0 < 26 && i !== steep) return null;
          const lx = Math.min(Math.max((x0 + x1) / 2, 12), W - 12);
          return (
            <text
              key={i}
              className={i === steep ? 'gl gl--max' : 'gl'}
              x={f1(lx)}
              y={f1(Math.min(Y(eles[i]), Y(eles[i + 1])) - 8)}
              textAnchor="middle"
            >
              {formatNumber(g, 1)}
            </text>
          );
        })}
      </g>
      <g className="ticks" aria-hidden="true">
        {ticks.map((t) => (
          <text key={t.text} x={f1(t.x)} y={H - 6} textAnchor={t.anchor}>
            {t.text}
          </text>
        ))}
        <text x={W} y={H - 6} textAnchor="end">
          {`${formatNumber(L, 1)} km`}
        </text>
      </g>
    </svg>
  );
});
