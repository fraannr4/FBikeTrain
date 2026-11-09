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
export type Focus = 'fondo' | 'subidas' | 'mixto';
export type Answers = { focus: Focus; minutes: number; explore: 'repetir' | 'descubrir'; notes: string };
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type RouteFacts = {
  id: string;
  titulo: string;
  distanciaKm: number;
  desnivelM: number;
  tiempoEstimadoMin: number | null;
  carreteraNuevaPct: number;
  dificultad: 'Suave' | 'Media' | 'Dura' | null;
  sobreReferenciaPct: number;
  dimension: 'distancia' | 'desnivel';
  pendienteMaxima: string;
  limitadoPorTiempo: boolean;
};
