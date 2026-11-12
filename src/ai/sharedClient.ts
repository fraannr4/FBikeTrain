import { ACCOUNT_PROJECT_URL, ACCOUNT_PUBLIC_KEY } from '../auth/config';
import type { LevelSummary } from './levelSummary';
import { LlmError } from './llm';
import { goalFields, referenceFields, waypointFields, waypointGoalFields, type AiGoal, type AiReference, type Answers, type RouteFacts, type SpliceFacts, type WeekInput } from './prompts';
import { RoutePlanSchema, ExplanationSchema, spliceAdviceSchema, WaypointCombosSchema, WorkoutWeekSchema, type SpliceAdvice, type WorkoutWeek } from './schema';
import type { SharedWaypointPlanner } from './waypointCombos';
import type { SharedAiPlanner } from './routePlanner';
import type { AiPass } from './contracts';

/** Activar solo cuando función y cuota estén desplegadas y verificadas. No habilita un plan de pago. */
export const SHARED_AI_ENABLED = import.meta.env.VITE_SHARED_AI_ENABLED === 'true';

function numericSummary(s: LevelSummary): LevelSummary {
  return {
    fuente: s.fuente, semanas: s.semanas, salidas: s.salidas, salidasPorSemana: s.salidasPorSemana,
    distanciaMediaKm: s.distanciaMediaKm, desnivelMedioM: s.desnivelMedioM, tiempoMedioMin: s.tiempoMedioMin,
    velocidadMediaKmh: s.velocidadMediaKmh, distanciaMaxKm: s.distanciaMaxKm, desnivelMaxM: s.desnivelMaxM,
    vamMediaMh: s.vamMediaMh, subidaMasLarga: s.subidaMasLarga ? { km: s.subidaMasLarga.km, pendienteMediaPct: s.subidaMasLarga.pendienteMediaPct } : null,
  };
}

/** Llamada a la función `ai-routes` con la sesión; traduce los errores a `LlmError`. */
function sharedRequest(getToken: () => Promise<string | null>, fetchImpl: typeof fetch) {
  return async function request(body: object, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    const token = await getToken();
    if (!token) throw new LlmError('other', 'Inicia sesión para usar el servicio de rutas con IA.');
    let response: Response;
    try {
      response = await fetchImpl(`${ACCOUNT_PROJECT_URL}/functions/v1/ai-routes`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: ACCOUNT_PUBLIC_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal,
      });
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      throw new LlmError('network', 'No se pudo conectar con el servicio común. Puedes ajustar la ruta manualmente.');
    }
    const payload = await response.json().catch(() => null) as { data?: unknown; retryAfterS?: unknown; error?: { code?: unknown } } | null;
    if (!response.ok) {
      if (response.status === 429) {
        const seconds = Number(payload?.retryAfterS ?? response.headers.get('retry-after'));
        throw new LlmError('rate_limit', 'El servicio gratuito ha alcanzado su límite. Espera antes de volver a buscar.', Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60);
      }
      if (response.status === 503) throw new LlmError('unavailable', 'El servicio común todavía no está disponible. Puedes preparar la ruta manualmente.');
      // El servicio ya ha validado la salida con zod: se trata como JSON no válido para que quien llama pueda reintentar una vez.
      if (response.status === 502 && payload?.error?.code === 'invalid_response') throw new LlmError('invalid_json', 'La IA no ha devuelto un resultado válido.');
      throw new LlmError('other', response.status === 401 ? 'Tu sesión ha caducado. Vuelve a iniciar sesión.' : 'El servicio común no ha podido completar la búsqueda. Puedes preparar la ruta manualmente.');
    }
    return payload?.data;
  };
}

export function createSharedAiPlanner(getToken: () => Promise<string | null>, fetchImpl: typeof fetch = fetch): SharedAiPlanner {
  const request = sharedRequest(getToken, fetchImpl);
  return {
    plan: async (summary: LevelSummary, answers: Answers, maxDistanciaKm: number, signal?: AbortSignal, referencias: AiReference[] = [], objetivo: AiGoal | null = null, puertos: AiPass[] = []) => {
      const refs = referenceFields(referencias);
      const data = await request({
        operation: 'plan', summary: numericSummary(summary), answers: { focus: answers.focus, minutes: answers.minutes, explore: answers.explore, notes: '' }, maxDistanciaKm,
        ...(refs.length ? { referencias: refs } : {}), ...(objetivo ? { objetivo: goalFields(objetivo) } : {}),
        ...(puertos.length ? { puertos: puertos.map(p => ({ id: p.id, nombre: p.nombre, cotaM: p.cotaM, distanciaKm: p.distanciaKm })) } : {}),
      }, signal);
      const parsed = RoutePlanSchema.safeParse(data);
      if (!parsed.success) throw new LlmError('other', 'El servicio no ha devuelto objetivos válidos. Ajusta la ruta manualmente.');
      return parsed.data;
    },
    explain: async (summary: LevelSummary, facts: RouteFacts[], signal?: AbortSignal) => {
      const safeFacts = facts.map((f, i) => ({ id: f.id, titulo: `Ruta ${i + 1}`, distanciaKm: f.distanciaKm, desnivelM: f.desnivelM, tiempoEstimadoMin: f.tiempoEstimadoMin, carreteraNuevaPct: f.carreteraNuevaPct, dificultad: f.dificultad, sobreReferenciaPct: f.sobreReferenciaPct, dimension: f.dimension, pendienteMaxima: f.pendienteMaxima, limitadoPorTiempo: f.limitadoPorTiempo }));
      const data = await request({ operation: 'explain', summary: numericSummary(summary), facts: safeFacts }, signal);
      const parsed = ExplanationSchema.safeParse(data);
      if (!parsed.success) throw new LlmError('other', 'El servicio no ha devuelto explicaciones válidas.');
      return parsed.data;
    },
  };
}

export type SharedSpliceAdvisor = { splice: (facts: SpliceFacts[], signal?: AbortSignal, objetivo?: AiGoal | null) => Promise<SpliceAdvice> };

/** Recomendación de empalme por el servicio común: solo cifras de cada opción y del objetivo. */
export function createSharedSpliceAdvisor(getToken: () => Promise<string | null>, fetchImpl: typeof fetch = fetch): SharedSpliceAdvisor {
  const request = sharedRequest(getToken, fetchImpl);
  return {
    splice: async (facts, signal, objetivo = null) => {
      const data = await request({ operation: 'splice', facts, ...(objetivo ? { objetivo: goalFields(objetivo) } : {}) }, signal);
      const parsed = spliceAdviceSchema(facts.map(f => f.id) as [string, ...string[]]).safeParse(data);
      if (!parsed.success) throw new LlmError('invalid_json', 'El servicio no ha devuelto una recomendación válida.');
      return parsed.data;
    },
  };
}

export type SharedWorkoutPlanner = { workouts: (summary: LevelSummary, input: WeekInput, signal?: AbortSignal) => Promise<WorkoutWeek> };

/** Entrenos de la semana por el servicio común: cifras y días; las notas libres no se envían. */
export function createSharedWorkoutPlanner(getToken: () => Promise<string | null>, fetchImpl: typeof fetch = fetch): SharedWorkoutPlanner {
  const request = sharedRequest(getToken, fetchImpl);
  return {
    workouts: async (summary, input, signal) => {
      const o = input.objetivo;
      const objetivo = o ? { diasHasta: o.diasHasta, distanciaKm: o.distanciaKm, desnivelM: o.desnivelM } : null;
      const data = await request({ operation: 'workouts', summary: numericSummary(summary), objetivo, ocupados: input.ocupados, disponibles: input.disponibles, notas: '' }, signal);
      const parsed = WorkoutWeekSchema.safeParse(data);
      if (!parsed.success) throw new LlmError('invalid_json', 'El servicio no ha devuelto entrenos válidos.');
      return parsed.data;
    },
  };
}

/** Combinaciones de puntos de paso por el servicio común: solo el objetivo y los puntos con nombre y cifras. */
export function createSharedWaypointPlanner(getToken: () => Promise<string | null>, fetchImpl: typeof fetch = fetch): SharedWaypointPlanner {
  const request = sharedRequest(getToken, fetchImpl);
  return {
    combine: async (objetivo, puntos, signal) => {
      const data = await request({ operation: 'waypoints', objetivo: waypointGoalFields(objetivo), puntos: waypointFields(puntos) }, signal);
      const parsed = WaypointCombosSchema.safeParse(data);
      if (!parsed.success) throw new LlmError('invalid_json', 'El servicio no ha devuelto combinaciones válidas.');
      return parsed.data;
    },
  };
}
