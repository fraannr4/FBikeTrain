import { buildLevelSummary } from '../src/ai/levelSummary';
import { LlmError, type chatJson } from '../src/ai/llm';
import type { SharedAiPlanner } from '../src/ai/routePlanner';
import type { RoutePlan } from '../src/ai/schema';
import { recommendWikiloc } from '../src/ai/wikilocAdvisor';
import type { Settings } from '../src/domain/types';
import type { UserReference } from '../src/metrics/reference';
import { rankForTarget, type WikilocCard } from '../src/routes/wikilocNearby';

// Rutas inventadas: ids, nombres, autores y enlaces sintéticos.
const LLM: Settings['llm'] = { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'test-key', model: 'openai/gpt-oss-20b' };
const NO_LLM: Settings['llm'] = { ...LLM, apiKey: '' };
const REF: UserReference = {
  source: 'history', weeks: 8, rides: 10, ridesPerWeek: 1.25, avgDistanceM: 70_000, avgElevGainM: 800,
  avgMovingTimeS: 10_000, avgSpeedMs: 7, longestDistanceM: 120_000, maxElevGainM: 1800,
};
const SUMMARY = buildLevelSummary(REF, []);
const card = (id: string, km: number, desnivelM: number | null = 900): WikilocCard => ({
  id, nombre: `Vuelta sintética ${id}`, km, desnivelM, dificultad: 'moderado', autor: `Autora secreta ${id}`,
  url: `https://es.wikiloc.com/rutas-ciclismo/vuelta-sintetica-${id}`,
});
const CARDS = [card('1', 75), card('2', 80), card('3', 70), card('4', 90), card('5', 60), card('6', 100), card('7', 110), card('8', 76)];
const TARGET = { distanceKm: 75, elevGainM: 1000 };
const ranked = rankForTarget(CARDS, TARGET, REF).ranked;

type Option = RoutePlan['opciones'][number];
const option = (referenciaId: string | null, motivo = 'Encaja con lo que pides.'): Option => ({
  titulo: 'Opción', dimension: 'distancia', subidaPct: 10, distanciaKm: 75, desnivelM: null, motivo, referenciaId,
});

type ChatReq = Parameters<typeof chatJson>[1];
function fakeChat(...steps: unknown[]) {
  const fn = vi.fn(async (_cfg: Settings['llm'], _req: ChatReq) => {
    const s = steps.shift();
    if (s instanceof Error) throw s;
    return s;
  });
  return { fn, chat: fn as unknown as typeof chatJson };
}

describe('recomendación de la IA entre las rutas de Wikiloc', () => {
  it('elige de 3 a 5 rutas recibidas con su motivo, en el orden de la IA', async () => {
    const { chat } = fakeChat({ opciones: [option('ref2', 'Más desnivel.'), option('ref1', 'La más cercana.'), option('ref3', 'Más corta.')] });
    const out = await recommendWikiloc({ ranked, target: TARGET, summary: SUMMARY }, { llm: LLM, chat });
    expect(out.kind).toBe('ai');
    if (out.kind !== 'ai') return;
    expect(out.picks.map(p => [p.card.id, p.motivo])).toEqual([
      [ranked[1].card.id, 'Más desnivel.'], [ranked[0].card.id, 'La más cercana.'], [ranked[2].card.id, 'Más corta.'],
    ]);
  });

  it('a la IA solo le llegan nombre, fuente, km y desnivel: ni enlaces, ni autores, ni ids de Wikiloc', async () => {
    const { fn, chat } = fakeChat({ opciones: [option('ref1'), option('ref2'), option('ref3')] });
    await recommendWikiloc({ ranked, target: TARGET, summary: SUMMARY }, { llm: LLM, chat });
    const sent = JSON.stringify(fn.mock.calls[0][1].messages);
    expect(sent).not.toMatch(/wikiloc\.com|https?:|Autora secreta|\blat\b|\blng\b|\blon\b/);
    const body = JSON.parse(fn.mock.calls[0][1].messages[1].content) as { referencias: Record<string, unknown>[]; maxDistanciaKm: number };
    expect(body.referencias).toHaveLength(6);
    expect(body.referencias[0]).toEqual({ id: 'ref1', nombre: ranked[0].card.nombre, fuente: 'wikiloc', distanciaKm: ranked[0].card.km, desnivelM: ranked[0].card.desnivelM });
    // Se pueden recortar o alargar: el máximo es el de la admisión (1,6×), nunca más de 200 km.
    expect(body.maxDistanciaKm).toBe(120);
  });

  it('ignora ids desconocidos y repetidos, y se queda con 5 como mucho', async () => {
    const { chat } = fakeChat({ opciones: [option('ref9'), option('ref1'), option('ref1'), option(null), option('ref2')] });
    const out = await recommendWikiloc({ ranked, target: TARGET, summary: SUMMARY }, { llm: LLM, chat });
    expect(out.kind === 'ai' && out.picks.map(p => p.card.id)).toEqual([ranked[0].card.id, ranked[1].card.id]);
  });

  it('si la IA no elige ninguna ruta recibida, se queda el orden local y se dice', async () => {
    const { chat } = fakeChat({ opciones: [option(null), option(null), option('ref9')] });
    const out = await recommendWikiloc({ ranked, target: TARGET, summary: SUMMARY }, { llm: LLM, chat });
    expect(out).toEqual({ kind: 'local', reason: expect.stringContaining('orden local') });
  });

  it('sin IA configurada no llama a nadie y se queda el orden local', async () => {
    const { fn, chat } = fakeChat();
    const out = await recommendWikiloc({ ranked, target: TARGET, summary: SUMMARY }, { llm: NO_LLM, chat });
    expect(fn).not.toHaveBeenCalled();
    expect(out).toEqual({ kind: 'local', reason: expect.stringContaining('Sin IA configurada') });
  });

  it('sin nivel del usuario no llama a la IA', async () => {
    const { fn, chat } = fakeChat();
    const out = await recommendWikiloc({ ranked, target: TARGET, summary: null }, { llm: LLM, chat });
    expect(fn).not.toHaveBeenCalled();
    expect(out.kind).toBe('local');
  });

  it('con menos de 3 rutas que encajan no hace falta la IA', async () => {
    const { fn, chat } = fakeChat();
    const out = await recommendWikiloc({ ranked: ranked.slice(0, 2), target: TARGET, summary: SUMMARY }, { llm: LLM, chat });
    expect(fn).not.toHaveBeenCalled();
    expect(out).toEqual({ kind: 'local', reason: expect.stringContaining('menos de 3') });
  });

  it('con la cuota de la IA agotada, se queda el orden local con el mensaje de la IA', async () => {
    const { chat } = fakeChat(new LlmError('rate_limit', 'Has llegado al límite de la IA.'));
    const out = await recommendWikiloc({ ranked, target: TARGET, summary: SUMMARY }, { llm: LLM, chat });
    expect(out).toEqual({ kind: 'local', reason: 'Has llegado al límite de la IA. Se queda el orden local.' });
  });

  it('usa el servicio común con la operación plan, y la clave personal si el servicio no está disponible', async () => {
    const shared: SharedAiPlanner = {
      plan: vi.fn(async () => { throw new LlmError('unavailable', 'No disponible.'); }),
      explain: vi.fn(),
    };
    const { fn, chat } = fakeChat({ opciones: [option('ref1'), option('ref2'), option('ref3')] });
    const out = await recommendWikiloc({ ranked, target: TARGET, summary: SUMMARY }, { llm: LLM, chat, shared });
    expect(shared.plan).toHaveBeenCalledTimes(1);
    const [, answers, maxKm, , referencias] = (shared.plan as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(answers).toMatchObject({ explore: 'descubrir', notes: '' });
    expect(answers.minutes).toBeGreaterThanOrEqual(10);
    expect(maxKm).toBe(120);
    expect(referencias).toHaveLength(6);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(out.kind).toBe('ai');
  });

  it('respeta la cancelación', async () => {
    const controller = new AbortController();
    controller.abort();
    const { chat } = fakeChat();
    await expect(recommendWikiloc({ ranked, target: TARGET, summary: SUMMARY }, { llm: LLM, chat, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
