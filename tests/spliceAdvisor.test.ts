import { readFileSync } from 'node:fs';
import type { AiGoal } from '../src/ai/contracts';
import type { Settings } from '../src/domain/types';
import { chatJson, LlmError } from '../src/ai/llm';
import { adviseSplice, spliceFacts } from '../src/ai/spliceAdvisor';
import { handleSharedAi, sharedAiRequestSchema } from '../src/ai/shared/service';
import { createSharedSpliceAdvisor } from '../src/ai/sharedClient';
import type { SpliceOption } from '../src/routes/splice';

const fixture = (name: string): unknown => JSON.parse(readFileSync(`tests/fixtures/llm/${name}`, 'utf8'));
const cfg: Settings['llm'] = { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'test-key', model: 'openai/gpt-oss-20b' };
const respond = (...bodies: [number, unknown][]) => {
  const f = vi.fn<typeof fetch>();
  for (const [status, body] of bodies) f.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  return f;
};
const chatWith = (f: typeof fetch): typeof chatJson => (c, req) => chatJson(c, req, f);
const notJson = { ...(fixture('splice-ok.json') as object), choices: [{ index: 0, message: { role: 'assistant', content: '{"recomendada":' }, finish_reason: 'length' }] };

// Coordenadas sintéticas en el mar: no deben llegar nunca a la IA.
const option = (id: string, distanceM: number, mainRoadPct: number): SpliceOption => ({
  id, order: 'AB', reversed: { A: false, B: false, C: false },
  points: [{ lat: 41.123456, lng: 2.654321, ele: 10 }, { lat: 41.2, lng: 2.7, ele: 20 }],
  pieces: [{ source: 'A', from: 0, to: 1 }],
  distanceM, distinctM: distanceM - 300, elevGainM: 120, estTimeS: null, difficulty: null,
  connectorM: 1500, mainRoadPct, overlapM: 300, backtrackM: 0,
});
const options = [option('AB-00', 20_000, 4), option('BA-00', 21_500, 0)];

describe('recomendación de empalme', () => {
  it('a la IA solo le llegan cifras resumidas, nunca coordenadas', () => {
    const facts = spliceFacts(options);
    const text = JSON.stringify(facts);
    expect(text).not.toMatch(/lat|lng|41\.1|2\.65|points/);
    expect(facts[1]).toEqual({ id: 'c2', distanciaKm: 21.5, desnivelM: 120, viasPrincipalesPct: 0, conectorKm: 1.5, solapeKm: 0.3, retrocesoKm: 0, alternativa: false });
  });

  it('sin IA gana la más corta sin vías principales, explicada con sus cifras', async () => {
    const advice = await adviseSplice(options, { personal: null });
    expect(advice).toMatchObject({ id: 'BA-00', source: 'codigo', aviso: null });
    expect(advice!.motivo).toMatch(/21,5\s?km/);
  });

  it('con clave propia, la IA elige y su frase llega tal cual; la petición no lleva coordenadas', async () => {
    const f = respond([200, fixture('splice-ok.json')]);
    const advice = await adviseSplice(options, { personal: cfg, chat: chatWith(f) });
    expect(advice).toMatchObject({ id: 'BA-00', source: 'ia' });
    expect(advice!.motivo).toMatch(/21,5 km/);
    const body = String(f.mock.calls[0][1]!.body);
    expect(body).not.toMatch(/41\.123456|2\.654321|"lat"|"lng"/);
  });

  it('JSON no válido: reintenta una vez y luego decide el código', async () => {
    const f = respond([200, notJson], [200, notJson]);
    const advice = await adviseSplice(options, { personal: cfg, chat: chatWith(f) });
    expect(f).toHaveBeenCalledTimes(2);
    expect(advice).toMatchObject({ id: 'BA-00', source: 'codigo' });
    expect(advice!.aviso).toMatch(/IA/);
  });

  it('JSON no válido y luego válido: se queda con la IA', async () => {
    const f = respond([200, notJson], [200, fixture('splice-ok.json')]);
    expect(await adviseSplice(options, { personal: cfg, chat: chatWith(f) })).toMatchObject({ source: 'ia' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('cuota del proveedor agotada: no reintenta y explica el límite', async () => {
    const f = respond([429, fixture('rate-limit-429.json')]);
    const advice = await adviseSplice(options, { personal: cfg, chat: chatWith(f) });
    expect(f).toHaveBeenCalledTimes(1);
    expect(advice!.source).toBe('codigo');
    expect(advice!.aviso).toMatch(/límite/);
  });

  it('servicio común caído y clave propia: usa la clave', async () => {
    const shared = { splice: vi.fn().mockRejectedValue(new LlmError('unavailable', 'no disponible')) };
    const f = respond([200, fixture('splice-ok.json')]);
    expect(await adviseSplice(options, { personal: cfg, shared, chat: chatWith(f) })).toMatchObject({ source: 'ia' });
  });

  it('servicio común con la cuota agotada: muestra el límite y no gasta la clave propia', async () => {
    const shared = { splice: vi.fn().mockRejectedValue(new LlmError('rate_limit', 'El servicio gratuito ha alcanzado su límite.', 60)) };
    const f = respond([200, fixture('splice-ok.json')]);
    const advice = await adviseSplice(options, { personal: cfg, shared, chat: chatWith(f) });
    expect(f).not.toHaveBeenCalled();
    expect(advice).toMatchObject({ source: 'codigo' });
    expect(advice!.aviso).toMatch(/límite/);
  });
});

describe('recomendación de empalme por el servicio común', () => {
  const facts = spliceFacts(options);
  it('el servidor acepta solo cifras de opciones', () => {
    expect(sharedAiRequestSchema.safeParse({ operation: 'splice', facts }).success).toBe(true);
    expect(sharedAiRequestSchema.safeParse({ operation: 'splice', facts: [{ ...facts[0], lat: 41.1 }] }).success).toBe(false);
    expect(sharedAiRequestSchema.safeParse({ operation: 'splice', facts: [] }).success).toBe(false);
  });

  it('el cliente envía la operación y valida que la elegida sea una de las opciones', async () => {
    const server = vi.fn<typeof fetch>(async (_url, init) => handleSharedAi(new Request('https://example.invalid/ai-routes', init), {
      enabled: true, allowedOrigins: [], authenticate: async () => 'user-1', consumeQuota: async () => ({ allowed: true, retryAfterS: 0 }),
      complete: async () => ({ recomendada: 'c2', motivo: '21,5 km sin vías principales.' }),
      validateOutput: () => true,
    }));
    const advisor = createSharedSpliceAdvisor(async () => 'jwt', server);
    expect(await advisor.splice(facts)).toEqual({ recomendada: 'c2', motivo: '21,5 km sin vías principales.' });
    expect(JSON.parse(String(server.mock.calls[0][1]!.body))).toEqual({ operation: 'splice', facts });
  });
});

describe('recomendación de empalme con el objetivo del usuario', () => {
  const objetivo: AiGoal = { tipo: 'volumen', diasRestantes: 9, distanciaRestanteKm: 120.5, desnivelRestanteM: null };

  it('con clave propia, el objetivo va en el mensaje solo con sus cifras', async () => {
    const f = respond([200, fixture('splice-ok.json')]);
    await adviseSplice(options, { personal: cfg, chat: chatWith(f), objetivo: { ...objetivo, titulo: 'Noviembre en Mallorca' } as AiGoal });
    const body = String(f.mock.calls[0][1]!.body);
    expect(JSON.parse(JSON.parse(body).messages[1].content).objetivo).toEqual(objetivo);
    expect(body).not.toContain('Mallorca');
  });

  it('el servicio común recibe el objetivo, y el cliente lo envía solo si lo hay', async () => {
    const shared = { splice: vi.fn().mockResolvedValue({ recomendada: 'c2', motivo: '21,5 km.' }) };
    await adviseSplice(options, { personal: null, shared, objetivo });
    expect(shared.splice).toHaveBeenCalledWith(spliceFacts(options), undefined, objetivo);
    const server = vi.fn<typeof fetch>(async (_url, init) => handleSharedAi(new Request('https://example.invalid/ai-routes', init), {
      enabled: true, allowedOrigins: [], authenticate: async () => 'user-1', consumeQuota: async () => ({ allowed: true, retryAfterS: 0 }),
      complete: async () => ({ recomendada: 'c1', motivo: '20 km.' }), validateOutput: () => true,
    }));
    const advisor = createSharedSpliceAdvisor(async () => 'jwt', server);
    await advisor.splice(spliceFacts(options), undefined, objetivo);
    expect(JSON.parse(String(server.mock.calls[0][1]!.body))).toEqual({ operation: 'splice', facts: spliceFacts(options), objetivo });
    await advisor.splice(spliceFacts(options), undefined, null);
    expect(JSON.parse(String(server.mock.calls[1][1]!.body))).toEqual({ operation: 'splice', facts: spliceFacts(options) });
  });
});
