import { readFileSync } from 'node:fs';
import type { Settings } from '../src/domain/types';
import { chatJson, LlmError } from '../src/ai/llm';
import type { ChatMessage } from '../src/ai/prompts';
import { ExplanationSchema, RoutePlanSchema, toStrictJsonSchema, type RoutePlan } from '../src/ai/schema';

const fixture = (name: string): unknown => JSON.parse(readFileSync(`tests/fixtures/llm/${name}`, 'utf8'));

const cfg: Settings['llm'] = { baseUrl: 'https://api.groq.com/openai/v1/', apiKey: 'test-key', model: 'openai/gpt-oss-20b' };
const messages: ChatMessage[] = [
  { role: 'system', content: 'Responde solo con JSON.' },
  { role: 'user', content: '{"resumen":{}}' },
];
const req = { messages, schemaName: 'plan', jsonSchema: toStrictJsonSchema(RoutePlanSchema), schema: RoutePlanSchema };

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status, headers }));
}

/** Llama y devuelve el LlmError lanzado; falla si no lanza uno. */
async function llmErrorOf(fetchImpl: typeof fetch, c: Settings['llm'] = cfg): Promise<LlmError> {
  try {
    await chatJson(c, req, fetchImpl);
  } catch (e) {
    expect(e).toBeInstanceOf(LlmError);
    return e as LlmError;
  }
  throw new Error('no lanzó');
}

describe('llm client', () => {
  it('posts to baseUrl chat completions with strict schema', async () => {
    const f = respond(200, fixture('plan-ok.json'));
    await chatJson(cfg, req, f);

    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-key');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      model: 'openai/gpt-oss-20b',
      messages,
      temperature: 0.3,
      response_format: { type: 'json_schema', json_schema: { name: 'plan', strict: true, schema: req.jsonSchema } },
    });
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it('parses fixture content with zod', async () => {
    const plan: RoutePlan = await chatJson(cfg, req, respond(200, fixture('plan-ok.json')));
    expect(plan.opciones).toHaveLength(3);
    expect(plan.opciones[0]).toMatchObject({ dimension: 'distancia', subidaPct: 10, distanciaKm: 53, desnivelM: null });
    expect(JSON.stringify(plan)).not.toContain('reasoning');
  });

  it('parses explanation fixture with its schema', async () => {
    const out = await chatJson(
      cfg,
      { messages, schemaName: 'explicacion', jsonSchema: toStrictJsonSchema(ExplanationSchema), schema: ExplanationSchema },
      respond(200, fixture('explain-ok.json')),
    );
    expect(out.explicaciones.map((x) => x.id)).toEqual(['r1', 'r2']);
    expect(out.explicaciones[0].texto).toContain('62 km');
  });

  it('no model throws before fetch', async () => {
    const f = respond(200, fixture('plan-ok.json'));
    const e = await llmErrorOf(f, { ...cfg, model: '  ' });
    expect(e.kind).toBe('no_model');
    expect(e.message).toBe('Elige un modelo en Ajustes (por ejemplo, openai/gpt-oss-20b).');
    expect(f).not.toHaveBeenCalled();
  });

  it('401 maps to unauthorized', async () => {
    const e = await llmErrorOf(respond(401, fixture('unauthorized-401.json')));
    expect(e.kind).toBe('unauthorized');
    expect(e.message).toBe('El proveedor de IA rechaza la clave. Revísala en Ajustes.');
  });

  it('429 maps to rate_limit with retry-after', async () => {
    const e = await llmErrorOf(respond(429, fixture('rate-limit-429.json'), { 'retry-after': '12' }));
    expect(e.kind).toBe('rate_limit');
    expect(e.retryAfterS).toBe(12);
    expect(e.message).toBe(
      'El proveedor de IA ha llegado a su límite (con openai/gpt-oss-20b, 30 peticiones por minuto y 1.000 al día). Prueba dentro de 12 s.',
    );
  });

  it('429 without retry-after asks to wait a minute', async () => {
    const e = await llmErrorOf(respond(429, fixture('rate-limit-429.json')));
    expect(e.retryAfterS).toBeUndefined();
    expect(e.message).toBe(
      'El proveedor de IA ha llegado a su límite (con openai/gpt-oss-20b, 30 peticiones por minuto y 1.000 al día). Prueba dentro de un minuto.',
    );
  });

  it('429 on a model without known limits omits them', async () => {
    const e = await llmErrorOf(respond(429, fixture('rate-limit-429.json'), { 'retry-after': '3' }), {
      ...cfg,
      model: 'otro/modelo',
    });
    expect(e.message).toBe('El proveedor de IA ha llegado a su límite. Prueba dentro de 3 s.');
  });

  it('non-json content maps to invalid_json with raw', async () => {
    const e = await llmErrorOf(respond(200, fixture('plan-not-json.json')));
    expect(e.kind).toBe('invalid_json');
    expect(e.raw).toBe('Aquí tienes tres opciones: {"opciones": [');
    expect(e.message).toMatch(/no es JSON/);
  });

  it('zod failure maps to invalid_json', async () => {
    const e = await llmErrorOf(respond(200, fixture('plan-bad-schema.json')));
    expect(e.kind).toBe('invalid_json');
    expect(e.message).toContain('opciones.0.subidaPct');
    expect(e.raw).toContain('"subidaPct":20');
  });

  it('400 schema mismatch maps to invalid_json', async () => {
    const e = await llmErrorOf(respond(400, fixture('schema-mismatch-400.json')));
    expect(e.kind).toBe('invalid_json');
    expect(e.message).toContain('Generated JSON does not match the expected schema');
  });

  it('400 response_format unsupported maps to model_unsupported', async () => {
    const e = await llmErrorOf(respond(400, fixture('model-unsupported-400.json')));
    expect(e.kind).toBe('model_unsupported');
    expect(e.message).toBe('Este modelo no admite salida JSON con esquema. Usa openai/gpt-oss-20b u otro que la admita.');
  });

  it('other 400 maps to bad_request with provider message', async () => {
    const e = await llmErrorOf(respond(400, { error: { message: 'messages must not be empty', type: 'invalid_request_error' } }));
    expect(e.kind).toBe('bad_request');
    expect(e.message).toBe('El proveedor de IA rechaza la petición (HTTP 400): messages must not be empty');
  });

  it('5xx maps to other with retry hint', async () => {
    const e = await llmErrorOf(respond(503, fixture('server-503.json')));
    expect(e.kind).toBe('other');
    expect(e.message).toBe('El proveedor de IA ha fallado (HTTP 503). Vuelve a probar en unos minutos.');
  });

  it('TypeError maps to network', async () => {
    const f = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const e = await llmErrorOf(f);
    expect(e.kind).toBe('network');
    expect(e.message).toBe('No se puede conectar con el proveedor de IA. Revisa la conexión y la URL base en Ajustes.');
  });
});
