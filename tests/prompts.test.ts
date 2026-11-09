import type { LevelSummary } from '../src/ai/levelSummary';
import { buildExplainMessages, buildPlanMessages, type Answers, type RouteFacts } from '../src/ai/prompts';

const summary: LevelSummary = {
  fuente: 'historial',
  semanas: 8,
  salidas: 12,
  salidasPorSemana: 1.5,
  distanciaMediaKm: 48.2,
  desnivelMedioM: 520,
  tiempoMedioMin: 118,
  velocidadMediaKmh: 24.6,
  distanciaMaxKm: 92.4,
  desnivelMaxM: 1450,
  vamMediaMh: 780,
  subidaMasLarga: { km: 7.2, pendienteMediaPct: 5.4 },
};

const answers: Answers = { focus: 'subidas', minutes: 150, explore: 'descubrir', notes: 'Sin prisa.' };

const facts: RouteFacts[] = [
  {
    id: 'r1',
    titulo: 'Subidas cortas',
    distanciaKm: 52.3,
    desnivelM: 590,
    tiempoEstimadoMin: 128,
    carreteraNuevaPct: 64,
    dificultad: 'Media',
    sobreReferenciaPct: 13.5,
    dimension: 'desnivel',
    pendienteMaxima: '8-11 %',
    limitadoPorTiempo: false,
  },
];

const userJson = (msgs: { role: string; content: string }[]) =>
  JSON.parse(msgs.find((m) => m.role === 'user')!.content);
const systemText = (msgs: { role: string; content: string }[]) =>
  msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n');

describe('buildPlanMessages', () => {
  it('plan messages carry summary, answers and max distance as json', () => {
    const msgs = buildPlanMessages(summary, answers, 61.5);
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user']);
    const body = userJson(msgs);
    expect(body.resumen).toEqual(summary);
    expect(body.respuestas).toEqual(answers);
    expect(body.maxDistanciaKm).toBe(61.5);
  });

  it('system prompt fixes the rules', () => {
    const sys = systemText(buildPlanMessages(summary, answers, 61.5));
    expect(sys).toContain('entre un 5 y un 15 %');
    expect(sys).toContain('de 3 a 5 opciones');
    expect(sys).toContain('Responde solo con JSON');
    expect(sys).toContain('No trazas rutas');
  });

  it('notes are truncated to 200 chars', () => {
    const body = userJson(buildPlanMessages(summary, { ...answers, notes: 'x'.repeat(300) }, 60));
    expect(body.respuestas.notes).toHaveLength(200);
  });

  it('only the known answer fields reach the ai', () => {
    const leaky = { ...answers, start: { lat: 41.39, lng: 2.17 } } as Answers;
    const body = userJson(buildPlanMessages(summary, leaky, 60));
    expect(Object.keys(body.respuestas).sort()).toEqual(['explore', 'focus', 'minutes', 'notes']);
  });
});

describe('buildExplainMessages', () => {
  it('explain prompt asks to cite figures', () => {
    const msgs = buildExplainMessages(summary, facts);
    expect(systemText(msgs)).toContain('cita al menos la distancia y el desnivel de cada ruta');
    expect(systemText(msgs)).toContain('Responde solo con JSON');
    const body = userJson(msgs);
    expect(body.rutas).toEqual(facts);
    expect(body.resumen).toEqual(summary);
  });
});
