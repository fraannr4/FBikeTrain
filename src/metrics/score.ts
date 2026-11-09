/** Peso de la cercanía al objetivo (distancia y, si lo hay, desnivel) en la puntuación. */
export const CLOSENESS_WEIGHT = 0.7;
/** Peso de la carretera nueva (o conocida, si el usuario no la prefiere) en la puntuación. */
export const NOVELTY_WEIGHT = 0.3;

export type Target = { distanceM: number; elevGainM: number | null; preferNew: boolean };

/** 1 si coincide con el objetivo, 0 si se aleja el 100 % o más. Un objetivo 0 solo lo cumple un 0. */
function closeness(real: number, target: number): number {
  if (target <= 0) return real === 0 ? 1 : 0;
  return 1 - Math.min(1, Math.abs(real - target) / target);
}

/**
 * Puntuación de 0 a 1: CLOSENESS_WEIGHT · cercanía media de las dimensiones con objetivo +
 * NOVELTY_WEIGHT · fracción de carretera nueva (o conocida, si `preferNew` es falso).
 */
export function scoreCandidate(
  c: { distanceM: number; elevGainM: number; newPct: number },
  t: Target,
): number {
  const dims = [closeness(c.distanceM, t.distanceM)];
  if (t.elevGainM !== null) dims.push(closeness(c.elevGainM, t.elevGainM));
  const close = dims.reduce((a, b) => a + b, 0) / dims.length;
  const novelty = t.preferNew ? c.newPct / 100 : 1 - c.newPct / 100;
  return CLOSENESS_WEIGHT * close + NOVELTY_WEIGHT * novelty;
}
