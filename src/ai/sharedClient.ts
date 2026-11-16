import { ACCOUNT_PROJECT_URL, ACCOUNT_PUBLIC_KEY } from '../auth/config';
import type { LevelSummary } from './levelSummary';
import { LlmError } from './llm';
import type { WeekInput } from './prompts';
import { WorkoutWeekSchema, type WorkoutWeek } from './schema';

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
    if (!token) throw new LlmError('other', 'Inicia sesión para usar la IA compartida.');
    let response: Response;
    try {
      response = await fetchImpl(`${ACCOUNT_PROJECT_URL}/functions/v1/ai-routes`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: ACCOUNT_PUBLIC_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal,
      });
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      throw new LlmError('network', 'No se pudo conectar con el servicio común. Revisa la conexión y vuelve a probar.');
    }
    const payload = await response.json().catch(() => null) as { data?: unknown; retryAfterS?: unknown; error?: { code?: unknown } } | null;
    if (!response.ok) {
      if (response.status === 429) {
        const seconds = Number(payload?.retryAfterS ?? response.headers.get('retry-after'));
        throw new LlmError('rate_limit', 'El servicio gratuito ha alcanzado su límite. Espera antes de volver a buscar.', Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60);
      }
      if (response.status === 503) throw new LlmError('unavailable', 'El servicio común todavía no está disponible. Prueba más tarde o usa tu clave en Ajustes.');
      // El servicio ya ha validado la salida con zod: se trata como JSON no válido para que quien llama pueda reintentar una vez.
      if (response.status === 502 && payload?.error?.code === 'invalid_response') throw new LlmError('invalid_json', 'La IA no ha devuelto un resultado válido.');
      throw new LlmError('other', response.status === 401 ? 'Tu sesión ha caducado. Vuelve a iniciar sesión.' : 'El servicio común no ha podido completar la petición. Vuelve a probar.');
    }
    return payload?.data;
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
