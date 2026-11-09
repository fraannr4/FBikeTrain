// Chispa de 8 semanas de cada KPI: línea, área y último punto, en un lienzo de w × h.

const PAD_X = 4;
const PAD_Y = 5;

const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * Trazado de la chispa. Escala de mínimo a máximo (incluida la media, si se da), así que una
 * serie plana, también la de todo ceros, queda abajo. Curva monótona (Fritsch–Carlson): no
 * se pasa de los valores reales entre dos semanas.
 */
export function sparkPath(
  values: number[],
  w: number,
  h: number,
  mean?: number,
): { line: string; area: string; last: { x: number; y: number }; meanY?: number } {
  const vs = values.length > 0 ? values : [0];
  const domain = mean === undefined ? vs : [...vs, mean];
  const mn = Math.min(...domain);
  const span = Math.max(...domain) - mn;
  const Y = (v: number) => (span === 0 ? h - PAD_Y : PAD_Y + (1 - (v - mn) / span) * (h - 2 * PAD_Y));
  const n = vs.length;
  const X = (i: number) => (n === 1 ? w - PAD_X : PAD_X + (i / (n - 1)) * (w - 2 * PAD_X));
  const pts = vs.map((v, i) => [X(i), Y(v)] as const);

  let line = `M${f2(pts[0][0])} ${f2(pts[0][1])}`;
  if (n > 1) {
    // Pendientes monótonas.
    const d: number[] = [];
    const m: number[] = [];
    for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
    m.push(d[0]);
    for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]));
    m.push(d[n - 2]);
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const dx = (x1 - x0) / 3;
      line += `C${f2(x0 + dx)} ${f2(y0 + m[i] * dx)} ${f2(x1 - dx)} ${f2(y1 - m[i + 1] * dx)} ${f2(x1)} ${f2(y1)}`;
    }
  }
  const [lx, ly] = pts[n - 1];
  const area = `${line}L${f2(lx)} ${f2(h)}L${f2(pts[0][0])} ${f2(h)}Z`;
  return { line, area, last: { x: lx, y: ly }, meanY: mean === undefined ? undefined : Y(mean) };
}
