// Curvas de nivel procedimentales (decorado de la tarjeta de importación y, más
// adelante, del mapa sin teselas y de la zona de soltar). Semilla fija: siempre igual.

/** Generador pseudoaleatorio con semilla (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `rings` anillos concéntricos deformados alrededor de (cx, cy), separados `step`. */
export function topoPaths(seed: number, cx: number, cy: number, rings: number, step: number): string[] {
  const r = rng(seed);
  const ph = [r() * 6, r() * 6];
  const out: string[] = [];
  for (let k = 1; k <= rings; k++) {
    const R = k * step;
    let d = '';
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      const rr = R * (1 + 0.16 * Math.sin(2 * t + ph[0] + k * 0.3) + 0.08 * Math.sin(3 * t + ph[1] - k * 0.2));
      d += `${i ? 'L' : 'M'}${(cx + Math.cos(t) * rr * 1.2).toFixed(1)} ${(cy + Math.sin(t) * rr).toFixed(1)}`;
    }
    out.push(`${d}Z`);
  }
  return out;
}
