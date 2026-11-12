import type { ClimbEffort, LatLng, Settings } from '../domain/types';
import { getTrack } from '../db/repo';
import type { AiPass } from './contracts';
import { haversineM } from '../import/summary';
import { upliftPct, type UserReference } from '../metrics/reference';
import type { Target } from '../metrics/score';
import { generateRoutes, SEARCH_REQUEST_BUDGET, type GeneratedRoute } from '../routes/generator';
import { OrsError, type OrsAccess } from '../routes/ors';
import { findMountainPasses, findRouteReferences, routeSourcesEnabled, type RouteSourceInvoker } from '../routes/sources/client';
import { listReferenceRoutes, type ReferenceRoute } from '../routes/library';
import { historyPasses, type LocalPass } from '../routes/historyPasses';
import { libraryIntent, passIntent, type RouteIntent } from '../routes/intent';
import { routeSide } from '../routes/side';
import { formatDeltaPct, formatKm, formatMeters } from '../ui/format';
import { abortError } from './abort';
import type { LevelSummary } from './levelSummary';
import { chatJson, LlmError, type LlmErrorKind } from './llm';
import { buildExplainMessages, buildPlanMessages, type AiGoal, type AiReference, type Answers, type ChatMessage, type RouteFacts } from './prompts';
import { libraryReferences, pickReferences, rwgpsReferences, type KnownRoute } from './references';
import { fetchRwgpsNearby, type RwgpsAccess } from '../routes/sources/rwgpsImport';
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
/** Una ruta por opción, con un único presupuesto de consultas para todo el plan. */
const ORS_COUNT = 1;
const ORS_SEEDS = 3;

const FALLBACK_INVALID = 'La IA no ha devuelto un plan válido. Ajusta la ruta a mano.';
/** Radio de búsqueda de rutas conocidas alrededor del inicio. */
const SOURCES_RADIUS_M = 15_000;
const SOURCES_DOWN = 'No se han podido consultar rutas conocidas cerca del inicio; las propuestas no las tienen en cuenta.';
const RWGPS_RADIUS_KM = 15;
const RWGPS_DOWN = 'No se han podido consultar las rutas de Ride with GPS cerca del inicio; las propuestas no las tienen en cuenta.';

type Dimension = 'distancia' | 'desnivel';

export type PlannedTarget = {
  titulo: string;
  dimension: Dimension;
  target: Target;
  upliftPct: number;
  limitadoPorTiempo: boolean;
  /** Referencia en la que dice basarse la IA; se comprueba contra las enviadas. */
  referenciaId: string | null;
  puertoId?: string | null;
};

export type AiRoute = GeneratedRoute & {
  titulo: string;
  explicacion: string;
  upliftPct: number;
  dimension: Dimension;
  /** La distancia la ha recortado el tiempo disponible. */
  limitadoPorTiempo: boolean;
  /** Ruta conocida en la que se basa la opción, con su enlace original. */
  basadaEn?: { nombre: string; fuente: KnownRoute['source']; url?: string; autor?: string };
  puerto?: { nombre: string; cotaM: number | null };
};

export type AiRoutesResult =
  | { kind: 'routes'; routes: AiRoute[]; warnings: string[] }
  | { kind: 'fallback'; message: string; cause: LlmErrorKind; suggested: Target };

type ChatRequest<T> = Parameters<typeof chatJson<T>>[1];
type Outcome<T> = { ok: true; data: T } | { ok: false; error: LlmError };

export type SharedAiPlanner = {
  plan: (summary: LevelSummary, answers: Answers, maxDistanciaKm: number, signal?: AbortSignal, referencias?: AiReference[], objetivo?: AiGoal | null, puertos?: AiPass[]) => Promise<RoutePlan>;
  explain: (summary: LevelSummary, facts: RouteFacts[], signal?: AbortSignal) => Promise<{ explicaciones: { id: string; texto: string }[] }>;
};

/**
 * Llama a la IA y, si el JSON no es válido, repite una vez con la respuesta anterior y el error.
 * Los demás errores (clave, límite, red) no se repiten.
 */
export async function chatWithRetry<T>(
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
  referencias: AiReference[] = [],
  objetivo: AiGoal | null = null,
  puertos: AiPass[] = [],
): Promise<{ ok: true; plan: RoutePlan } | { ok: false; error: LlmError }> {
  const out = await chatWithRetry(
    cfg,
    {
      messages: buildPlanMessages(summary, answers, maxDistanciaKm, referencias, objetivo, puertos),
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
  referenciaId: string | null,
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
    referenciaId,
  };
}

/**
 * Objetivos de cada opción: en su dimensión, el valor se recorta al 5-15 % sobre la media; después,
 * la distancia se limita al tiempo disponible, que manda sobre el 5 %.
 */
export function targetsFromPlan(plan: RoutePlan, ref: UserReference, answers: Answers): PlannedTarget[] {
  return plan.opciones.map((o) => {
    const referenciaId = o.referenciaId ?? null;
    if (o.dimension === 'distancia') {
      return { ...plannedTarget(o.titulo, o.dimension, clamp(o.distanciaKm * 1000, ref.avgDistanceM), o.desnivelM, ref, answers, referenciaId), ...(o.puertoId ? { puertoId: o.puertoId } : {}) };
    }
    const wantedGain = o.desnivelM ?? ref.avgElevGainM * (1 + o.subidaPct / 100);
    const elevGainM = Math.round(clamp(wantedGain, ref.avgElevGainM));
    return { ...plannedTarget(o.titulo, o.dimension, o.distanciaKm * 1000, elevGainM, ref, answers, referenciaId), ...(o.puertoId ? { puertoId: o.puertoId } : {}) };
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
    orsKey: OrsAccess;
    visited: ReadonlySet<string>;
    chat?: typeof chatJson;
    generate?: typeof generateRoutes;
    signal?: AbortSignal;
    shared?: SharedAiPlanner;
    /** Función `route-sources` de la cuenta; sin cuenta, no se buscan rutas conocidas. */
    sources?: RouteSourceInvoker;
    /** Colección común de Ride with GPS (función `rwgps`); sin cuenta, no se consulta. */
    rwgps?: RwgpsAccess;
    /** Objetivo vigente del usuario (`aiGoal`), solo cifras; sin él, el plan no lo menciona. */
    goal?: AiGoal | null;
    library?: () => Promise<ReferenceRoute[]>;
    climbs?: ClimbEffort[];
    track?: typeof getTrack;
    passes?: (start: LatLng, signal?: AbortSignal) => Promise<LocalPass[]>;
  },
): Promise<AiRoutesResult> {
  const { start, answers, reference: ref, summary } = input;
  const chat = deps.chat ?? chatJson;
  const generate = deps.generate ?? generateRoutes;
  const objetivo = deps.goal ?? null;

  const cap = timeCapM(ref, answers);
  const maxKm = Number.isFinite(cap) ? round1(Math.min(cap / 1000, PLAN_MAX_KM)) : PLAN_MAX_KM;
  const { signal } = deps;
  const warnings: string[] = [];

  // Rutas conocidas cerca del inicio. Las coordenadas van solo a nuestra función, nunca a la IA.
  let known: KnownRoute[] = [];
  if (deps.sources && routeSourcesEnabled()) {
    try {
      known = await findRouteReferences({ lat: start.lat, lon: start.lng, radiusM: SOURCES_RADIUS_M }, deps.sources, signal);
    } catch {
      if (signal?.aborted) throw abortError();
      warnings.push(SOURCES_DOWN);
    }
  }
  if (deps.rwgps) {
    // Distancia orientativa para el índice: la media del usuario con el margen del formulario, sin pasar del tiempo.
    const aimKm = Math.min(maxKm, (ref.avgDistanceM / 1000) * SUGGESTED_UPLIFT);
    try {
      const { routes } = await fetchRwgpsNearby(deps.rwgps, {
        start, radiusKm: RWGPS_RADIUS_KM, ...(aimKm >= 5 ? { distanceKm: Math.round(Math.min(aimKm, 300)) } : {}),
      }, signal);
      known = [...rwgpsReferences(routes, start), ...known];
    } catch {
      if (signal?.aborted) throw abortError();
      warnings.push(RWGPS_DOWN);
    }
  }
  try {
    const local = await (deps.library ?? listReferenceRoutes)();
    if (signal?.aborted) throw abortError();
    known = [...libraryReferences(local, start, SOURCES_RADIUS_M), ...known];
  } catch {
    if (signal?.aborted) throw abortError();
    warnings.push('No se ha podido consultar tu biblioteca; se buscarán vueltas nuevas.');
  }
  const { forAi: referencias, byId: referencesById } = pickReferences(known, maxKm);
  let passes: LocalPass[] = [];
  if (answers.focus !== 'fondo') {
    try {
      passes = await historyPasses(start, deps.climbs ?? [], deps.track ?? getTrack, signal);
      const osm = deps.passes ? await deps.passes(start, signal)
        : deps.sources && routeSourcesEnabled() ? await findMountainPasses(start, deps.sources, signal) : [];
      for (const p of osm) if (!passes.some(knownPass => haversineM(p.lat, p.lng, knownPass.lat, knownPass.lng) < 300)) passes.push(p);
    } catch {
      if (signal?.aborted) throw abortError();
      warnings.push('No se han podido consultar todos los puertos; se conserva el historial disponible.');
    }
  }
  passes = passes.filter(p => p.distanceM >= 15_000 && p.distanceM <= 40_000 && p.distanceM * 2 <= maxKm * 1000 && passIntent(p.id, start, p)).slice(0, 6);
  const passesById = new Map(passes.map((p, i) => [`pass${i + 1}`, p]));
  const puertos: AiPass[] = [...passesById].map(([id, p]) => ({ id, nombre: p.name.slice(0, 80), cotaM: p.ele, distanciaKm: round1(p.distanceM / 1000) }));

  // El servicio común caído o sin red no es el límite: con clave personal, se sigue con ella. Con 429, no.
  const personal = !!deps.llm && deps.llm.apiKey.trim() !== '' && deps.llm.model.trim() !== '';
  const usePersonal = (e: LlmError) => personal && (e.kind === 'network' || e.kind === 'unavailable');
  let planned: Awaited<ReturnType<typeof planWithRetry>>;
  let shared = deps.shared;
  if (shared) {
    try { planned = { ok: true, plan: await shared.plan(summary, answers, maxKm, signal, referencias, objetivo, puertos) }; }
    catch (error) {
      if (!(error instanceof LlmError)) throw error;
      if (usePersonal(error)) {
        shared = undefined;
        planned = await planWithRetry(deps.llm, summary, answers, maxKm, chat, signal, referencias, objetivo, puertos);
      } else planned = { ok: false, error };
    }
  } else planned = await planWithRetry(deps.llm, summary, answers, maxKm, chat, signal, referencias, objetivo, puertos);
  if (!planned.ok) {
    const message = planned.error.kind === 'invalid_json' ? FALLBACK_INVALID : planned.error.message;
    return { kind: 'fallback', message, cause: planned.error.kind, suggested: suggestedTarget(ref, answers) };
  }

  // Una opción detrás de otra, nunca en paralelo, por la cuota por minuto de ORS.
  const found: Found[] = [];
  const targets = targetsFromPlan(planned.plan, ref, answers);
  let remaining = SEARCH_REQUEST_BUDGET;
  const usedSides = new Set<number>();
  for (const [index, p] of targets.entries()) {
    if (signal?.aborted) throw abortError();
    if (remaining <= 0) break;
    // Repartir el presupuesto deja al menos un intento a las opciones siguientes.
    const seeds = Math.min(ORS_SEEDS, Math.max(1, Math.floor(remaining / (targets.length - index))));
    const intents: RouteIntent[] = [];
    const pass = p.puertoId ? passesById.get(p.puertoId) : undefined;
    if (pass && p.puertoId) {
      const intent = passIntent(p.puertoId, start, pass);
      if (intent) intents.push(intent);
    }
    const base = p.referenciaId ? referencesById.get(p.referenciaId) : undefined;
    if (base?.points && p.referenciaId) {
      const extension = [...referencesById.values()].find(r => r.libraryId && r.libraryId !== base.libraryId && r.points);
      const intent = libraryIntent(p.referenciaId, start, p.target.distanceM, base.points, extension?.points);
      if (intent) intents.push(intent);
    }
    let res;
    try {
      res = await generate(
        { start, target: p.target, count: ORS_COUNT, seeds, usedSides: [...usedSides], ...(intents.length ? { intents } : {}) },
        { apiKey: deps.orsKey, reference: ref, visited: deps.visited, signal },
      );
    } catch (e) {
      if (!(e instanceof OrsError) || found.length === 0) throw e;
      warnings.push(e.message);
      break;
    }
    remaining -= res.requestsUsed;
    const [route] = res.routes;
    if (route) {
      usedSides.add(routeSide(route.coords, start));
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
    const explainPersonal = () => chatWithRetry(
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
    const viaShared = shared;
    const out = viaShared ? await (async (): Promise<Outcome<{ explicaciones: { id: string; texto: string }[] }>> => {
      try { return { ok: true, data: await viaShared.explain(summary, facts, signal) }; }
      catch (error) {
        if (!(error instanceof LlmError)) throw error;
        return usePersonal(error) ? explainPersonal() : { ok: false, error };
      }
    })() : await explainPersonal();
    if (out.ok) for (const e of out.data.explicaciones) texts.set(e.id, e.texto);
  }

  const routes = found.map(({ route, planned: p, uplift }, i): AiRoute => {
    const f = facts[i];
    const texto = texts.get(f.id);
    // Un id que no se ha enviado se ignora.
    const basada = route.intentId ? referencesById.get(route.intentId) : undefined;
    const puerto = route.intentId ? passesById.get(route.intentId) : undefined;
    return {
      ...route,
      titulo: p.titulo,
      dimension: p.dimension,
      upliftPct: uplift,
      limitadoPorTiempo: p.limitadoPorTiempo,
      explicacion: texto && citesFigures(texto, f) ? texto : templateExplanation(f),
      ...(basada ? { basadaEn: { nombre: basada.name, fuente: basada.source, ...(basada.url ? { url: basada.url } : {}), ...(basada.author ? { autor: basada.author } : {}) } } : {}),
      ...(puerto ? { puerto: { nombre: puerto.name, cotaM: puerto.ele } } : {}),
    };
  });
  return { kind: 'routes', routes, warnings };
}
