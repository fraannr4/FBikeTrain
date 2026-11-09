import type { RouteReference } from '../routes/sources/schema';
import type { AiReference } from './contracts';

/** Rutas conocidas que se enseñan a la IA como mucho. */
export const MAX_AI_REFERENCES = 6;
/** Una referencia más larga que la distancia máxima en más de esto no sirve de base. */
const MAX_OVER_PCT = 0.2;
const MAX_NAME = 80;

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Referencias para la IA: solo nombre, fuente y cifras, con un id propio (`ref1`, `ref2`...).
 * `byId` lleva de cada id a la referencia original, con su enlace, que nunca sale hacia la IA.
 */
export function pickReferences(
  refs: RouteReference[],
  maxDistanciaKm: number,
): { forAi: AiReference[]; byId: Map<string, RouteReference> } {
  const forAi: AiReference[] = [];
  const byId = new Map<string, RouteReference>();
  refs.forEach((ref, i) => {
    if (forAi.length >= MAX_AI_REFERENCES || ref.distanceM / 1000 > maxDistanciaKm * (1 + MAX_OVER_PCT)) return;
    const id = `ref${i + 1}`;
    forAi.push({
      id,
      nombre: ref.name.slice(0, MAX_NAME),
      fuente: ref.source,
      distanciaKm: round1(ref.distanceM / 1000),
      desnivelM: ref.ascentM === null ? null : Math.round(ref.ascentM),
    });
    byId.set(id, ref);
  });
  return { forAi, byId };
}
