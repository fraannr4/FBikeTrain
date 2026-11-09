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
/** Cifras de una opción de empalme: lo único que ve la IA de él. Nunca coordenadas ni nombres. */
export type SpliceFacts = {
  id: string;
  distanciaKm: number;
  desnivelM: number | null;
  viasPrincipalesPct: number;
  conectorKm: number;
  solapeKm: number;
  retrocesoKm: number;
  /** Variante parecida de la opción anterior. */
  alternativa: boolean;
};
/** Ruta conocida cerca del inicio, tal como la ve la IA: sin enlace, autor ni geometría. */
export type AiReference = {
  id: string;
  nombre: string;
  fuente: 'wikiloc' | 'osm';
  distanciaKm: number;
  desnivelM: number | null;
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
/** Objetivo con fecha más próximo, tal como lo ve la IA: sin nombre ni lugar. */
export type WeekGoal = { diasHasta: number; distanciaKm: number | null; desnivelM: number | null };
/** Lo que se pide para proponer la semana. Los días son índices desde hoy (0 hoy, 6 dentro de 6 días). */
export type WeekInput = { objetivo: WeekGoal | null; ocupados: number[]; disponibles: number[]; notas: string };
