/** Contratos de IA sin dependencias del navegador, compartidos con el runtime Edge. */
export type LevelSummary = {
  fuente: 'historial' | 'declarado';
  semanas: number | null;
  salidas: number;
  salidasPorSemana: number;
  distanciaMediaKm: number;
  desnivelMedioM: number;
  tiempoMedioMin: number;
  velocidadMediaKmh: number;
  distanciaMaxKm: number;
  desnivelMaxM: number;
  vamMediaMh: number | null;
  subidaMasLarga: { km: number; pendienteMediaPct: number } | null;
};
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
/** Objetivo con fecha más próximo, tal como lo ve la IA: sin nombre ni lugar. */
export type WeekGoal = { diasHasta: number; distanciaKm: number | null; desnivelM: number | null };
/** Lo que se pide para proponer la semana. Los días son índices desde hoy (0 hoy, 6 dentro de 6 días). */
export type WeekInput = { objetivo: WeekGoal | null; ocupados: number[]; disponibles: number[]; notas: string };
