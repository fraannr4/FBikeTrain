import { useId, useMemo } from 'react';
import { sparkPath } from './sparkPath';

const W = 200;
const H = 34;

/**
 * Chispa de 8 semanas en el acento de su KPI (`--acc`): área en degradado, tu media en
 * discontinua y el último punto con anillo. El SVG se estira al ancho de la tarjeta; el
 * anillo es HTML para que siga redondo.
 */
export function Sparkline({ values, mean }: { values: number[]; mean?: number }) {
  const id = `sp${useId().replace(/:/g, '')}`;
  const s = useMemo(() => sparkPath(values, W, H, mean), [values, mean]);

  return (
    <span className="spark" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="spark-stop-top" />
            <stop offset="1" className="spark-stop-bottom" />
          </linearGradient>
        </defs>
        <path d={s.area} fill={`url(#${id})`} />
        {s.meanY !== undefined ? <line className="spark-mean" x1="0" x2={W} y1={s.meanY} y2={s.meanY} /> : null}
        <path className="spark-glow" d={s.line} />
        <path className="spark-line" d={s.line} />
      </svg>
      <span className="spark-dot" style={{ left: `${(s.last.x / W) * 100}%`, top: `${(s.last.y / H) * 100}%` }} />
    </span>
  );
}
