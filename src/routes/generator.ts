import { abortError } from '../ai/abort';
import type { LatLng } from '../domain/types';
import { newRoadPct } from '../metrics/grid';
import { difficulty, type Difficulty, type UserReference } from '../metrics/reference';
import { scoreCandidate, type Target } from '../metrics/score';
import { analyzeRoute, rejectReason, type RejectReason, type RouteCandidate } from './analyze';
import { fetchPathFeature, fetchRoundTrip, OrsError, type OrsAccess } from './ors';
import { visitsWaypoints, type RouteIntent } from './intent';
import { geometryQuality } from './quality';
import { routeSide } from './side';

/**
 * Búsqueda de rutas: pide a ORS una vuelta por semilla, descarta las que no son de carretera,
 * puntúa el resto y propone, antes que nada, vueltas hacia lados distintos del inicio.
 */

/** Puntos de paso de cada vuelta circular. */
export const ROUND_TRIP_POINTS = 4;

/**
 * La distancia pedida es un techo blando: se apunta algo por debajo (50 km dan unos 47) y lo que
 * se pasa cuenta más que lo que se queda corto (ver `analyze.ts` y `score.ts`).
 */
export const AIM_FRACTION = 0.94;
/** Cuánto se pasa ORS de la longitud pedida en la primera vuelta; las siguientes lo miden. */
export const INITIAL_ROAD_FACTOR = 1.15;
export const DEFAULT_COUNT = 5;
/** Presupuesto de una operación completa; deja margen bajo las 8 consultas/minuto compartidas. */
export const SEARCH_REQUEST_BUDGET = 6;
export const DEFAULT_SEEDS = SEARCH_REQUEST_BUDGET;
/** Techo de `budget`: el de una búsqueda completa de «Rutas cerca» (`NEARBY_ORS_BUDGET`). */
export const MAX_GENERATE_BUDGET = 14;
/** Último recurso: vueltas descartadas que se enseñan con aviso si ninguna pasa el filtro. */
const FALLBACK_MAX_OFFROAD_M = 3000;
const FALLBACK_UNDER = 0.4;
const FALLBACK_OVER = 0.1;
/** Dos vueltas con la misma distancia (redondeada a 100 m) y desnivel (a 10 m) cuentan como la misma. */
const DEDUPE_DISTANCE_M = 100;
const DEDUPE_GAIN_M = 10;
const MAX_SEED_BASE = 10000;
/** Fracción máxima de retroceso admitida en una vuelta dirigida por un puerto o una referencia. */
export const MAX_INTENT_BACKTRACK = 0.15;

export type GenerateRequest = {
  start: LatLng; target: Target; count?: number; seeds?: number; usedSides?: readonly number[]; intents?: RouteIntent[];
  /** Consultas a ORS que puede gastar; por defecto `SEARCH_REQUEST_BUDGET`, nunca más de `MAX_GENERATE_BUDGET`. */
  budget?: number;
};

export type GeneratedRoute = RouteCandidate & {
  /** Referencia efectivamente recorrida; no basta con que la IA la haya mencionado. */
  intentId?: string;
  newPct: number;
  score: number;
  difficulty: Difficulty | null;
  estTimeS: number | null;
  /** Solo en las vueltas de último recurso: qué incumple del filtro de carretera. */
  warning?: string;
};

export type GenerateResult = {
  routes: GeneratedRoute[];
  rejected: { seed: number; reason: RejectReason }[];
  requestsUsed: number;
  /** Error de ORS que cortó la búsqueda a medias; las rutas ya obtenidas se conservan. */
  stoppedBy: OrsError | null;
};

export type GenerateDeps = {
  /** Clave personal o servicio común (`chooseOrsAccess`). */
  apiKey: OrsAccess;
  reference: UserReference | null;
  visited: ReadonlySet<string>;
  seedBase?: number;
  signal?: AbortSignal;
  fetchRoundTrip?: typeof fetchRoundTrip;
  fetchPath?: typeof fetchPathFeature;
};

/**
 * Pide las semillas una detrás de otra (nunca en paralelo, por la cuota por minuto).
 * Una semilla sin ruta (`no_route`) se salta. Cualquier otro error de ORS lanza si aún no ha
 * llegado ninguna candidata; si ya ha llegado alguna, corta la búsqueda y se devuelve en `stoppedBy`.
 */
export async function generateRoutes(req: GenerateRequest, deps: GenerateDeps): Promise<GenerateResult> {
  const budget = Math.max(0, Math.min(req.budget ?? SEARCH_REQUEST_BUDGET, MAX_GENERATE_BUDGET));
  const seeds = Math.max(0, Math.min(req.seeds ?? budget, budget));
  const count = req.count ?? DEFAULT_COUNT;
  const seedBase = deps.seedBase ?? Math.floor(Math.random() * MAX_SEED_BASE);
  const fetchOne = deps.fetchRoundTrip ?? fetchRoundTrip;
  const aimM = req.target.distanceM * AIM_FRACTION;
  const factors: number[] = [];

  const accepted: GeneratedRoute[] = [];
  const awkward: GeneratedRoute[] = [];
  const rejected: GenerateResult['rejected'] = [];
  let requestsUsed = 0;
  let received = 0;
  let stoppedBy: OrsError | null = null;

  const near: { candidate: RouteCandidate; reason: RejectReason }[] = [];
  let lastError: OrsError | null = null;
  for (let i = 0; i < seeds; i++) {
    if (deps.signal?.aborted) throw abortError();
    const seed = seedBase + i;
    requestsUsed++;
    let candidate: RouteCandidate;
    const lengthM = aimM / median(factors, INITIAL_ROAD_FACTOR);
    try {
      // Reservar al menos un intento tradicional si la referencia no es transitable.
      const intent = i < Math.min(req.intents?.length ?? 0, Math.max(1, seeds - 1)) ? req.intents?.[i] : undefined;
      const f = intent
        ? await (deps.fetchPath ?? fetchPathFeature)(deps.apiKey, intent.waypoints, deps.signal)
        : await fetchOne(deps.apiKey, { start: req.start, lengthM, points: ROUND_TRIP_POINTS, seed, signal: deps.signal });
      if (intent && !visitsWaypoints(f.geometry.coordinates, intent.waypoints)) continue;
      candidate = analyzeRoute(f, seed);
      if (intent) Object.assign(candidate, { intentId: intent.id });
      // Una ruta dirigida no puede presentarse como carretera validada sin datos de firme.
      if (intent && (!f.properties.extras.surface?.summary.length || !f.properties.extras.waytypes?.summary.length || candidate.unknownSurfacePct > 20)) continue;
      // Subir y bajar por la misma carretera no es una vuelta por el puerto ni por la referencia: se descarta y se busca otra.
      if (intent && geometryQuality(candidate.coords).backtrackM > candidate.distanceM * MAX_INTENT_BACKTRACK) continue;
    } catch (e) {
      if (e instanceof OrsError && e.kind === 'no_route') continue;
      // Un fallo suelto del motor (HTTP 5xx) no corta la búsqueda: se prueba la semilla siguiente.
      if (e instanceof OrsError && e.kind === 'server') { lastError = e; continue; }
      if (!(e instanceof OrsError) || received === 0) throw e;
      stoppedBy = e;
      break;
    }
    received++;
    // Cuánto se pasa ORS de lo pedido: corrige la longitud de las siguientes.
    if (candidate.distanceM > 0 && !(candidate as GeneratedRoute).intentId) factors.push(candidate.distanceM / lengthM);

    const reason = rejectReason(candidate, req.target.distanceM);
    if (reason) {
      rejected.push({ seed, reason });
      if (reason !== 'autopista') near.push({ candidate, reason });
      continue;
    }
    const rated = rateCandidate(candidate, req.target, deps);
    // Las puntas y lazos no pueden llenar el cupo de rutas buenas ni detener la búsqueda pronto.
    if (rated.warning) awkward.push(rated);
    else accepted.push(rated);
    // Basta con `count` vueltas limpias y distintas hacia lados distintos: dos al mismo lado no paran la búsqueda.
    const good = dedupe(accepted, req.start).filter(r => !(req.usedSides ?? []).includes(routeSide(r.coords, req.start)) && fitsGain(r, req.target));
    if (new Set(good.map((r) => routeSide(r.coords, req.start))).size >= count) break;
  }

  if (received === 0 && lastError) throw lastError;
  // Respaldo acotado: conserva candidatas utilizables con aviso, nunca autopistas ni mucha pista.
  if (accepted.length === 0) accepted.push(...awkward, ...fallback(near, req.target, deps));
  const routes = diverse(dedupe(accepted.sort((a, b) => b.score - a.score), req.start), req.start, req.usedSides).slice(0, count).map(r => {
    const warnings = [r.warning];
    if ((req.usedSides ?? []).includes(routeSide(r.coords, req.start))) warnings.push('Esta propuesta va hacia el mismo lado que otra; no se ha encontrado una alternativa mejor dentro del límite.');
    if (!fitsGain(r, req.target)) warnings.push(`El desnivel es ${Math.round(r.elevGainM)} m frente a los ${Math.round(req.target.elevGainM!)} m pedidos.`);
    return { ...r, ...(warnings.some(Boolean) ? { warning: warnings.filter(Boolean).join(' ') } : {}) };
  });
  return { routes, rejected, requestsUsed, stoppedBy };
}

/**
 * Primero la mejor vuelta de cada lado del inicio, de más a menos puntuación; después el resto.
 * Así cinco propuestas son cinco zonas distintas, no la misma vuelta más larga o más corta.
 */
function diverse(sorted: GeneratedRoute[], start: LatLng, usedSides: readonly number[] = []): GeneratedRoute[] {
  const seen = new Set<number>(usedSides);
  const first: GeneratedRoute[] = [];
  const rest: GeneratedRoute[] = [];
  for (const r of sorted) {
    const side = routeSide(r.coords, start);
    if (seen.has(side)) rest.push(r);
    else { seen.add(side); first.push(r); }
  }
  return [...first, ...rest];
}

function fitsGain(c: RouteCandidate, target: Target): boolean {
  return target.elevGainM === null || Math.abs(c.elevGainM - target.elevGainM) <= Math.max(100, target.elevGainM * 0.2);
}

function median(xs: number[], fallback: number): number {
  if (xs.length === 0) return fallback;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const km = (m: number) => `${(m / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`;

/** Qué incumple una vuelta de último recurso, en una línea para la tarjeta. */
function warningFor(c: RouteCandidate, reason: RejectReason, targetM: number): string {
  if (reason === 'pistas' || reason === 'sin asfaltar') return `Incluye ${km(c.unpavedM + c.trackM)} de pista o sin asfaltar.`;
  if (reason === 'carretera principal') return `Un ${Math.round(c.mainRoadPct)} % va por carretera principal.`;
  return `Sale de ${km(c.distanceM)} frente a los ${km(targetM)} pedidos.`;
}

/** Sin ninguna ruta limpia: las descartadas más cercanas al filtro, con aviso, para no dejar la búsqueda vacía. */
function fallback(near: { candidate: RouteCandidate; reason: RejectReason }[], target: Target, deps: GenerateDeps): GeneratedRoute[] {
  const t = target.distanceM;
  return near
    .filter(({ candidate: c }) => c.unpavedM + c.trackM <= FALLBACK_MAX_OFFROAD_M && c.distanceM >= t * (1 - FALLBACK_UNDER) && c.distanceM <= t * (1 + FALLBACK_OVER))
    .sort((a, b) => a.candidate.unpavedM + a.candidate.trackM - (b.candidate.unpavedM + b.candidate.trackM))
    .map(({ candidate, reason }) => {
      const rated = rateCandidate(candidate, target, deps);
      return { ...rated, warning: [warningFor(candidate, reason, t), rated.warning].filter(Boolean).join(' ') };
    });
}

/** Puntuación, carretera nueva, dificultad y tiempo de una candidata; aviso si tiene retrocesos o lazos. */
export function rateCandidate(c: RouteCandidate, target: Target, deps: Pick<GenerateDeps, 'reference' | 'visited'>): GeneratedRoute {
  const newPct = newRoadPct(c.coords, deps.visited);
  const ref = deps.reference;
  const quality = geometryQuality(c.coords);
  return {
    ...c,
    newPct,
    score: Math.max(0, scoreCandidate({ distanceM: c.distanceM, elevGainM: c.elevGainM, newPct }, target) - quality.penalty - Math.min(0.3, c.mainRoadPct / 100)),
    ...(quality.penalty > 0 ? { warning: 'Posibles tramos de ida y vuelta o pequeños bucles locales. Revisa el recorrido antes de salir.' } : {}),
    difficulty: ref ? difficulty(c, ref) : null,
    estTimeS: ref && ref.avgSpeedMs > 0 ? c.distanceM / ref.avgSpeedMs : null,
  };
}

/** Deja la primera de cada grupo de vueltas iguales; con la lista ordenada, la de más puntuación. */
function dedupe(routes: GeneratedRoute[], start: LatLng): GeneratedRoute[] {
  const seen = new Set<string>();
  return routes.filter((r) => {
    const key = `${routeSide(r.coords, start)}:${Math.round(r.distanceM / DEDUPE_DISTANCE_M)}:${Math.round(r.elevGainM / DEDUPE_GAIN_M)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
