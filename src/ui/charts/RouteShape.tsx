import { memo, useMemo } from 'react';
import type { LatLng } from '../../domain/types';
import { shapePath } from './shape';

type Props = {
  /** El track o la ruta propuesta. Se simplifica: miles de puntos dan un trazo de pocos cientos. */
  points: LatLng[];
  /** Lado en px, o `fill` para ocupar su caja (la tarjeta de ruta). */
  size: number | 'fill';
  /** Con él, la forma es una imagen con nombre; sin él, es decorativa. */
  label?: string;
  className?: string;
};

const BOX = 100;
const PAD = 12;
// Curvas de nivel de fondo, como FBT.shape: el relieve es la firma, no un mapa.
const CONTOURS = [18, 30, 42, 56].map((r, i) => ({ cx: 62 - i * 3, cy: 40 + i * 2, rx: r * 1.15, ry: r * 0.8 }));

/**
 * Forma de la ruta luminosa sobre curvas de nivel: halo, trazo, hilo claro y el punto de salida.
 * Sustituye a la foto en las tarjetas de ruta y a la miniatura en las filas.
 */
export const RouteShape = memo(function RouteShape({ points, size, label, className }: Props) {
  const geo = useMemo(() => shapePath(points, BOX, BOX, PAD), [points]);
  const dim = size === 'fill' ? undefined : size;
  const cls = ['shape', size === 'fill' ? 'shape--fill' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <svg
      className={cls}
      viewBox={`0 0 ${BOX} ${BOX}`}
      width={dim}
      height={dim}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <g>
        {CONTOURS.map((c) => (
          <ellipse key={c.rx} className="contour" cx={c.cx} cy={c.cy} rx={c.rx} ry={c.ry} />
        ))}
      </g>
      {geo.d ? (
        <>
          <path className="halo" d={geo.d} />
          <path className="core" d={geo.d} />
          <path className="thread" d={geo.d} />
          <circle className="start" r="4.2" cx={geo.start.x} cy={geo.start.y} />
        </>
      ) : null}
    </svg>
  );
});
