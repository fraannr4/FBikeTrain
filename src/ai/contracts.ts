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
