/** Las cuatro métricas de la semana, cada una con su acento en todo el producto. */
export type Accent = 'dist' | 'elev' | 'time' | 'speed';

/** `var(--acc-dist)` y los demás. */
export function accentVar(a: Accent): string {
  return `var(--acc-${a})`;
}
