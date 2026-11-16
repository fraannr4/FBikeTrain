import { readFileSync } from 'node:fs';
import type { Settings } from '../src/domain/types';
import { chatJson, chatWithRetry, LlmError } from '../src/ai/llm';
import type { ChatMessage } from '../src/ai/prompts';
import { toStrictJsonSchema, WorkoutWeekSchema, type WorkoutWeek } from '../src/ai/schema';

const fixture = (name: string): unknown => JSON.parse(readFileSync(`tests/fixtures/llm/${name}`, 'utf8'));

const cfg: Settings['llm'] = { baseUrl: 'https://api.groq.com/openai/v1/', apiKey: 'test-key', model: 'openai/gpt-oss-20b' };
const messages: ChatMessage[] = [
  { role: 'system', content: 'Responde solo con JSON.' },
  { role: 'user', content: '{"resumen":{}}' },
];
const req = { messages, schemaName: 'entrenos_semana', jsonSchema: toStrictJsonSchema(WorkoutWeekSchema), schema: WorkoutWeekSchema };

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
    const f = respond(200, fixture('workouts-ok.json'));
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
      response_format: { type: 'json_schema', json_schema: { name: 'entrenos_semana', strict: true, schema: req.jsonSchema } },
    });
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it('parses fixture content with zod', async () => {
    const week: WorkoutWeek = await chatJson(cfg, req, respond(200, fixture('workouts-ok.json')));
    expect(week.entrenos).toHaveLength(3);
    expect(week.entrenos[0]).toMatchObject({ dia: 0, distanciaKm: 35, desnivelM: 300 });
    expect(JSON.stringify(week)).not.toContain('reasoning');
  });

  it('no model throws before fetch', async () => {
    const f = respond(200, fixture('workouts-ok.json'));
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
    const e = await llmErrorOf(respond(200, fixture('workouts-bad-schema.json')));
    expect(e.kind).toBe('invalid_json');
    expect(e.message).toContain('entrenos.0.dia');
    expect(e.raw).toContain('"dia":9');
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

describe('chatWithRetry', () => {
  const plan = { entrenos: [], motivo: 'x' };
  /** `chatJson` simulado que devuelve o lanza, por orden, cada salida. */
  function fakeChat(...outs: unknown[]) {
    const fn = vi.fn(async (_cfg: Settings['llm'], _req: { messages: ChatMessage[] }) => {
      const out = outs.shift();
      if (out instanceof Error) throw out;
      return out;
    });
    return { fn, chat: fn as unknown as typeof chatJson };
  }

  it('si la primera respuesta vale, llama una vez', async () => {
    const { fn, chat } = fakeChat(plan);
    expect(await chatWithRetry(cfg, req, chat)).toEqual({ ok: true, data: plan });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('un JSON no válido se repite una vez con la respuesta anterior y el error', async () => {
    const { fn, chat } = fakeChat(new LlmError('invalid_json', 'opciones: Too small', undefined, '{"opciones":[]}'), plan);
    expect(await chatWithRetry(cfg, req, chat)).toEqual({ ok: true, data: plan });
    expect(fn).toHaveBeenCalledTimes(2);
    const second = fn.mock.calls[1][1].messages;
    expect(second.slice(0, messages.length)).toEqual(messages);
    expect(second.slice(messages.length)).toEqual([
      { role: 'assistant', content: '{"opciones":[]}' },
      { role: 'user', content: 'Tu respuesta no cumple el formato: opciones: Too small' },
    ]);
  });

  it('dos JSON no válidos devuelven el error sin una tercera llamada', async () => {
    const bad = new LlmError('invalid_json', 'otra vez');
    const { fn, chat } = fakeChat(new LlmError('invalid_json', 'mal'), bad, plan);
    expect(await chatWithRetry(cfg, req, chat)).toEqual({ ok: false, error: bad });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('el límite del proveedor no se repite', async () => {
    const limit = new LlmError('rate_limit', 'Prueba dentro de 12 s.', 12);
    const { fn, chat } = fakeChat(limit, plan);
    expect(await chatWithRetry(cfg, req, chat)).toEqual({ ok: false, error: limit });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
