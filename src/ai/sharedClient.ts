import { ACCOUNT_PROJECT_URL, ACCOUNT_PUBLIC_KEY } from '../auth/config';
import type { LevelSummary } from './levelSummary';
import { LlmError } from './llm';
import type { Answers, RouteFacts } from './prompts';
import { RoutePlanSchema, ExplanationSchema } from './schema';
import type { SharedAiPlanner } from './routePlanner';

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

export function createSharedAiPlanner(getToken: () => Promise<string | null>, fetchImpl: typeof fetch = fetch): SharedAiPlanner {
  async function request(body: object, signal?: AbortSignal): Promise<unknown> {
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
    const payload = await response.json().catch(() => null) as { data?: unknown; retryAfterS?: unknown } | null;
    if (!response.ok) {
      if (response.status === 429) {
        const seconds = Number(payload?.retryAfterS ?? response.headers.get('retry-after'));
        throw new LlmError('rate_limit', 'El servicio gratuito ha alcanzado su límite. Espera antes de volver a buscar.', Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60);
      }
      throw new LlmError('other', response.status === 401 ? 'Tu sesión ha caducado. Vuelve a iniciar sesión.' : 'El servicio común todavía no está disponible. Puedes preparar la ruta manualmente.');
    }
    return payload?.data;
  }
  return {
    plan: async (summary: LevelSummary, answers: Answers, maxDistanciaKm: number, signal?: AbortSignal) => {
      const data = await request({ operation: 'plan', summary: numericSummary(summary), answers: { focus: answers.focus, minutes: answers.minutes, explore: answers.explore, notes: '' }, maxDistanciaKm }, signal);
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
