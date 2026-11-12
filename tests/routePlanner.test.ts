import { readFileSync } from 'node:fs';
import type { AiGoal } from '../src/ai/contracts';
import { buildLevelSummary } from '../src/ai/levelSummary';
import { chatJson, LlmError } from '../src/ai/llm';
import type { Answers, ChatMessage, RouteFacts } from '../src/ai/prompts';
import {
  citesFigures,
  planWithRetry,
  runAiRoutes,
  suggestedTarget,
  targetsFromPlan,
  templateExplanation,
} from '../src/ai/routePlanner';
import type { RoutePlan } from '../src/ai/schema';
import type { Settings } from '../src/domain/types';
import type { UserReference } from '../src/metrics/reference';
import type { GeneratedRoute, generateRoutes, GenerateResult } from '../src/routes/generator';
import { OrsError } from '../src/routes/ors';
import { routeSide } from '../src/routes/side';
import { createSharedAiPlanner } from '../src/ai/sharedClient';
import type { RouteSourceInvoker } from '../src/routes/sources/client';
import type { RouteReference } from '../src/routes/sources/schema';
import { parseReferenceRoute } from '../src/routes/library';

const fixture = (name: string): unknown => JSON.parse(readFileSync(`tests/fixtures/llm/${name}`, 'utf8'));

const LLM: Settings['llm'] = { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'test-key', model: 'openai/gpt-oss-20b' };
const HOME = { lat: 41.123456, lng: 2.654321 };
const START = { lat: 41.2, lng: 2.7 };
const KMH = 1 / 3.6;

/** 50 km y 500 m de media a 25 km/h. */
const ref: UserReference = {
  source: 'history',
  weeks: 8,
  rides: 8,
  ridesPerWeek: 1,
  avgDistanceM: 50000,
  avgElevGainM: 500,
  avgMovingTimeS: 7200,
  avgSpeedMs: 25 * KMH,
  longestDistanceM: 80000,
  maxElevGainM: 1100,
};
const summary = buildLevelSummary(ref, []);
/** 240 min a 25 km/h dan 100 km: el tiempo no limita salvo que la prueba lo cambie. */
const answers: Answers = { focus: 'fondo', minutes: 240, explore: 'descubrir', notes: '' };

type Option = RoutePlan['opciones'][number];
function option(o: Partial<Option> = {}): Option {
  return { titulo: 'Fondo', dimension: 'distancia', subidaPct: 10, distanciaKm: 55, desnivelM: null, motivo: 'Un 10 % más.', ...o };
}
const plan = (...opciones: Option[]): RoutePlan => ({ opciones });
const validPlan = plan(option({ titulo: 'A' }), option({ titulo: 'B' }), option({ titulo: 'C' }));

function route(o: Partial<GeneratedRoute> = {}): GeneratedRoute {
  return {
    id: '7-55000',
    seed: 7,
    coords: [
      [START.lng, START.lat, 100],
      [HOME.lng, HOME.lat, 200],
    ],
    distanceM: 55000,
    elevGainM: 600,
    unpavedM: 0,
    trackM: 0,
    mainRoadPct: 0,
    unknownSurfacePct: 0,
    motorway: false,
    steep: [],
    profile: [],
    maxSteepCls: 3,
    newPct: 40,
    score: 0.8,
    difficulty: 'Media',
    estTimeS: 7000,
    ...o,
  };
}

const result = (routes: GeneratedRoute[], stoppedBy: OrsError | null = null): GenerateResult => ({
  routes,
  rejected: [],
  requestsUsed: 1,
  stoppedBy,
});

/**
 * `generateRoutes` simulado. La llamada n devuelve o lanza lo que dé `byCall(n)`; si da `undefined`,
 * una ruta con la distancia y el desnivel del objetivo.
 */
function fakeGenerate(byCall: (n: number) => GenerateResult | Error | undefined = () => undefined) {
  let n = 0;
  return vi.fn<typeof generateRoutes>(async (req) => {
    const out = byCall(n++);
    if (out instanceof Error) throw out;
    return out ?? result([route({ distanceM: req.target.distanceM, elevGainM: req.target.elevGainM ?? 600 })]);
  });
}

type ChatReq = Parameters<typeof chatJson>[1];
/** `chatJson` simulado: cada llamada devuelve el siguiente paso o lo lanza si es un error. */
function fakeChat(...steps: unknown[]) {
  const fn = vi.fn(async (_cfg: Settings['llm'], _req: ChatReq) => {
    const s = steps.shift();
    if (s instanceof Error) throw s;
    return s;
  });
  return { fn, chat: fn as unknown as typeof chatJson };
}

const invalid = (raw = '{"opciones":[]}') =>
  new LlmError('invalid_json', 'La IA ha devuelto un JSON que no cumple el formato: opciones: Too small', undefined, raw);

const facts = (o: Partial<RouteFacts> = {}): RouteFacts => ({
  id: 'r1',
  titulo: 'Fondo',
  distanciaKm: 62,
  desnivelM: 850,
  tiempoEstimadoMin: 149,
  carreteraNuevaPct: 40,
  dificultad: 'Dura',
  sobreReferenciaPct: 24,
  dimension: 'distancia',
  pendienteMaxima: 'del 7 al 10 %',
  limitadoPorTiempo: false,
  ...o,
});

function deps(chat: typeof chatJson, generate: typeof generateRoutes) {
  return { llm: LLM, orsKey: 'ors-key', visited: new Set<string>(), chat, generate };
}
const input = (a: Answers = answers) => ({ start: START, answers: a, reference: ref, summary });

it('pasa al generador los lados usados por opciones anteriores sin exceder seis consultas', async () => {
  const { chat } = fakeChat(validPlan, { explicaciones: [] });
  const generate = fakeGenerate(() => ({ ...result([route()]), requestsUsed: 2 }));
  await runAiRoutes(input(), deps(chat, generate));
  expect(generate.mock.calls[0][0].usedSides).toEqual([]);
  expect(generate.mock.calls[1][0].usedSides).toEqual([routeSide(route().coords, START)]);
  expect(generate.mock.calls[2][0].usedSides).toEqual([routeSide(route().coords, START)]);
  expect(generate.mock.calls.reduce((n, [req]) => n + (req.seeds ?? 0), 0)).toBeLessThanOrEqual(6);
});

it('usa la biblioteca sin servidor y atribuye solo el esqueleto que ORS ha recorrido', async () => {
  const stored = { ...parseReferenceRoute(`<gpx version="1.1"><trk><name>Vuelta biblioteca</name><trkseg><trkpt lat="${START.lat}" lon="${START.lng}"><ele>100</ele></trkpt><trkpt lat="${START.lat + 0.01}" lon="${START.lng}"><ele>120</ele></trkpt><trkpt lat="${START.lat}" lon="${START.lng}"><ele>100</ele></trkpt></trkseg></trk></gpx>`, 'sintetica.gpx'), id: 'lib1', createdAt: 1, updatedAt: 1 };
  const { fn, chat } = fakeChat(plan(option({ referenciaId: 'ref1' }), option(), option()), { explicaciones: [] });
  const generate = vi.fn<typeof generateRoutes>(async req => result([route({ intentId: req.intents?.[0]?.id })]));
  const out = await runAiRoutes(input(), { ...deps(chat, generate), library: async () => [stored] });
  const payload = JSON.parse(fn.mock.calls[0][1].messages[1].content);
  expect(payload.referencias[0]).toMatchObject({ id: 'ref1', nombre: 'Vuelta biblioteca', fuente: 'biblioteca' });
  expect(Object.keys(payload.referencias[0]).sort()).toEqual(['desnivelM', 'distanciaKm', 'fuente', 'id', 'nombre']);
  expect(generate.mock.calls[0][0].intents?.[0].kind).toBe('library');
  expect(out.kind === 'routes' && out.routes[0].basadaEn).toEqual({ nombre: 'Vuelta biblioteca', fuente: 'biblioteca' });
});

it('la IA elige puerto por id sin coordenadas y el generador recibe los puntos locales', async () => {
  const pass = { id: 'osm-pass-1', name: 'Coll sintético', lat: START.lat + 0.18, lng: START.lng, ele: 600, distanceM: 20000,
    approach: { lat: START.lat + 0.179, lng: START.lng }, departure: { lat: START.lat + 0.181, lng: START.lng } };
  const { fn, chat } = fakeChat(plan(option({ dimension: 'desnivel', puertoId: 'pass1', desnivelM: 550 }), option(), option()), { explicaciones: [] });
  const generate = vi.fn<typeof generateRoutes>(async req => result([route({ intentId: req.intents?.[0]?.id })]));
  const out = await runAiRoutes(input({ ...answers, focus: 'subidas' }), { ...deps(chat, generate), passes: async () => [pass] });
  const sent = JSON.parse(fn.mock.calls[0][1].messages[1].content);
  expect(sent.puertos).toEqual([{ id: 'pass1', nombre: 'Coll sintético', cotaM: 600, distanciaKm: 20 }]);
  expect(generate.mock.calls[0][0].intents?.[0]).toMatchObject({ id: 'pass1', kind: 'pass' });
  expect(generate.mock.calls[0][0].intents?.[0].waypoints[2]).toEqual({ lat: pass.lat, lng: pass.lng });
  expect(out.kind === 'routes' && out.routes[0].puerto).toEqual({ nombre: 'Coll sintético', cotaM: 600 });
  expect(out.kind === 'routes' && out.routes[1].puerto).toBeUndefined();
});

describe('planWithRetry', () => {
  it('valid plan on first try calls chat once', async () => {
    const { fn, chat } = fakeChat(validPlan);
    const out = await planWithRetry(LLM, summary, answers, 100, chat);
    expect(out).toEqual({ ok: true, plan: validPlan });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('invalid then valid retries once with error appended', async () => {
    const { fn, chat } = fakeChat(invalid('{"opciones":[]}'), validPlan);
    const out = await planWithRetry(LLM, summary, answers, 100, chat);

    expect(out.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    const first = fn.mock.calls[0][1].messages;
    const second = fn.mock.calls[1][1].messages;
    expect(second).toHaveLength(first.length + 2);
    expect(second.slice(0, first.length)).toEqual(first);
    const [assistant, user] = second.slice(first.length) as ChatMessage[];
    expect(assistant).toEqual({ role: 'assistant', content: '{"opciones":[]}' });
    expect(user.role).toBe('user');
    expect(user.content.startsWith('Tu respuesta no cumple el formato:')).toBe(true);
    expect(user.content).toContain('opciones: Too small');
  });

  it('rate limit does not retry', async () => {
    const limit = new LlmError('rate_limit', 'El proveedor de IA ha llegado a su límite. Prueba dentro de 12 s.', 12);
    const { fn, chat } = fakeChat(limit, validPlan);
    const out = await planWithRetry(LLM, summary, answers, 100, chat);
    expect(out).toEqual({ ok: false, error: limit });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('targetsFromPlan', () => {
  it('clamps uplift into 5-15 %', () => {
    const [high, low, climb] = targetsFromPlan(
      plan(
        option({ distanciaKm: 70 }),
        option({ distanciaKm: 51 }),
        option({ dimension: 'desnivel', distanciaKm: 50, desnivelM: 800 }),
      ),
      ref,
      answers,
    );
    expect(high.target.distanceM).toBe(57500);
    expect(high.upliftPct).toBeCloseTo(15);
    expect(low.target.distanceM).toBe(52500);
    expect(low.upliftPct).toBeCloseTo(5);
    expect(climb.target.elevGainM).toBe(575);
    expect(climb.upliftPct).toBeCloseTo(15);
    expect([high, low, climb].every((t) => !t.limitadoPorTiempo)).toBe(true);
  });

  it('time cap below uplift keeps time limit and flags', () => {
    const [t] = targetsFromPlan(plan(option({ distanciaKm: 55 })), ref, { ...answers, minutes: 60 });
    expect(t.target.distanceM).toBe(25000);
    expect(t.limitadoPorTiempo).toBe(true);
    expect(t.upliftPct).toBeCloseTo(-50);
  });

  it('explore maps to preferNew', () => {
    const p = plan(option());
    expect(targetsFromPlan(p, ref, { ...answers, explore: 'descubrir' })[0].target.preferNew).toBe(true);
    expect(targetsFromPlan(p, ref, { ...answers, explore: 'repetir' })[0].target.preferNew).toBe(false);
  });
});

describe('suggestedTarget', () => {
  it('is 10 % over the reference in the focus dimension', () => {
    expect(suggestedTarget(ref, { ...answers, focus: 'fondo' })).toEqual({ distanceM: 55000, elevGainM: null, preferNew: true });
    expect(suggestedTarget(ref, { ...answers, focus: 'subidas', explore: 'repetir' })).toEqual({
      distanceM: 50000,
      elevGainM: 550,
      preferNew: false,
    });
    expect(suggestedTarget(ref, { ...answers, focus: 'mixto' })).toEqual({ distanceM: 55000, elevGainM: 550, preferNew: true });
  });

  it('is capped by the available time', () => {
    expect(suggestedTarget(ref, { ...answers, minutes: 60 }).distanceM).toBe(25000);
  });
});

describe('citesFigures', () => {
  it('accepts the distance or the elevation as format.ts writes them', () => {
    expect(citesFigures('Son 62 km por la costa.', facts())).toBe(true);
    expect(citesFigures('Sube 850 m en total.', facts())).toBe(true);
    expect(citesFigures('Son 62,4 km.', facts({ distanciaKm: 62.4 }))).toBe(true);
    expect(citesFigures('Acumula 1240 m.', facts({ desnivelM: 1240 }))).toBe(true);
  });

  it('rejects texts without those figures', () => {
    expect(citesFigures('Una ruta preciosa.', facts())).toBe(false);
    expect(citesFigures('Son 162 km y 1850 m.', facts())).toBe(false);
    expect(citesFigures('Unos 850 min de pedaleo.', facts())).toBe(false);
  });
});

describe('templateExplanation', () => {
  it('cites the figures of the route', () => {
    const text = templateExplanation(facts());
    expect(citesFigures(text, facts())).toBe(true);
    expect(text).toContain('62 km');
    expect(text).toContain('850 m');
    expect(text).toContain('+24 %');
    expect(text).not.toContain('limitada por tu tiempo disponible');
  });

  it('says when the time limited the route', () => {
    expect(templateExplanation(facts({ limitadoPorTiempo: true }))).toContain('limitada por tu tiempo disponible');
  });
});

describe('runAiRoutes', () => {
  it('invalid twice falls back with suggested target', async () => {
    const { fn, chat } = fakeChat(invalid(), invalid());
    const generate = fakeGenerate();
    const out = await runAiRoutes(input(), deps(chat, generate));

    expect(out).toEqual({
      kind: 'fallback',
      message: 'La IA no ha devuelto un plan válido. Ajusta la ruta a mano.',
      cause: 'invalid_json',
      suggested: suggestedTarget(ref, answers),
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(generate).not.toHaveBeenCalled();
  });

  it('rate limit does not retry and falls back with its message', async () => {
    const limit = new LlmError('rate_limit', 'El proveedor de IA ha llegado a su límite. Prueba dentro de 12 s.', 12);
    const { fn, chat } = fakeChat(limit);
    const out = await runAiRoutes(input(), deps(chat, fakeGenerate()));

    expect(out).toEqual({ kind: 'fallback', message: limit.message, cause: 'rate_limit', suggested: suggestedTarget(ref, answers) });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('one ors search per option, sharing six requests across the complete plan', async () => {
    const four = plan(option({ titulo: 'A' }), option({ titulo: 'B' }), option({ titulo: 'C' }), option({ titulo: 'D' }));
    const { chat } = fakeChat(four, { explicaciones: [] });
    const generate = fakeGenerate();
    const d = deps(chat, generate);
    const out = await runAiRoutes(input(), d);

    expect(generate).toHaveBeenCalledTimes(4);
    expect(generate.mock.calls.map(([req]) => req.seeds)).toEqual([1, 1, 2, 3]);
    for (const [req, g] of generate.mock.calls) {
      expect(req).toMatchObject({ start: START, count: 1 });
      expect(g).toMatchObject({ apiKey: 'ors-key', reference: ref, visited: d.visited });
    }
    expect(out.kind === 'routes' && out.routes.map((r) => r.titulo)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('never multiplies the budget when no AI option yields a clean route', async () => {
    const { chat } = fakeChat(validPlan, { explicaciones: [] });
    const generate = vi.fn<typeof generateRoutes>(async req => ({ ...result([]), requestsUsed: req.seeds! }));
    await runAiRoutes(input(), deps(chat, generate));
    expect(generate.mock.calls.map(([req]) => req.seeds)).toEqual([2, 2, 2]);
    expect((await Promise.all(generate.mock.results.map(r => r.value))).reduce((sum, r) => sum + r.requestsUsed, 0)).toBe(6);
  });

  it('option without route is dropped with warning', async () => {
    const { chat } = fakeChat(validPlan, { explicaciones: [] });
    // La segunda opción no devuelve ninguna ruta.
    const generate = fakeGenerate((n) => (n === 1 ? result([]) : undefined));
    const out = await runAiRoutes(input(), deps(chat, generate));

    expect(out.kind).toBe('routes');
    if (out.kind !== 'routes') return;
    expect(out.routes.map((r) => r.titulo)).toEqual(['A', 'C']);
    expect(out.warnings).toEqual(['No hay ruta de asfalto para "B".']);
  });

  it('ors quota error stops and reports', async () => {
    const quota = new OrsError('quota_day', 'Has gastado las 2.000 consultas diarias de ORS.');
    const { chat } = fakeChat(validPlan, { explicaciones: [] });
    const generate = fakeGenerate((n) => (n === 1 ? quota : undefined));
    const out = await runAiRoutes(input(), deps(chat, generate));

    expect(generate).toHaveBeenCalledTimes(2);
    expect(out.kind === 'routes' && out.routes.map((r) => r.titulo)).toEqual(['A']);
    expect(out.kind === 'routes' && out.warnings).toEqual([quota.message]);
  });

  it('ors quota error without routes propagates', async () => {
    const quota = new OrsError('quota_day', 'Has gastado las 2.000 consultas diarias de ORS.');
    const { chat } = fakeChat(validPlan);
    await expect(runAiRoutes(input(), deps(chat, fakeGenerate(() => quota)))).rejects.toBe(quota);
  });

  it('ors error cut inside a search keeps its routes and stops', async () => {
    const minute = new OrsError('rate_minute', 'Has pasado de 40 consultas por minuto en ORS.');
    const { chat } = fakeChat(validPlan, { explicaciones: [] });
    const generate = fakeGenerate(() => result([route()], minute));
    const out = await runAiRoutes(input(), deps(chat, generate));

    expect(generate).toHaveBeenCalledTimes(1);
    expect(out.kind === 'routes' && out.routes).toHaveLength(1);
    expect(out.kind === 'routes' && out.warnings).toEqual([minute.message]);
  });

  it('time cap below uplift keeps time limit and flags', async () => {
    const { chat } = fakeChat(plan(option({ distanciaKm: 55 })), invalid(), invalid());
    const generate = fakeGenerate();
    const out = await runAiRoutes(input({ ...answers, minutes: 60 }), deps(chat, generate));

    expect(generate.mock.calls[0][0].target.distanceM).toBe(25000);
    expect(out.kind === 'routes' && out.routes[0].explicacion).toContain('limitada por tu tiempo disponible');
    expect(out.kind === 'routes' && out.routes[0].limitadoPorTiempo).toBe(true);
  });

  it('explanation citing figures is kept', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture('plan-ok.json'))))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture('explain-ok.json'))));
    const chat = ((cfg, req) => chatJson(cfg, req, fetchImpl)) as typeof chatJson;
    const generate = fakeGenerate((n) =>
      [result([route({ distanceM: 62000, elevGainM: 850 })]), result([route({ distanceM: 51100, elevGainM: 520 })]), result([route()])][n],
    );
    const out = await runAiRoutes(input(), deps(chat, generate));

    expect(out.kind).toBe('routes');
    if (out.kind !== 'routes') return;
    expect(out.routes[0].explicacion).toBe(
      '62 km y 850 m de desnivel: un 10 % más de distancia que tu media, con el 40 % de carretera nueva.',
    );
    expect(out.routes[1].explicacion).toBe('51,1 km y 520 m: casi tu salida habitual, con un repecho de dificultad media.');
    // La fixture no trae explicación para la tercera: la escribe el código.
    expect(out.routes[2].explicacion).toContain('55 km');
  });

  it('explanation without figures replaced by template', async () => {
    const { chat } = fakeChat(plan(option({ titulo: 'A' })), {
      explicaciones: [{ id: 'r1', texto: 'Una ruta preciosa.' }],
    });
    const generate = fakeGenerate(() => result([route({ distanceM: 62000, elevGainM: 850 })]));
    const out = await runAiRoutes(input(), deps(chat, generate));

    expect(out.kind).toBe('routes');
    if (out.kind !== 'routes') return;
    expect(out.routes[0].explicacion).not.toBe('Una ruta preciosa.');
    expect(out.routes[0].explicacion).toContain('62 km');
    expect(out.routes[0].explicacion).toContain('850 m');
  });

  it('explanation failure uses templates, routes kept', async () => {
    const limit = new LlmError('rate_limit', 'Límite.', 30);
    const { fn, chat } = fakeChat(validPlan, limit);
    const out = await runAiRoutes(input(), deps(chat, fakeGenerate()));

    expect(fn).toHaveBeenCalledTimes(2);
    expect(out.kind).toBe('routes');
    if (out.kind !== 'routes') return;
    expect(out.routes).toHaveLength(3);
    for (const r of out.routes) expect(r.explicacion).toContain(`${Math.round(r.distanceM / 1000)} km`);
  });

  it('routes carry title, dimension and uplift over the reference', async () => {
    const { chat } = fakeChat(plan(option({ titulo: 'A', distanciaKm: 55 })), { explicaciones: [] });
    const out = await runAiRoutes(input(), deps(chat, fakeGenerate()));
    expect(out.kind === 'routes' && out.routes[0]).toMatchObject({ titulo: 'A', dimension: 'distancia', distanceM: 55000 });
    expect(out.kind === 'routes' && out.routes[0].upliftPct).toBeCloseTo(10);
  });

  it('abort after the first option stops further ORS and LLM calls', async () => {
    const { fn, chat } = fakeChat(validPlan, { explicaciones: [] });
    const ctrl = new AbortController();
    const generate = fakeGenerate(() => {
      ctrl.abort();
      return result([route()]);
    });

    await expect(runAiRoutes(input(), { ...deps(chat, generate), signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1); // solo el plan; sin explicación
    expect(generate.mock.calls[0][1].signal).toBe(ctrl.signal);
    expect(fn.mock.calls[0][1].signal).toBe(ctrl.signal);
  });

  it('ai requests never include home, start or tracks', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture('plan-ok.json'))))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture('explain-ok.json'))))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture('plan-ok.json'))))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture('explain-ok.json'))));
    const chat = ((cfg, req) => chatJson(cfg, req, fetchImpl)) as typeof chatJson;

    for (const start of [HOME, START]) {
      const out = await runAiRoutes({ ...input(), start }, deps(chat, fakeGenerate()));
      expect(out.kind === 'routes' && out.routes.length).toBe(3);
    }

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchImpl.mock.calls) {
      const body = String(init?.body);
      for (const banned of ['41.1', '2.65', '41.2', '2.7', 'coordinates', 'coords']) expect(body).not.toContain(banned);
    }
  });
});

describe('runAiRoutes con la IA compartida', () => {
  /** Contenido JSON de una respuesta guardada del proveedor, como lo devuelve la función `ai-routes`. */
  const content = (name: string) => JSON.parse((fixture(name) as { choices: { message: { content: string } }[] }).choices[0].message.content);
  const sharedReply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const shared = (fetchImpl: typeof fetch) => createSharedAiPlanner(async () => 'session', fetchImpl);

  it('si el servicio no está disponible (503) y hay clave personal, la usa', async () => {
    const down = vi.fn<typeof fetch>(async () => sharedReply(503, { error: { code: 'unavailable' } }));
    const { fn, chat } = fakeChat(validPlan, { explicaciones: [] });
    const out = await runAiRoutes(input(), { ...deps(chat, fakeGenerate()), shared: shared(down) });

    expect(out.kind).toBe('routes');
    expect(fn).toHaveBeenCalledTimes(2); // plan y explicación con la clave personal
    expect(fn.mock.calls[0][0]).toBe(LLM);
  });

  it('si falla la red, también vuelve a la clave personal', async () => {
    const offline = vi.fn<typeof fetch>(async () => { throw new TypeError('Failed to fetch'); });
    const { fn, chat } = fakeChat(validPlan, { explicaciones: [] });
    expect((await runAiRoutes(input(), { ...deps(chat, fakeGenerate()), shared: shared(offline) })).kind).toBe('routes');
    expect(fn).toHaveBeenCalled();
  });

  it('con la cuota agotada (429) no reintenta con la clave personal y muestra el límite', async () => {
    const limited = vi.fn<typeof fetch>(async () => sharedReply(429, { error: { code: 'quota_exceeded' }, retryAfterS: 3600 }));
    const { fn, chat } = fakeChat(validPlan);
    const out = await runAiRoutes(input(), { ...deps(chat, fakeGenerate()), shared: shared(limited) });

    expect(out).toMatchObject({ kind: 'fallback', cause: 'rate_limit', message: expect.stringMatching(/límite/) });
    expect(fn).not.toHaveBeenCalled();
  });

  it('sin clave personal, un servicio caído lleva al formulario manual', async () => {
    const down = vi.fn<typeof fetch>(async () => sharedReply(503, {}));
    const { fn, chat } = fakeChat(validPlan);
    const out = await runAiRoutes(input(), { ...deps(chat, fakeGenerate()), llm: { ...LLM, apiKey: '' }, shared: shared(down) });

    expect(out.kind).toBe('fallback');
    expect(fn).not.toHaveBeenCalled();
  });

  it('las peticiones al servicio común nunca llevan Casa, el inicio ni tracks', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(sharedReply(200, { data: content('plan-ok.json') }))
      .mockResolvedValueOnce(sharedReply(200, { data: content('explain-ok.json') }));
    const out = await runAiRoutes({ ...input(), start: HOME }, { ...deps(fakeChat().chat, fakeGenerate()), shared: shared(fetchImpl) });

    expect(out.kind === 'routes' && out.routes.length).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImpl.mock.calls) {
      const body = String(init?.body);
      for (const banned of ['41.1', '2.65', '41.2', '2.7', 'lat', 'lng', 'coordinates', 'coords']) expect(body).not.toContain(banned);
    }
  });
});


describe('runAiRoutes con rutas conocidas cerca del inicio', () => {
  const at = '2026-11-09T12:00:00.000Z';
  /** Referencia sintética de OSM: enlace inventado y geometría en el mar. */
  const known = (n: number, distanceM = 52_000): RouteReference => ({
    source: 'osm', url: `https://www.openstreetmap.org/relation/90000${n}`, author: 'Autor ficticio', name: `Vuelta sintética ${n}`,
    distanceM, ascentM: 640, geometry: { type: 'MultiLineString', coordinates: [[[2.5, 41.0], [2.51, 41.01]]] }, fetchedAt: at,
  });
  /** `route-sources` simulado: Wikiloc vacío y OSM con `routes`, o un error en las dos. */
  function sources(routes: RouteReference[] | 'down') {
    const invoke = vi.fn<RouteSourceInvoker['invoke']>(async (_name, { body }) => {
      if (routes === 'down') return { data: null, error: new Error('unavailable') };
      return { data: { data: body.source === 'osm' ? routes : [] }, error: null };
    });
    return { invoke };
  }
  const withRef = (referenciaId: string | null) => plan(option({ titulo: 'A', referenciaId }), option({ titulo: 'B' }), option({ titulo: 'C' }));

  beforeEach(() => vi.stubEnv('VITE_ROUTE_SOURCES_ENABLED', 'true'));
  afterEach(() => vi.unstubAllEnvs());

  it('busca a 15 km del inicio con la señal y pasa a la IA solo las cifras de cada referencia', async () => {
    const src = sources([known(1)]);
    const { fn, chat } = fakeChat(withRef('ref1'), { explicaciones: [] });
    const signal = new AbortController().signal;
    await runAiRoutes(input(), { ...deps(chat, fakeGenerate()), sources: src, signal });

    expect(src.invoke).toHaveBeenCalledWith('route-sources', { body: { lat: START.lat, lon: START.lng, radiusM: 15_000, source: 'wikiloc' }, signal });
    const sent = fn.mock.calls[0][1].messages.map((m) => m.content).join('\n');
    expect(JSON.parse(fn.mock.calls[0][1].messages[1].content).referencias).toEqual([
      { id: 'ref1', nombre: 'Vuelta sintética 1', fuente: 'osm', distanciaKm: 52, desnivelM: 640 },
    ]);
    for (const banned of ['openstreetmap', 'Autor ficticio', '41.0', '2.51', String(START.lat)]) expect(sent).not.toContain(banned);
  });

  it('una referencia externa sin esqueleto no se atribuye a una vuelta aleatoria', async () => {
    const { chat } = fakeChat(withRef('ref1'), { explicaciones: [] });
    const out = await runAiRoutes(input(), { ...deps(chat, fakeGenerate()), sources: sources([known(1)]) });

    if (out.kind !== 'routes') throw new Error('se esperaban rutas');
    expect(out.routes[0].basadaEn).toBeUndefined();
    expect(out.routes[1].basadaEn).toBeUndefined();
  });

  it('un referenciaId desconocido se ignora', async () => {
    const { chat } = fakeChat(withRef('ref9'), { explicaciones: [] });
    const out = await runAiRoutes(input(), { ...deps(chat, fakeGenerate()), sources: sources([known(1)]) });

    expect(out.kind === 'routes' && out.routes.map((r) => r.basadaEn)).toEqual([undefined, undefined, undefined]);
  });

  it('sin referencias cerca, el plan no lleva el campo y nada sale basado en ellas', async () => {
    const { fn, chat } = fakeChat(withRef('ref1'), { explicaciones: [] });
    const out = await runAiRoutes(input(), { ...deps(chat, fakeGenerate()), sources: sources([]) });

    expect(JSON.parse(fn.mock.calls[0][1].messages[1].content)).not.toHaveProperty('referencias');
    expect(out.kind === 'routes' && out.routes.every((r) => r.basadaEn === undefined)).toBe(true);
  });

  it('con las fuentes caídas, el plan sigue y aparece un aviso', async () => {
    const { fn, chat } = fakeChat(validPlan, { explicaciones: [] });
    const out = await runAiRoutes(input(), { ...deps(chat, fakeGenerate()), sources: sources('down') });

    expect(out.kind).toBe('routes');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(out.kind === 'routes' && out.warnings).toEqual([expect.stringMatching(/rutas conocidas/)]);
  });

  it('con la variable apagada, no llama a route-sources', async () => {
    vi.stubEnv('VITE_ROUTE_SOURCES_ENABLED', 'false');
    const src = sources([known(1)]);
    const { fn, chat } = fakeChat(validPlan, { explicaciones: [] });
    await runAiRoutes(input(), { ...deps(chat, fakeGenerate()), sources: src });

    expect(src.invoke).not.toHaveBeenCalled();
    expect(JSON.parse(fn.mock.calls[0][1].messages[1].content)).not.toHaveProperty('referencias');
  });

  it('cancelar durante la búsqueda de referencias no pide el plan', async () => {
    const controller = new AbortController();
    const src = { invoke: vi.fn<RouteSourceInvoker['invoke']>(async () => { controller.abort(); throw new DOMException('Cancelado', 'AbortError'); }) };
    const { fn, chat } = fakeChat(validPlan);
    await expect(runAiRoutes(input(), { ...deps(chat, fakeGenerate()), sources: src, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('el servicio común recibe las referencias sin enlaces ni coordenadas', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: withRef('ref1') }), { status: 200 }));
    const shared = createSharedAiPlanner(async () => 'session', fetchImpl);
    const out = await shared.plan(summary, answers, 100, undefined, [{ id: 'ref1', nombre: 'Vuelta sintética 1', fuente: 'osm', distanciaKm: 52, desnivelM: 640 }]);

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.referencias).toEqual([{ id: 'ref1', nombre: 'Vuelta sintética 1', fuente: 'osm', distanciaKm: 52, desnivelM: 640 }]);
    expect(out.opciones[0].referenciaId).toBe('ref1');
  });
});

describe('runAiRoutes con rutas de Ride with GPS cerca del inicio', () => {
  const M_LAT = 111_320;
  /** Circuito sintético de unos 60 km hacia el noreste del inicio, en el formato de la op `nearby`. */
  const line = Array.from({ length: 41 }, (_, i) => {
    const t = (i / 40) * 2 * Math.PI;
    const d = 9_500 * (1 - Math.cos(t));
    return [START.lng + (d * Math.SQRT1_2) / (M_LAT * Math.cos((START.lat * Math.PI) / 180)), START.lat + (d * Math.SQRT1_2) / M_LAT];
  });
  const nearby = { id: '77', name: 'Vuelta sintética de Ride with GPS', author: 'Autora ficticia', distanceM: 61_240, elevGainM: 712, start: { lat: START.lat, lng: START.lng }, line, passM: 1_400 };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const rwgps = (reply: () => Response) => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => reply());
    return { fetchImpl, access: { getToken: async () => 'sesion-sintetica', fetch: fetchImpl as unknown as typeof fetch } };
  };

  it('pide la zona a 15 km con la distancia objetivo y a la IA solo le llegan cifras', async () => {
    const { fetchImpl, access } = rwgps(() => json({ data: { routes: [nearby], total: 1 } }));
    const { fn, chat } = fakeChat(validPlan, { explicaciones: [] });
    const out = await runAiRoutes(input(), { ...deps(chat, fakeGenerate()), rwgps: access, library: async () => [] });

    expect(out.kind).toBe('routes');
    const asked = JSON.parse(String(fetchImpl.mock.calls[0][1].body));
    expect(asked).toMatchObject({ op: 'nearby', radiusKm: 15, distanceKm: 55 });
    const referencias = JSON.parse(fn.mock.calls[0][1].messages[1].content).referencias;
    expect(referencias).toEqual([{ id: 'ref1', nombre: 'Vuelta sintética de Ride with GPS', fuente: 'rwgps', distanciaKm: 61.2, desnivelM: 712, aInicioKm: 1.4, direccion: 'noreste' }]);
    const sent = fn.mock.calls.flatMap((c) => c[1].messages.map((m) => m.content)).join('\n');
    for (const banned of ['ridewithgps', 'Autora ficticia', String(START.lat), String(line[10][1]).slice(0, 7)]) expect(sent).not.toContain(banned);
  });

  it('si Ride with GPS falla, el plan sigue sin esas rutas y lo avisa', async () => {
    const { access } = rwgps(() => json({ error: { code: 'unavailable' } }, 503));
    const { fn, chat } = fakeChat(validPlan, { explicaciones: [] });
    const out = await runAiRoutes(input(), { ...deps(chat, fakeGenerate()), rwgps: access, library: async () => [] });

    expect(out.kind).toBe('routes');
    expect(JSON.parse(fn.mock.calls[0][1].messages[1].content)).not.toHaveProperty('referencias');
    expect(out.kind === 'routes' && out.warnings).toEqual([expect.stringMatching(/Ride with GPS/)]);
  });

  it('el servicio común recibe la distancia al inicio y la dirección de las de Ride with GPS', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: validPlan }), { status: 200 }));
    const shared = createSharedAiPlanner(async () => 'session', fetchImpl);
    const ref1 = { id: 'ref1', nombre: 'Vuelta sintética', fuente: 'rwgps' as const, distanciaKm: 61.2, desnivelM: 712, aInicioKm: 1.4, direccion: 'noreste' as const };
    await shared.plan(summary, answers, 100, undefined, [ref1]);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).referencias).toEqual([ref1]);
  });
});

describe('runAiRoutes con el objetivo del usuario', () => {
  const objetivo: AiGoal = { tipo: 'evento', diasHasta: 12, distanciaKm: 120, desnivelM: 1500 };
  const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  it('con la clave personal, el objetivo va en el plan y no en la explicación', async () => {
    const { fn, chat } = fakeChat(validPlan, { explicaciones: [] });
    await runAiRoutes(input(), { ...deps(chat, fakeGenerate()), goal: objetivo });
    expect(JSON.parse(fn.mock.calls[0][1].messages[1].content).objetivo).toEqual(objetivo);
    expect(JSON.parse(fn.mock.calls[1][1].messages[1].content)).not.toHaveProperty('objetivo');
  });

  it('sin objetivo, el plan no lleva el campo', async () => {
    const { fn, chat } = fakeChat(validPlan, { explicaciones: [] });
    await runAiRoutes(input(), { ...deps(chat, fakeGenerate()), goal: null });
    expect(JSON.parse(fn.mock.calls[0][1].messages[1].content)).not.toHaveProperty('objetivo');
  });

  it('el servicio común recibe el objetivo en el plan y no en la explicación', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValueOnce(reply({ data: validPlan })).mockResolvedValueOnce(reply({ data: { explicaciones: [] } }));
    const shared = createSharedAiPlanner(async () => 'session', fetchImpl);
    const out = await runAiRoutes(input(), { ...deps(fakeChat().chat, fakeGenerate()), shared, goal: objetivo });
    expect(out.kind).toBe('routes');
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).objetivo).toEqual(objetivo);
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).not.toHaveProperty('objetivo');
  });

  it('el cliente común solo envía las cifras del objetivo', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply({ data: validPlan }));
    const shared = createSharedAiPlanner(async () => 'session', fetchImpl);
    await shared.plan(summary, answers, 100, undefined, [], { ...objetivo, titulo: 'Marcha de Mallorca' } as AiGoal);
    const body = String(fetchImpl.mock.calls[0][1]?.body);
    expect(JSON.parse(body).objetivo).toEqual(objetivo);
    expect(body).not.toContain('Mallorca');
  });
});
