import { readFileSync } from 'node:fs';
import type { LevelSummary } from '../src/ai/contracts';
import { chatJson } from '../src/ai/llm';
import { buildWorkoutMessages } from '../src/ai/prompts';
import type { WorkoutWeek } from '../src/ai/schema';
import { handleSharedAi, sharedAiRequestSchema } from '../src/ai/shared/service';
import { createSharedWorkoutPlanner } from '../src/ai/sharedClient';
import { busyDays, nextGoal, proposeWeek, toPlannedWorkouts, trimWeek, type WeekRequest } from '../src/ai/workoutPlanner';
import type { Goal, PlannedWorkout, Settings } from '../src/domain/types';

const fixture = (name: string): unknown => JSON.parse(readFileSync(`tests/fixtures/llm/${name}`, 'utf8'));
const cfg: Settings['llm'] = { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'test-key', model: 'openai/gpt-oss-20b' };
const respond = (...bodies: [number, unknown][]) => {
  const f = vi.fn<typeof fetch>();
  for (const [status, body] of bodies) f.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  return f;
};
const chatWith = (f: typeof fetch): typeof chatJson => (c, req) => chatJson(c, req, f);
const notJson = { choices: [{ index: 0, message: { role: 'assistant', content: '{"entrenos":' }, finish_reason: 'length' }] };

/** 50 km y 600 m de media: el tope es 57,5 km y 690 m. */
const summary: LevelSummary = {
  fuente: 'historial', semanas: 8, salidas: 16, salidasPorSemana: 2, distanciaMediaKm: 50, desnivelMedioM: 600,
  tiempoMedioMin: 120, velocidadMediaKmh: 25, distanciaMaxKm: 80, desnivelMaxM: 1100, vamMediaMh: 700, subidaMasLarga: { km: 6, pendienteMediaPct: 5.5 },
};
const TODAY = '2026-11-06';
const request = (over: Partial<WeekRequest> = {}): WeekRequest => ({
  summary, objetivo: null, ocupados: [], disponibles: [0, 1, 2, 3, 4, 5, 6], notas: '', ...over,
});
const e = (dia: number, distanciaKm: number, desnivelM: number | null = null, titulo = `Día ${dia}`) => ({ dia, titulo, distanciaKm, desnivelM, notas: '' });
const week = (...entrenos: WorkoutWeek['entrenos']): WorkoutWeek => ({ entrenos, motivo: 'Tu media es de 50 km.' });

describe('entrenos de la semana: recorte en código', () => {
  it('ninguna salida pasa de un 15 % sobre la referencia de distancia ni de desnivel', () => {
    const out = trimWeek(week(e(1, 90, 2000)), request());
    expect(out.entrenos).toEqual([{ ...e(1, 57.5, 690) }]);
    expect(out.descartadas).toBe(0);
  });

  it('descarta los días ocupados, los repetidos y los no disponibles', () => {
    const out = trimWeek(week(e(1, 30), e(2, 30, null, 'Primero'), e(2, 35), e(3, 30), e(4, 30)), request({ ocupados: [1], disponibles: [1, 2, 4] }));
    expect(out.entrenos.map(x => [x.dia, x.titulo])).toEqual([[2, 'Primero'], [4, 'Día 4']]);
    expect(out.descartadas).toBe(3);
  });

  it('deja como mucho una salida larga: la más larga', () => {
    const out = trimWeek(week(e(0, 55), e(3, 30), e(5, 70), e(6, 52)), request());
    expect(out.entrenos.map(x => [x.dia, x.distanciaKm])).toEqual([[3, 30], [5, 57.5]]);
    expect(out.descartadas).toBe(2);
  });

  it('ordena por día', () => {
    expect(trimWeek(week(e(4, 30), e(1, 30)), request()).entrenos.map(x => x.dia)).toEqual([1, 4]);
  });

  it('drops a workout that the clamp would leave at 0 km', () => {
    const out = trimWeek(week(e(1, 30)), request({ summary: { ...summary, distanciaMediaKm: 0 } }));
    expect(out.entrenos).toEqual([]);
    expect(out.descartadas).toBe(1);
  });
});

describe('entrenos de la semana: lo que ve la IA', () => {
  const goals: Goal[] = [
    { kind: 'event', id: 'g1', title: 'Marcha de Puigcerdà', date: '2026-11-20', distanceM: 92_400, elevGainM: 1650, createdAt: 1 },
    { kind: 'event', id: 'g0', title: 'Pasada', date: '2026-11-01', distanceM: 50_000, createdAt: 1 },
    { kind: 'event', id: 'g2', title: 'Lejana', date: '2027-03-01', elevGainM: 2000, createdAt: 1 },
    { kind: 'volume', id: 'v1', title: 'Semana', period: 'week', start: '2026-11-02', distanceM: 200_000, createdAt: 1 },
  ];

  it('el objetivo con fecha más próximo, sin nombre ni lugar', () => {
    expect(nextGoal(goals, TODAY)).toEqual({ diasHasta: 14, distanciaKm: 92.4, desnivelM: 1650 });
    expect(nextGoal([goals[1], goals[3]], TODAY)).toBeNull();
  });

  it('días ocupados de los próximos 7 días, como índices desde hoy', () => {
    const w = (date: string): PlannedWorkout => ({ id: date, date, title: 'X', done: false, manual: false, createdAt: 1 });
    expect(busyDays([w('2026-11-05'), w('2026-11-06'), w('2026-11-09'), w('2026-11-09'), w('2026-11-13')], TODAY)).toEqual([0, 3]);
  });

  it('el mensaje no lleva coordenadas ni el nombre del objetivo; las notas, como mucho 200 caracteres', () => {
    const msgs = buildWorkoutMessages(summary, { objetivo: nextGoal(goals, TODAY), ocupados: [0], disponibles: [1, 2], notas: 'x'.repeat(300) });
    const text = JSON.stringify(msgs);
    expect(text).not.toMatch(/Puigcerd|Marcha|"lat"|"lng"|"lon"|coordinates/);
    const user = JSON.parse(msgs[1].content);
    expect(user).toEqual({ resumen: summary, objetivo: { diasHasta: 14, distanciaKm: 92.4, desnivelM: 1650 }, diasOcupados: [0], diasDisponibles: [1, 2], notas: 'x'.repeat(200) });
    expect(msgs[0].content).toMatch(/descanso/);
  });
});

describe('entrenos de la semana: proveedor', () => {
  it('con clave propia, valida la respuesta y recorta las cifras', async () => {
    const f = respond([200, fixture('workouts-ok.json')]);
    const out = await proposeWeek(request(), { personal: cfg, chat: chatWith(f) });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.entrenos.map(x => [x.dia, x.distanciaKm, x.desnivelM])).toEqual([[0, 35, 300], [2, 45, 690], [5, 57.5, 650]]);
    expect(out.motivo).toMatch(/50 km/);
    const body = JSON.parse(String(f.mock.calls[0][1]!.body));
    expect(body.response_format.json_schema.name).toBe('entrenos_semana');
  });

  it('respuesta inválida dos veces: avisa y no devuelve entrenos', async () => {
    const f = respond([200, notJson], [200, notJson]);
    const out = await proposeWeek(request(), { personal: cfg, chat: chatWith(f) });
    expect(f).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ ok: false, cause: 'invalid_json' });
    expect('entrenos' in out).toBe(false);
  });

  it('si el recorte no deja ningún entreno, es un error', async () => {
    const body = { choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(week(e(0, 30))) }, finish_reason: 'stop' }] };
    const out = await proposeWeek(request({ ocupados: [0] }), { personal: cfg, chat: chatWith(respond([200, body])) });
    expect(out).toMatchObject({ ok: false });
  });

  it('límite del proveedor con clave propia: no reintenta', async () => {
    const f = respond([429, fixture('rate-limit-429.json')]);
    const out = await proposeWeek(request(), { personal: cfg, chat: chatWith(f) });
    expect(f).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ ok: false, cause: 'rate_limit' });
    if (!out.ok) expect(out.message).toMatch(/límite/);
  });

  it('servicio común caído (503) y clave propia: usa la clave', async () => {
    const server = respond([503, { error: { code: 'unavailable', message: 'No disponible.' } }]);
    const f = respond([200, fixture('workouts-ok.json')]);
    const out = await proposeWeek(request(), { personal: cfg, shared: createSharedWorkoutPlanner(async () => 'jwt', server), chat: chatWith(f) });
    expect(server).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(true);
  });

  it('servicio común con la cuota agotada (429): no reintenta ni gasta la clave propia', async () => {
    const server = respond([429, { error: { code: 'quota_exceeded', message: 'Límite.' }, retryAfterS: 60 }]);
    const f = respond([200, fixture('workouts-ok.json')]);
    const out = await proposeWeek(request(), { personal: cfg, shared: createSharedWorkoutPlanner(async () => 'jwt', server), chat: chatWith(f) });
    expect(server).toHaveBeenCalledTimes(1);
    expect(f).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ok: false, cause: 'rate_limit' });
  });

  it('sin IA disponible, error claro', async () => {
    expect(await proposeWeek(request(), { personal: { ...cfg, apiKey: '' } })).toMatchObject({ ok: false, cause: 'no_model' });
  });
});

describe('entrenos de la semana: guardado', () => {
  it('fecha desde hoy, notas con «IA:», sin hacer y no manuales', () => {
    const [w] = toPlannedWorkouts([{ dia: 3, titulo: 'Subidas', distanciaKm: 45.25, desnivelM: 690, notas: 'Dos puertos.' }], TODAY, 1234);
    expect(w).toMatchObject({ date: '2026-11-09', title: 'Subidas', distanceM: 45_250, elevGainM: 690, notes: 'IA: Dos puertos.', done: false, manual: false, createdAt: 1234 });
    expect(w.id).toBeTruthy();
    const [flat] = toPlannedWorkouts([{ dia: 0, titulo: 'Rodaje', distanciaKm: 30, desnivelM: null, notas: '' }], TODAY, 1);
    expect(flat).not.toHaveProperty('elevGainM');
    expect(flat.notes).toBe('IA:');
  });
});

describe('entrenos de la semana por el servicio común', () => {
  const input = { operation: 'workouts', summary, objetivo: { diasHasta: 14, distanciaKm: 92.4, desnivelM: 1650 }, ocupados: [0], disponibles: [1, 2, 5], notas: '' };

  it('el servidor acepta la operación con cifras y rechaza campos extra o notas libres', () => {
    expect(sharedAiRequestSchema.safeParse(input).success).toBe(true);
    expect(sharedAiRequestSchema.safeParse({ ...input, objetivo: null }).success).toBe(true);
    expect(sharedAiRequestSchema.safeParse({ ...input, home: { lat: 41, lng: 2 } }).success).toBe(false);
    expect(sharedAiRequestSchema.safeParse({ ...input, objetivo: { ...input.objetivo, titulo: 'Marcha' } }).success).toBe(false);
    expect(sharedAiRequestSchema.safeParse({ ...input, notas: 'Calle privada 7' }).success).toBe(false);
    expect(sharedAiRequestSchema.safeParse({ ...input, disponibles: [7] }).success).toBe(false);
  });

  it('el cliente envía la operación sin notas, cuenta una vez contra la cuota y valida la respuesta', async () => {
    const consumeQuota = vi.fn().mockResolvedValue({ allowed: true, retryAfterS: 0 });
    const data = week(e(1, 40, 400));
    const server = vi.fn<typeof fetch>(async (_url, init) => handleSharedAi(new Request('https://example.invalid/ai-routes', init), {
      enabled: true, allowedOrigins: [], authenticate: async () => 'user-1', consumeQuota,
      complete: async () => data, validateOutput: () => true,
    }));
    const planner = createSharedWorkoutPlanner(async () => 'jwt', server);
    expect(await planner.workouts(summary, { objetivo: input.objetivo, ocupados: [0], disponibles: [1, 2, 5], notas: 'Calle privada 7' })).toEqual(data);
    expect(JSON.parse(String(server.mock.calls[0][1]!.body))).toEqual(input);
    expect(consumeQuota).toHaveBeenCalledTimes(1);
  });
});
