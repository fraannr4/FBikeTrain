import type { LatLng, Settings } from '../domain/types';
import { upliftPct, type UserReference } from '../metrics/reference';
import type { Target } from '../metrics/score';
import { generateRoutes, type GeneratedRoute } from '../routes/generator';
import { OrsError } from '../routes/ors';
import { formatDeltaPct, formatKm, formatMeters } from '../ui/format';
import { abortError } from './abort';
import type { LevelSummary } from './levelSummary';
import { chatJson, LlmError, type LlmErrorKind } from './llm';
import { buildExplainMessages, buildPlanMessages, type Answers, type ChatMessage, type RouteFacts } from './prompts';
import { ExplanationSchema, RoutePlanSchema, toStrictJsonSchema, type RoutePlan } from './schema';

/**
 * Planificador de rutas con IA. La IA convierte las respuestas en objetivos y explica las rutas;
 * el código recorta los objetivos, pide las carreteras a ORS y calcula todas las cifras.
 * A la IA solo le llegan el resumen del nivel, las respuestas y las cifras de cada ruta.
 */

/** Objetivo entre un 5 y un 15 % por encima de la referencia, en la dimensión elegida. */
export const MIN_UPLIFT = 1.05;
export const MAX_UPLIFT = 1.15;
/** Objetivo del formulario de respaldo: un 10 % por encima. */
const SUGGESTED_UPLIFT = 1.1;
/** Tope de `distanciaKm` en `RoutePlanSchema`, para cuando no hay velocidad con la que limitar. */
const PLAN_MAX_KM = 200;
/** Una búsqueda de ORS por opción: 1 ruta de 3 semillas. De 3 a 5 opciones dan como mucho 15 peticiones. */
const ORS_COUNT = 1;
const ORS_SEEDS = 3;

const FALLBACK_INVALID = 'La IA no ha devuelto un plan válido. Ajusta la ruta a mano.';

type Dimension = 'distancia' | 'desnivel';

export type PlannedTarget = {
  titulo: string;
  dimension: Dimension;
  target: Target;
  upliftPct: number;
  limitadoPorTiempo: boolean;
};

export type AiRoute = GeneratedRoute & {
  titulo: string;
  explicacion: string;
  upliftPct: number;
  dimension: Dimension;
  /** La distancia la ha recortado el tiempo disponible. */
  limitadoPorTiempo: boolean;
};

export type AiRoutesResult =
  | { kind: 'routes'; routes: AiRoute[]; warnings: string[] }
  | { kind: 'fallback'; message: string; cause: LlmErrorKind; suggested: Target };

type ChatRequest<T> = Parameters<typeof chatJson<T>>[1];
type Outcome<T> = { ok: true; data: T } | { ok: false; error: LlmError };

export type SharedAiPlanner = {
  plan: (summary: LevelSummary, answers: Answers, maxDistanciaKm: number, signal?: AbortSignal) => Promise<RoutePlan>;
  explain: (summary: LevelSummary, facts: RouteFacts[], signal?: AbortSignal) => Promise<{ explicaciones: { id: string; texto: string }[] }>;
};

/**
 * Llama a la IA y, si el JSON no es válido, repite una vez con la respuesta anterior y el error.
 * Los demás errores (clave, límite, red) no se repiten.
 */
async function chatWithRetry<T>(
  cfg: Settings['llm'],
  req: ChatRequest<T>,
  chat: typeof chatJson,
): Promise<Outcome<T>> {
  let messages = req.messages;
  for (let attempt = 0; ; attempt++) {
    try {
      return { ok: true, data: await chat(cfg, { ...req, messages }) };
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      if (e.kind !== 'invalid_json' || attempt > 0) return { ok: false, error: e };
      const retry: ChatMessage[] = e.raw ? [{ role: 'assistant', content: e.raw }] : [];
      retry.push({ role: 'user', content: `Tu respuesta no cumple el formato: ${e.message}` });
      messages = [...messages, ...retry];
    }
  }
}

export async function planWithRetry(
  cfg: Settings['llm'],
  summary: LevelSummary,
  answers: Answers,
  maxDistanciaKm: number,
  chat: typeof chatJson = chatJson,
  signal?: AbortSignal,
): Promise<{ ok: true; plan: RoutePlan } | { ok: false; error: LlmError }> {
  const out = await chatWithRetry(
    cfg,
    {
      messages: buildPlanMessages(summary, answers, maxDistanciaKm),
      schemaName: 'plan_rutas',
      jsonSchema: toStrictJsonSchema(RoutePlanSchema),
      schema: RoutePlanSchema,
      signal,
    },
    chat,
  );
  return out.ok ? { ok: true, plan: out.data } : out;
}

/** Distancia que cabe en el tiempo disponible a la velocidad media; `Infinity` si no hay con qué calcularla. */
function timeCapM(ref: UserReference, answers: Answers): number {
  const cap = answers.minutes * 60 * ref.avgSpeedMs;
  return cap > 0 ? cap : Infinity;
}

const clamp = (x: number, avg: number) => Math.min(Math.max(x, avg * MIN_UPLIFT), avg * MAX_UPLIFT);

function plannedTarget(
  titulo: string,
  dimension: Dimension,
  wantedM: number,
  elevGainM: number | null,
  ref: UserReference,
  answers: Answers,
): PlannedTarget {
  const cap = timeCapM(ref, answers);
  const distanceM = Math.round(Math.min(wantedM, cap));
  const dim = dimension === 'distancia' ? 'distance' : 'elevation';
  // En distancia, el tiempo limita si no deja llegar al 5 %; en desnivel, si acorta la distancia pedida.
  const neededM = dimension === 'distancia' ? ref.avgDistanceM * MIN_UPLIFT : wantedM;
  return {
    titulo,
    dimension,
    target: { distanceM, elevGainM, preferNew: answers.explore === 'descubrir' },
    upliftPct: upliftPct({ distanceM, elevGainM: elevGainM ?? 0 }, ref, dim),
    limitadoPorTiempo: cap < neededM,
  };
}

/**
 * Objetivos de cada opción: en su dimensión, el valor se recorta al 5-15 % sobre la media; después,
 * la distancia se limita al tiempo disponible, que manda sobre el 5 %.
 */
export function targetsFromPlan(plan: RoutePlan, ref: UserReference, answers: Answers): PlannedTarget[] {
  return plan.opciones.map((o) => {
    if (o.dimension === 'distancia') {
      return plannedTarget(o.titulo, o.dimension, clamp(o.distanciaKm * 1000, ref.avgDistanceM), o.desnivelM, ref, answers);
    }
    const wantedGain = o.desnivelM ?? ref.avgElevGainM * (1 + o.subidaPct / 100);
    const elevGainM = Math.round(clamp(wantedGain, ref.avgElevGainM));
    return plannedTarget(o.titulo, o.dimension, o.distanciaKm * 1000, elevGainM, ref, answers);
  });
}

/**
 * Objetivo del formulario manual cuando falla la IA: un 10 % por encima en la dimensión del foco
 * (en «mixto», en las dos) y la distancia limitada por el tiempo.
 */
export function suggestedTarget(ref: UserReference, answers: Answers): Target {
  const moreDistance = answers.focus !== 'subidas';
  const moreGain = answers.focus !== 'fondo';
  const wantedM = ref.avgDistanceM * (moreDistance ? SUGGESTED_UPLIFT : 1);
  return {
    distanceM: Math.round(Math.min(wantedM, timeCapM(ref, answers))),
    elevGainM: moreGain ? Math.round(ref.avgElevGainM * SUGGESTED_UPLIFT) : null,
    preferNew: answers.explore === 'descubrir',
  };
}

/** `figure` aparece como número suelto: no vale «162 km» por «62 km» ni «850 min» por «850 m». */
function containsFigure(texto: string, figure: string): boolean {
  let from = 0;
  for (let i = texto.indexOf(figure); i >= 0; i = texto.indexOf(figure, from)) {
    const before = texto[i - 1] ?? '';
    const after = texto[i + figure.length] ?? '';
    if (!/[\d.,]/.test(before) && !/\p{L}/u.test(after)) return true;
    from = i + 1;
  }
  return false;
}

/** El texto cita la distancia o el desnivel de la ruta tal como los escribe `src/ui/format.ts`. */
export function citesFigures(texto: string, f: RouteFacts): boolean {
  const m = f.distanciaKm * 1000;
  return [formatKm(m), formatKm(m, 1), formatMeters(f.desnivelM)].some((fig) => containsFigure(texto, fig));
}

/** Explicación que escribe el código cuando la de la IA falta, falla o no cita las cifras. */
export function templateExplanation(f: RouteFacts): string {
  const m = f.distanciaKm * 1000;
  const km = Number.isInteger(f.distanciaKm) ? formatKm(m) : formatKm(m, 1);
  const parts = [
    `${km} y ${formatMeters(f.desnivelM)} de desnivel, ${formatDeltaPct(f.sobreReferenciaPct)} de ${f.dimension} sobre tu referencia.`,
  ];
  if (f.dificultad) parts.push(`Dificultad ${f.dificultad.toLowerCase()}.`);
  parts.push(`${f.carreteraNuevaPct} % de carretera nueva; pendiente máxima ${f.pendienteMaxima}.`);
  if (f.limitadoPorTiempo) parts.push('Distancia limitada por tu tiempo disponible.');
  return parts.join(' ');
}

/** Clases de pendiente de ORS (`steepness`, de 0 a 5) en palabras. */
function steepnessLabel(cls: number): string {
  if (cls >= 5) return 'del 16 % o más';
  return ['de menos del 1 %', 'del 1 al 4 %', 'del 4 al 7 %', 'del 7 al 10 %', 'del 10 al 16 %'][Math.max(0, cls)];
}

const round1 = (x: number) => Math.round(x * 10) / 10;

type Found = { route: GeneratedRoute; planned: PlannedTarget; uplift: number };

/** Cifras de cada ruta para la IA: sin coordenadas ni ids de ORS; el id es su posición. */
function toFacts(found: Found[]): RouteFacts[] {
  return found.map(({ route, planned, uplift }, i) => ({
    id: `r${i + 1}`,
    titulo: planned.titulo,
    distanciaKm: round1(route.distanceM / 1000),
    desnivelM: Math.round(route.elevGainM),
    tiempoEstimadoMin: route.estTimeS === null ? null : Math.round(route.estTimeS / 60),
    carreteraNuevaPct: Math.round(route.newPct),
    dificultad: route.difficulty,
    sobreReferenciaPct: Math.round(uplift),
    dimension: planned.dimension,
    pendienteMaxima: steepnessLabel(route.maxSteepCls),
    limitadoPorTiempo: planned.limitadoPorTiempo,
  }));
}

export async function runAiRoutes(
  input: { start: LatLng; answers: Answers; reference: UserReference; summary: LevelSummary },
  deps: {
    llm: Settings['llm'];
    orsKey: string;
    visited: ReadonlySet<string>;
    chat?: typeof chatJson;
    generate?: typeof generateRoutes;
    signal?: AbortSignal;
    shared?: SharedAiPlanner;
  },
): Promise<AiRoutesResult> {
  const { start, answers, reference: ref, summary } = input;
  const chat = deps.chat ?? chatJson;
  const generate = deps.generate ?? generateRoutes;

  const cap = timeCapM(ref, answers);
  const maxKm = Number.isFinite(cap) ? round1(Math.min(cap / 1000, PLAN_MAX_KM)) : PLAN_MAX_KM;
  const { signal } = deps;
  let planned: Awaited<ReturnType<typeof planWithRetry>>;
  if (deps.shared) {
    try { planned = { ok: true, plan: await deps.shared.plan(summary, answers, maxKm, signal) }; }
    catch (error) { if (!(error instanceof LlmError)) throw error; planned = { ok: false, error }; }
  } else planned = await planWithRetry(deps.llm, summary, answers, maxKm, chat, signal);
  if (!planned.ok) {
    const message = planned.error.kind === 'invalid_json' ? FALLBACK_INVALID : planned.error.message;
    return { kind: 'fallback', message, cause: planned.error.kind, suggested: suggestedTarget(ref, answers) };
  }

  // Una opción detrás de otra, nunca en paralelo, por la cuota por minuto de ORS.
  const found: Found[] = [];
  const warnings: string[] = [];
  for (const p of targetsFromPlan(planned.plan, ref, answers)) {
    if (signal?.aborted) throw abortError();
    let res;
    try {
      res = await generate(
        { start, target: p.target, count: ORS_COUNT, seeds: ORS_SEEDS },
        { apiKey: deps.orsKey, reference: ref, visited: deps.visited, signal },
      );
    } catch (e) {
      if (!(e instanceof OrsError) || found.length === 0) throw e;
      warnings.push(e.message);
      break;
    }
    const [route] = res.routes;
    if (route) {
      const dim = p.dimension === 'distancia' ? 'distance' : 'elevation';
      found.push({ route, planned: p, uplift: upliftPct(route, ref, dim) });
    } else if (!res.stoppedBy) {
      warnings.push(`No hay ruta de asfalto para "${p.titulo}".`);
    }
    if (res.stoppedBy) {
      warnings.push(res.stoppedBy.message);
      break;
    }
  }

  if (signal?.aborted) throw abortError();
  const facts = toFacts(found);
  const texts = new Map<string, string>();
  if (facts.length > 0) {
    const out = deps.shared ? await (async (): Promise<Outcome<{ explicaciones: { id: string; texto: string }[] }>> => {
      try { return { ok: true, data: await deps.shared!.explain(summary, facts, signal) }; }
      catch (error) { if (!(error instanceof LlmError)) throw error; return { ok: false, error }; }
    })() : await chatWithRetry(
      deps.llm,
      {
        messages: buildExplainMessages(summary, facts),
        schemaName: 'explicacion_rutas',
        jsonSchema: toStrictJsonSchema(ExplanationSchema),
        schema: ExplanationSchema,
        signal,
      },
      chat,
    );
    if (out.ok) for (const e of out.data.explicaciones) texts.set(e.id, e.texto);
  }

  const routes = found.map(({ route, planned: p, uplift }, i): AiRoute => {
    const f = facts[i];
    const texto = texts.get(f.id);
    return {
      ...route,
      titulo: p.titulo,
      dimension: p.dimension,
      upliftPct: uplift,
      limitadoPorTiempo: p.limitadoPorTiempo,
      explicacion: texto && citesFigures(texto, f) ? texto : templateExplanation(f),
    };
  });
  return { kind: 'routes', routes, warnings };
}
