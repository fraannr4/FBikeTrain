import { abortError } from '../ai/abort';
import type { LatLng } from '../domain/types';
import { newRoadPct } from '../metrics/grid';
import { difficulty, type Difficulty, type UserReference } from '../metrics/reference';
import { scoreCandidate, type Target } from '../metrics/score';
import { analyzeRoute, rejectReason, type RejectReason, type RouteCandidate } from './analyze';
import { fetchRoundTrip, OrsError, type OrsAccess } from './ors';
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
/** Último recurso: vueltas descartadas que se enseñan con aviso si ninguna pasa el filtro. */
const FALLBACK_MAX_OFFROAD_M = 3000;
const FALLBACK_UNDER = 0.4;
const FALLBACK_OVER = 0.1;
/** Dos vueltas con la misma distancia (redondeada a 100 m) y desnivel (a 10 m) cuentan como la misma. */
const DEDUPE_DISTANCE_M = 100;
const DEDUPE_GAIN_M = 10;
const MAX_SEED_BASE = 10000;

export type GenerateRequest = { start: LatLng; target: Target; count?: number; seeds?: number };

export type GeneratedRoute = RouteCandidate & {
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
};

/**
 * Pide las semillas una detrás de otra (nunca en paralelo, por la cuota por minuto).
 * Una semilla sin ruta (`no_route`) se salta. Cualquier otro error de ORS lanza si aún no ha
 * llegado ninguna candidata; si ya ha llegado alguna, corta la búsqueda y se devuelve en `stoppedBy`.
 */
export async function generateRoutes(req: GenerateRequest, deps: GenerateDeps): Promise<GenerateResult> {
  const seeds = Math.max(0, Math.min(req.seeds ?? DEFAULT_SEEDS, SEARCH_REQUEST_BUDGET));
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
      const f = await fetchOne(deps.apiKey, { start: req.start, lengthM, points: ROUND_TRIP_POINTS, seed, signal: deps.signal });
      candidate = analyzeRoute(f, seed);
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
    if (candidate.distanceM > 0) factors.push(candidate.distanceM / lengthM);

    const reason = rejectReason(candidate, req.target.distanceM);
    if (reason) {
      rejected.push({ seed, reason });
      if (reason !== 'autopista') near.push({ candidate, reason });
      continue;
    }
    const rated = rate(candidate, req.target, deps);
    // Las puntas y lazos no pueden llenar el cupo de rutas buenas ni detener la búsqueda pronto.
    if (rated.warning) awkward.push(rated);
    else accepted.push(rated);
    // Basta con `count` vueltas limpias y distintas hacia lados distintos: dos al mismo lado no paran la búsqueda.
    if (new Set(dedupe(accepted).map((r) => routeSide(r.coords, req.start))).size >= count) break;
  }

  if (received === 0 && lastError) throw lastError;
  // Respaldo acotado: conserva candidatas utilizables con aviso, nunca autopistas ni mucha pista.
  if (accepted.length === 0) accepted.push(...awkward, ...fallback(near, req.target, deps));
  const routes = diverse(dedupe(accepted.sort((a, b) => b.score - a.score)), req.start).slice(0, count);
  return { routes, rejected, requestsUsed, stoppedBy };
}

/**
 * Primero la mejor vuelta de cada lado del inicio, de más a menos puntuación; después el resto.
 * Así cinco propuestas son cinco zonas distintas, no la misma vuelta más larga o más corta.
 */
function diverse(sorted: GeneratedRoute[], start: LatLng): GeneratedRoute[] {
  const seen = new Set<number>();
  const first: GeneratedRoute[] = [];
  const rest: GeneratedRoute[] = [];
  for (const r of sorted) {
    const side = routeSide(r.coords, start);
    if (seen.has(side)) rest.push(r);
    else { seen.add(side); first.push(r); }
  }
  return [...first, ...rest];
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
      const rated = rate(candidate, target, deps);
      return { ...rated, warning: [warningFor(candidate, reason, t), rated.warning].filter(Boolean).join(' ') };
    });
}

function rate(c: RouteCandidate, target: Target, deps: GenerateDeps): GeneratedRoute {
  const newPct = newRoadPct(c.coords, deps.visited);
  const ref = deps.reference;
  const quality = geometryQuality(c.coords);
  return {
    ...c,
    newPct,
    score: Math.max(0, scoreCandidate({ distanceM: c.distanceM, elevGainM: c.elevGainM, newPct }, target) - quality.penalty),
    ...(quality.penalty > 0 ? { warning: 'Posibles tramos de ida y vuelta o pequeños bucles locales. Revisa el recorrido antes de salir.' } : {}),
    difficulty: ref ? difficulty(c, ref) : null,
    estTimeS: ref && ref.avgSpeedMs > 0 ? c.distanceM / ref.avgSpeedMs : null,
  };
}

/** Deja la primera de cada grupo de vueltas iguales; con la lista ordenada, la de más puntuación. */
function dedupe(routes: GeneratedRoute[]): GeneratedRoute[] {
  const seen = new Set<string>();
  return routes.filter((r) => {
    const key = `${Math.round(r.distanceM / DEDUPE_DISTANCE_M)}:${Math.round(r.elevGainM / DEDUPE_GAIN_M)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
