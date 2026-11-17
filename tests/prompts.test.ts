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

  const system = (s: LevelSummary) => buildWorkoutMessages(s, { objetivo: null, ocupados: [], disponibles: [1], notas: '' })[0].content;

  it('sin FTP conocido, manda expresar la intensidad por sensación y pulso y no hablar de FTP ni de vatios', () => {
    const text = system(summary);
    expect(text).toMatch(/sensaci[oó]n/i);
    expect(text).toMatch(/puedes hablar/i);
    expect(text).toMatch(/nunca (menciones|uses)[^.]*FTP[^.]*vatios/i);
    expect(JSON.stringify(buildWorkoutMessages(summary, { objetivo: null, ocupados: [], disponibles: [1], notas: '' })[1])).not.toMatch(/ftp/i);
  });

  it('con FTP conocido, permite expresar la intensidad en % del FTP y no prohíbe los vatios', () => {
    const withFtp = { ...summary, ftpW: 240 };
    const text = system(withFtp);
    expect(text).toMatch(/ftpW/);
    expect(text).toMatch(/% del FTP/);
    expect(text).not.toMatch(/nunca (menciones|uses)[^.]*FTP/i);
    const user = JSON.parse(buildWorkoutMessages(withFtp, { objetivo: null, ocupados: [], disponibles: [1], notas: '' })[1].content);
    expect(user.resumen.ftpW).toBe(240);
  });

  it('un FTP null o ausente cuenta como desconocido', () => {
    expect(system({ ...summary, ftpW: null })).toMatch(/nunca (menciones|uses)[^.]*FTP/i);
  });

  it('las notas se tratan como preferencias que no cambian las reglas ni el esquema de salida', () => {
    const text = system(summary);
    expect(text).toMatch(/notas[^.]*preferencias/i);
    expect(text).toMatch(/ignora[^.]*instrucci/i);
    expect(text).toMatch(/esquema/);
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
