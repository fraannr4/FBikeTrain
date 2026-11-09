const FIGURE = /[−+]?\d[\d.,]*/g;

/**
 * Cifra de dorsal y unidad más pequeña sin cambiar el texto: «1.240 m» pasa a
 * `<span class="fig">1.240</span><span class="unit"> m</span>`. El `textContent` es el mismo.
 */
export function ValueText({ value }: { value: string }) {
  const parts: { fig: boolean; text: string }[] = [];
  let at = 0;
  for (const m of value.matchAll(FIGURE)) {
    const i = m.index ?? 0;
    if (i > at) parts.push({ fig: false, text: value.slice(at, i) });
    parts.push({ fig: true, text: m[0] });
    at = i + m[0].length;
  }
  if (at < value.length) parts.push({ fig: false, text: value.slice(at) });

  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className={p.fig ? 'fig' : 'unit'}>
          {p.text}
        </span>
      ))}
    </>
  );
}
