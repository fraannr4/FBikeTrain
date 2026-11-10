import type { Settings } from '../domain/types';
import { defaultChoice, type SpliceOption } from '../routes/splice';
import { formatKm, formatMeters, formatNumber } from '../ui/format';
import { chatJson, LlmError } from './llm';
import { buildSpliceMessages, type AiGoal, type SpliceFacts } from './prompts';
import { chatWithRetry } from './routePlanner';
import { spliceAdviceSchema, toStrictJsonSchema, type SpliceAdvice as AiAdvice } from './schema';
import type { SharedSpliceAdvisor } from './sharedClient';

/**
 * Qué opción de empalme se recomienda. La IA, si la hay, solo ve las cifras de cada opción y
 * devuelve una de ellas con una frase; sin IA, o si falla, decide el código.
 */

export type SpliceAdvice = {
  /** `id` de la `SpliceOption` recomendada. */
  id: string;
  motivo: string;
  source: 'ia' | 'codigo';
  /** Por qué no ha decidido la IA (límite, red, JSON no válido); `null` si no había IA o ha decidido ella. */
  aviso: string | null;
};

export type SpliceAdvisorDeps = {
  /** Clave propia de Ajustes; `null` o sin clave, no se usa. */
  personal: Settings['llm'] | null;
  shared?: SharedSpliceAdvisor;
  chat?: typeof chatJson;
  signal?: AbortSignal;
  /** Objetivo vigente del usuario (`aiGoal`), solo cifras; sin él, la IA decide por las cifras de las opciones. */
  objetivo?: AiGoal | null;
};

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Lo único que recibe la IA: cifras redondeadas con un id neutro (`c1`, `c2`...). */
export function spliceFacts(options: SpliceOption[]): SpliceFacts[] {
  return options.map((o, i) => ({
    id: `c${i + 1}`,
    distanciaKm: round1(o.distanceM / 1000),
    desnivelM: o.elevGainM === null ? null : Math.round(o.elevGainM),
    viasPrincipalesPct: round1(o.mainRoadPct),
    conectorKm: round1(o.connectorM / 1000),
    solapeKm: round1(o.overlapM / 1000),
    retrocesoKm: round1(o.backtrackM / 1000),
    alternativa: o.alternativeOf !== undefined,
  }));
}

function byCode(options: SpliceOption[], aviso: string | null): SpliceAdvice | null {
  const id = defaultChoice(options);
  const o = options.find(x => x.id === id);
  if (!o) return null;
  const desnivel = o.elevGainM === null ? 'desnivel sin datos de altitud' : `${formatMeters(Math.round(o.elevGainM))} de desnivel`;
  const vias = o.mainRoadPct === 0 ? 'sin vías principales' : `con un ${formatNumber(o.mainRoadPct, 1)} % de vías principales, el mínimo de las opciones`;
  return { id: o.id, source: 'codigo', aviso, motivo: `La más corta ${vias}: ${formatKm(o.distanceM, 1)} y ${desnivel}.` };
}

const fallbackNotice = (e: LlmError) => `La IA no ha podido recomendar: ${e.message} Te proponemos la elección por cifras.`;

export async function adviseSplice(options: SpliceOption[], deps: SpliceAdvisorDeps): Promise<SpliceAdvice | null> {
  if (options.length === 0) return null;
  const facts = spliceFacts(options);
  const ids = facts.map(f => f.id) as [string, ...string[]];
  const pick = (a: AiAdvice): SpliceAdvice => ({ id: options[ids.indexOf(a.recomendada)].id, motivo: a.motivo, source: 'ia', aviso: null });
  const personal = deps.personal?.apiKey.trim() && deps.personal.model.trim() ? deps.personal : null;
  const objetivo = deps.objetivo ?? null;

  async function viaPersonal(cfg: Settings['llm']): Promise<SpliceAdvice | null> {
    const schema = spliceAdviceSchema(ids);
    const out = await chatWithRetry(cfg, { messages: buildSpliceMessages(facts, objetivo), schemaName: 'empalme_rutas', jsonSchema: toStrictJsonSchema(schema), schema, signal: deps.signal }, deps.chat ?? chatJson);
    return out.ok ? pick(out.data) : byCode(options, fallbackNotice(out.error));
  }

  if (deps.shared) {
    try {
      return pick(await deps.shared.splice(facts, deps.signal, objetivo));
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      // Con el servicio caído se prueba la clave propia; con la cuota agotada, no: se enseña el límite.
      if (personal && (e.kind === 'network' || e.kind === 'unavailable')) return viaPersonal(personal);
      return byCode(options, fallbackNotice(e));
    }
  }
  return personal ? viaPersonal(personal) : byCode(options, null);
}
