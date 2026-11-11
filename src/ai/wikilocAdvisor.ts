import type { Settings } from '../domain/types';
import { ADMIT_MAX_PCT, type RankedWikiloc, type RankTarget, type WikilocCard } from '../routes/wikilocNearby';
import { abortError } from './abort';
import type { AiReference, Answers, LevelSummary } from './contracts';
import { chatJson, LlmError } from './llm';
import { MAX_AI_REFERENCES } from './references';
import { planWithRetry, type SharedAiPlanner } from './routePlanner';
import type { RoutePlan } from './schema';

/**
 * Recomendación de la IA entre las rutas de Wikiloc recibidas, con la operación `plan` existente.
 * A la IA le llegan solo nombre, fuente, km y desnivel de las mejores según el orden local; nunca
 * enlaces, autores, ids de Wikiloc ni coordenadas. Elige con `referenciaId` y da un motivo por ruta.
 * Si no hay IA, falla o no elige ninguna, se queda el orden local y se dice por qué.
 */

/** Recomendaciones como mucho y rutas mínimas para que elegir tenga sentido. */
const MAX_PICKS = 5;
const MIN_CANDIDATES = 3;
/** Tope de `maxDistanciaKm` del plan (`RoutePlanSchema` y servicio común). */
const PLAN_MAX_KM = 200;
/** Supuesto: sin velocidad media en el nivel, se estima el tiempo a 25 km/h. */
const FALLBACK_KMH = 25;
const MAX_NAME = 80;

export type WikilocPick = { card: WikilocCard; motivo: string };
export type WikilocAdvice = { kind: 'ai'; picks: WikilocPick[] } | { kind: 'local'; reason: string };

const round1 = (x: number) => Math.round(x * 10) / 10;
const LOCAL = 'Se queda el orden local.';

/** Las respuestas que espera `plan`: enfoque por lo pedido, tiempo estimado a la velocidad media y descubrir. */
function answersFor(target: RankTarget, summary: LevelSummary): Answers {
  const kmh = summary.velocidadMediaKmh > 0 ? summary.velocidadMediaKmh : FALLBACK_KMH;
  const minutes = Math.min(1440, Math.max(10, Math.round((target.distanceKm / kmh) * 60)));
  return { focus: target.elevGainM === undefined ? 'fondo' : 'mixto', minutes, explore: 'descubrir', notes: '' };
}

export async function recommendWikiloc(
  input: { ranked: RankedWikiloc[]; target: RankTarget; summary: LevelSummary | null },
  deps: { llm: Settings['llm']; shared?: SharedAiPlanner; chat?: typeof chatJson; signal?: AbortSignal },
): Promise<WikilocAdvice> {
  const { ranked, target, summary } = input;
  const { signal } = deps;
  if (signal?.aborted) throw abortError();
  if (ranked.length < MIN_CANDIDATES) return { kind: 'local', reason: 'Con menos de 3 rutas que encajan, basta el orden local.' };
  const personal = deps.llm.apiKey.trim() !== '' && deps.llm.model.trim() !== '';
  if (!deps.shared && !personal) return { kind: 'local', reason: 'Sin IA configurada, el orden es el local: primero las que más se acercan a lo que pides.' };
  if (!summary) return { kind: 'local', reason: `La IA necesita tu nivel: importa salidas o responde las preguntas iniciales de Rutas con IA. ${LOCAL}` };

  const byId = new Map<string, WikilocCard>();
  const referencias: AiReference[] = ranked.slice(0, MAX_AI_REFERENCES).map(({ card }, i) => {
    const id = `ref${i + 1}`;
    byId.set(id, card);
    return {
      id, nombre: card.nombre.trim().slice(0, MAX_NAME), fuente: 'wikiloc', distanciaKm: round1(card.km),
      desnivelM: card.desnivelM === null ? null : Math.round(card.desnivelM),
    };
  });
  const level: LevelSummary = summary;
  const answers = answersFor(target, level);
  const maxKm = Math.min(PLAN_MAX_KM, round1((target.distanceKm * ADMIT_MAX_PCT) / 100));
  const chat = deps.chat ?? chatJson;

  let plan: RoutePlan;
  try {
    plan = await askPlan();
  } catch (e) {
    if (signal?.aborted) throw abortError();
    if (!(e instanceof LlmError)) throw e;
    return { kind: 'local', reason: e.kind === 'invalid_json' ? `La IA no ha devuelto una recomendación válida. ${LOCAL}` : `${e.message} ${LOCAL}` };
  }
  if (signal?.aborted) throw abortError();

  const picks: WikilocPick[] = [];
  for (const o of plan.opciones) {
    const card = o.referenciaId ? byId.get(o.referenciaId) : undefined;
    if (!card || picks.some(p => p.card.id === card.id)) continue;
    picks.push({ card, motivo: o.motivo });
    if (picks.length === MAX_PICKS) break;
  }
  return picks.length ? { kind: 'ai', picks } : { kind: 'local', reason: `La IA no ha elegido ninguna de las rutas recibidas. ${LOCAL}` };

  /** Servicio común primero; caído o sin red, la clave personal si la hay. Con 429, no. */
  async function askPlan(): Promise<RoutePlan> {
    const viaPersonal = async () => {
      const out = await planWithRetry(deps.llm, level, answers, maxKm, chat, signal, referencias);
      if (!out.ok) throw out.error;
      return out.plan;
    };
    if (!deps.shared) return viaPersonal();
    try {
      return await deps.shared.plan(level, answers, maxKm, signal, referencias);
    } catch (e) {
      if (personal && e instanceof LlmError && (e.kind === 'network' || e.kind === 'unavailable')) return viaPersonal();
      throw e;
    }
  }
}
