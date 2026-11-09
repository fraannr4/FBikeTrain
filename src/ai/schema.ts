import { z } from 'zod';

/**
 * Objetivos que propone la IA. La IA no traza rutas: solo da la dimensión y la
 * subida sobre la referencia; las carreteras las pone ORS y el código recorta
 * cualquier cifra que se salga del rango.
 */
export const RoutePlanSchema = z.strictObject({
  opciones: z
    .array(
      z.strictObject({
        titulo: z.string().min(1).max(60),
        dimension: z.enum(['distancia', 'desnivel']),
        subidaPct: z.number().min(5).max(15),
        distanciaKm: z.number().min(10).max(200),
        desnivelM: z.number().min(0).max(4000).nullable(),
        motivo: z.string().min(1).max(300),
      }),
    )
    .min(3)
    .max(5),
});

export type RoutePlan = z.infer<typeof RoutePlanSchema>;

/** Un texto por ruta, enlazado por el `id` de sus `RouteFacts`. */
export const ExplanationSchema = z.strictObject({
  explicaciones: z.array(
    z.strictObject({
      id: z.string(),
      texto: z.string().min(1).max(500),
    }),
  ),
});

/** Recomendación de empalme: una de las opciones recibidas y una frase. */
export function spliceAdviceSchema(ids: [string, ...string[]]) {
  return z.strictObject({ recomendada: z.enum(ids), motivo: z.string().min(1).max(240) });
}
export type SpliceAdvice = { recomendada: string; motivo: string };

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
