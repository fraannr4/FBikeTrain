/** Peso de la cercanía al objetivo (distancia y, si lo hay, desnivel) en la puntuación. */
export const CLOSENESS_WEIGHT = 0.7;
/** Peso de la carretera nueva (o conocida, si el usuario no la prefiere) en la puntuación. */
export const NOVELTY_WEIGHT = 0.3;

export type Target = { distanceM: number; elevGainM: number | null; preferNew: boolean };

/** En distancia, pasarse cuenta este múltiplo de quedarse corto: 50 km pedidos, mejor 46 que 54. */
export const DISTANCE_OVER_WEIGHT = 3;

/** 1 si coincide con el objetivo, 0 si se aleja el 100 % o más. Un objetivo 0 solo lo cumple un 0. */
function closeness(real: number, target: number, overWeight = 1): number {
  if (target <= 0) return real === 0 ? 1 : 0;
  const off = (real - target) / target;
  return 1 - Math.min(1, off > 0 ? off * overWeight : -off);
}

/**
 * Puntuación de 0 a 1: CLOSENESS_WEIGHT · cercanía media de las dimensiones con objetivo +
 * NOVELTY_WEIGHT · fracción de carretera nueva (o conocida, si `preferNew` es falso).
 */
export function scoreCandidate(
  c: { distanceM: number; elevGainM: number; newPct: number },
  t: Target,
): number {
  const dims = [closeness(c.distanceM, t.distanceM, DISTANCE_OVER_WEIGHT)];
  if (t.elevGainM !== null) dims.push(closeness(c.elevGainM, t.elevGainM));
  const close = dims.reduce((a, b) => a + b, 0) / dims.length;
  const novelty = t.preferNew ? c.newPct / 100 : 1 - c.newPct / 100;
  return CLOSENESS_WEIGHT * close + NOVELTY_WEIGHT * novelty;
}
