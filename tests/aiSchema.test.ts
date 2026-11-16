import { toStrictJsonSchema, WorkoutWeekSchema } from '../src/ai/schema';
import * as schema from '../src/ai/schema';

const entreno = (over: Record<string, unknown> = {}) => ({
  dia: 1,
  titulo: 'Rodaje suave',
  distanciaKm: 40,
  desnivelM: null,
  notas: '',
  ...over,
});

type JsonNode = Record<string, unknown>;

/** Recorre el JSON Schema y devuelve cada nodo de tipo objeto. */
function objectNodes(node: unknown, out: JsonNode[] = []): JsonNode[] {
  if (Array.isArray(node)) node.forEach((n) => objectNodes(n, out));
  else if (node && typeof node === 'object') {
    const n = node as JsonNode;
    if (n.type === 'object') out.push(n);
    Object.values(n).forEach((v) => objectNodes(v, out));
  }
  return out;
}

describe('WorkoutWeekSchema', () => {
  it('solo quedan el esquema de la semana y su conversión estricta: la IA no propone rutas', () => {
    expect(Object.keys(schema).sort()).toEqual(['WorkoutWeekSchema', 'toStrictJsonSchema']);
  });

  it('acepta de 1 a 7 entrenos con motivo y desnivel nulo o numérico', () => {
    expect(WorkoutWeekSchema.safeParse({ entrenos: [entreno(), entreno({ dia: 3, desnivelM: 600 })], motivo: 'Tu media es 45 km.' }).success).toBe(true);
    expect(WorkoutWeekSchema.safeParse({ entrenos: [], motivo: 'x' }).success).toBe(false);
    expect(WorkoutWeekSchema.safeParse({ entrenos: Array.from({ length: 8 }, (_, i) => entreno({ dia: i % 7 })), motivo: 'x' }).success).toBe(false);
  });

  it('rechaza días fuera de 0-6 y campos extra', () => {
    expect(WorkoutWeekSchema.safeParse({ entrenos: [entreno({ dia: 7 })], motivo: 'x' }).success).toBe(false);
    expect(WorkoutWeekSchema.safeParse({ entrenos: [entreno({ lat: 41 })], motivo: 'x' }).success).toBe(false);
  });
});

describe('toStrictJsonSchema', () => {
  it('strict json schema is strict-compatible', () => {
    const json = toStrictJsonSchema(WorkoutWeekSchema);
    const objects = objectNodes(json);
    expect(objects.length).toBe(2);
    for (const o of objects) {
      expect(o.additionalProperties).toBe(false);
      expect([...(o.required as string[])].sort()).toEqual(
        Object.keys(o.properties as JsonNode).sort(),
      );
    }
    const item = (json.properties as JsonNode).entrenos as JsonNode;
    const desnivel = ((item.items as JsonNode).properties as JsonNode).desnivelM as JsonNode;
    expect(JSON.stringify(desnivel)).toContain('"null"');
  });

  it('completes objects that zod leaves loose or partial', async () => {
    const { z } = await import('zod');
    const loose = z.looseObject({ a: z.string(), b: z.number().optional() });
    const [o] = objectNodes(toStrictJsonSchema(loose));
    expect(o.additionalProperties).toBe(false);
    expect([...(o.required as string[])].sort()).toEqual(['a', 'b']);
  });
});
