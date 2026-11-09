import { ExplanationSchema, RoutePlanSchema, toStrictJsonSchema } from '../src/ai/schema';

const option = (over: Record<string, unknown> = {}) => ({
  titulo: 'Fondo llano',
  dimension: 'distancia',
  subidaPct: 8,
  distanciaKm: 55,
  desnivelM: null,
  motivo: 'Un 8 % más de distancia que tu media.',
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

describe('RoutePlanSchema', () => {
  it('plan schema accepts 3 to 5 options', () => {
    for (const n of [3, 4, 5]) {
      const r = RoutePlanSchema.safeParse({ opciones: Array.from({ length: n }, () => option()) });
      expect(r.success).toBe(true);
    }
  });

  it('rejects 2 options', () => {
    expect(RoutePlanSchema.safeParse({ opciones: [option(), option()] }).success).toBe(false);
  });

  it('rejects 6 options', () => {
    const opciones = Array.from({ length: 6 }, () => option());
    expect(RoutePlanSchema.safeParse({ opciones }).success).toBe(false);
  });

  it('rejects subidaPct 20', () => {
    const opciones = [option(), option(), option({ subidaPct: 20 })];
    expect(RoutePlanSchema.safeParse({ opciones }).success).toBe(false);
  });

  it('rejects extra keys', () => {
    expect(
      RoutePlanSchema.safeParse({ opciones: [option(), option(), option({ lat: 41.4 })] }).success,
    ).toBe(false);
    expect(
      RoutePlanSchema.safeParse({ opciones: [option(), option(), option()], extra: 1 }).success,
    ).toBe(false);
  });

  it('accepts a number or null as desnivelM', () => {
    const opciones = [option({ desnivelM: 900, dimension: 'desnivel' }), option(), option()];
    expect(RoutePlanSchema.safeParse({ opciones }).success).toBe(true);
  });

  it('referenciaId is optional and accepts a string or null', () => {
    const opciones = [option({ referenciaId: 'ref2' }), option({ referenciaId: null }), option()];
    expect(RoutePlanSchema.safeParse({ opciones }).success).toBe(true);
    expect(RoutePlanSchema.safeParse({ opciones: [option({ referenciaId: 7 }), option(), option()] }).success).toBe(false);
  });
});

describe('ExplanationSchema', () => {
  it('accepts one text per id and rejects an empty text', () => {
    expect(
      ExplanationSchema.safeParse({ explicaciones: [{ id: 'r1', texto: '58 km y 640 m.' }] }).success,
    ).toBe(true);
    expect(
      ExplanationSchema.safeParse({ explicaciones: [{ id: 'r1', texto: '' }] }).success,
    ).toBe(false);
  });
});

describe('toStrictJsonSchema', () => {
  it('strict json schema is strict-compatible', () => {
    const json = toStrictJsonSchema(RoutePlanSchema);
    const objects = objectNodes(json);
    expect(objects.length).toBe(2);
    for (const o of objects) {
      expect(o.additionalProperties).toBe(false);
      expect([...(o.required as string[])].sort()).toEqual(
        Object.keys(o.properties as JsonNode).sort(),
      );
    }
    const item = (json.properties as JsonNode).opciones as JsonNode;
    const desnivel = ((item.items as JsonNode).properties as JsonNode).desnivelM as JsonNode;
    expect(JSON.stringify(desnivel)).toContain('"null"');
    const referencia = ((item.items as JsonNode).properties as JsonNode).referenciaId as JsonNode;
    expect(JSON.stringify(referencia)).toContain('"null"');
  });

  it('completes objects that zod leaves loose or partial', async () => {
    const { z } = await import('zod');
    const loose = z.looseObject({ a: z.string(), b: z.number().optional() });
    const [o] = objectNodes(toStrictJsonSchema(loose));
    expect(o.additionalProperties).toBe(false);
    expect([...(o.required as string[])].sort()).toEqual(['a', 'b']);
  });

  it('explanation schema is strict-compatible too', () => {
    for (const o of objectNodes(toStrictJsonSchema(ExplanationSchema))) {
      expect(o.additionalProperties).toBe(false);
      expect([...(o.required as string[])].sort()).toEqual(
        Object.keys(o.properties as JsonNode).sort(),
      );
    }
  });
});
