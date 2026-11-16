/**
 * Umbrales de unión de tramos que usa el adaptador de rutas (`adapt.ts`): el empalme de rutas se ha
 * retirado, pero sus medidas siguen definiendo cuándo dos trazados se tocan o se solapan.
 */

export const SPLICE = {
  /** Tramos que admite un empalme. */
  maxInputs: 3,
  /** Una ruta cuyo final queda a esta distancia de su inicio es circular y se puede invertir. */
  loopCloseM: 50,
  /** Si las rutas pasan a menos de esto, se unen por su punto más cercano y no por los extremos. */
  nearM: 300,
  /** Por debajo, se une directamente, sin pedir conector. */
  directJoinM: 30,
  /** Salto máximo admitido en una unión. */
  maxGapM: 50,
  /** Mismo tramo en sentido contrario durante más de esto: retroceso. */
  backtrackMinM: 500,
  /** Dos conectores son alternativas si su distancia difiere como mucho esto... */
  altMaxDistDiff: 0.15,
  /** ...y comparten menos de esta fracción del trazado. */
  altMaxShare: 0.7,
  /** Combinaciones que se enseñan (cada una con su alternativa, si la hay). */
  maxGroups: 6,
} as const;
