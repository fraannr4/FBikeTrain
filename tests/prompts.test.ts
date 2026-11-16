import type { LevelSummary } from '../src/ai/levelSummary';
import * as prompts from '../src/ai/prompts';
import { buildWorkoutMessages, type WeekInput } from '../src/ai/prompts';

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

describe('prompts de la IA', () => {
  it('solo queda el de la semana con IA: la IA ya no interviene en las rutas', () => {
    expect(Object.keys(prompts).sort()).toEqual(['buildWorkoutMessages']);
    const system = buildWorkoutMessages(summary, { objetivo: null, ocupados: [], disponibles: [1], notas: '' })[0].content;
    expect(system).not.toMatch(/OpenRouteService|\breferencias\b|\bpuertos\b|\brutas\b/);
  });

  it('a la IA solo le llegan los campos conocidos, aunque la entrada traiga más', () => {
    const input = {
      objetivo: { diasHasta: 3, distanciaKm: 80, desnivelM: null, titulo: 'Marcha', lugar: { lat: 41, lng: 2 } },
      ocupados: [0], disponibles: [2, 4], notas: 'Sin prisa.', casa: { lat: 41.6, lng: 2.1 },
    } as unknown as WeekInput;
    const user = JSON.parse(buildWorkoutMessages(summary, input)[1].content);
    expect(user).toEqual({ resumen: summary, objetivo: { diasHasta: 3, distanciaKm: 80, desnivelM: null }, diasOcupados: [0], diasDisponibles: [2, 4], notas: 'Sin prisa.' });
  });
});
