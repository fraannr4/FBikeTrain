import { z } from 'zod';

/**
 * Entrenos de la semana que propone la IA. `dia` es el índice desde hoy (0 hoy, 6 dentro de 6 días).
 * El código recorta las cifras y descarta los días que no valen.
 */
export const WorkoutWeekSchema = z.strictObject({
  entrenos: z
    .array(
      z.strictObject({
        dia: z.number().int().min(0).max(6),
        titulo: z.string().min(1).max(60),
        distanciaKm: z.number().min(1).max(300),
        desnivelM: z.number().min(0).max(5000).nullable(),
        notas: z.string().max(200),
      }),
    )
    .min(1)
    .max(7),
  motivo: z.string().min(1).max(300),
});

export type WorkoutWeek = z.infer<typeof WorkoutWeekSchema>;

type JsonNode = Record<string, unknown>;

/** Deja cada objeto con `additionalProperties: false` y todas sus claves en `required`. */
function makeStrict(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(makeStrict);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const n = node as JsonNode;
  if (n.type === 'object' && n.properties && typeof n.properties === 'object') {
    n.additionalProperties = false;
    n.required = Object.keys(n.properties);
  }
  Object.values(n).forEach(makeStrict);
}

/**
 * JSON Schema para `response_format: { type: 'json_schema', strict: true }`.
 * En modo estricto todas las propiedades van en `required`, cada objeto lleva
 * `additionalProperties: false` y los opcionales se expresan como `nullable`.
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as JsonNode;
  makeStrict(json);
  return json;
}
