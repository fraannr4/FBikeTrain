import type { CSSProperties } from 'react';

type Props = {
  /** Forma: línea de texto, título, cifra, caja (gráfica o mapa) o icono de fila. */
  variant?: 'line' | 'title' | 'fig' | 'box' | 'circle';
  /** Ancho: «72%» o píxeles. */
  width?: string | number;
  height?: string | number;
  className?: string;
};

/** Hueco que imita la forma real mientras carga. Va oculto al lector de pantalla. */
export function Skeleton({ variant = 'line', width, height, className }: Props) {
  const style: CSSProperties | undefined =
    width !== undefined || height !== undefined ? { width, height } : undefined;
  return <span className={`sk sk-${variant}${className ? ` ${className}` : ''}`} style={style} aria-hidden="true" />;
}

const ROW_WIDTHS: [string, string][] = [
  ['72%', '44%'],
  ['86%', '38%'],
  ['58%', '50%'],
  ['66%', '42%'],
];

/**
 * Filas de lista en carga: icono, dos líneas y cifra. `label` («Cargando salidas») es lo único que
 * oye el lector de pantalla.
 */
export function SkeletonRows({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="sk-rows" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => {
          const [a, b] = ROW_WIDTHS[i % ROW_WIDTHS.length];
          return (
            <div className="sk-row" key={i}>
              <Skeleton variant="circle" />
              <span className="sk-stack">
                <Skeleton width={a} />
                <Skeleton width={b} />
              </span>
              <Skeleton width={44} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
