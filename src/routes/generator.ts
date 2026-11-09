import { abortError } from '../ai/abort';
import type { LatLng } from '../domain/types';
import { newRoadPct } from '../metrics/grid';
import { difficulty, type Difficulty, type UserReference } from '../metrics/reference';
import { scoreCandidate, type Target } from '../metrics/score';
import { analyzeRoute, rejectReason, type RejectReason, type RouteCandidate } from './analyze';
import { fetchRoundTrip, OrsError } from './ors';

/** Búsqueda de rutas: pide a ORS una vuelta por semilla, descarta las que no son de carretera y puntúa el resto. */

/** Puntos de paso de cada vuelta circular. */
export const ROUND_TRIP_POINTS = 4;
export const DEFAULT_COUNT = 5;
export const DEFAULT_SEEDS = 8;
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
};

export type GenerateResult = {
  routes: GeneratedRoute[];
  rejected: { seed: number; reason: RejectReason }[];
  requestsUsed: number;
  /** Error de ORS que cortó la búsqueda a medias; las rutas ya obtenidas se conservan. */
  stoppedBy: OrsError | null;
};

export type GenerateDeps = {
  apiKey: string;
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
  const seeds = req.seeds ?? DEFAULT_SEEDS;
  const count = req.count ?? DEFAULT_COUNT;
  const seedBase = deps.seedBase ?? Math.floor(Math.random() * MAX_SEED_BASE);
  const fetchOne = deps.fetchRoundTrip ?? fetchRoundTrip;

  const accepted: GeneratedRoute[] = [];
  const rejected: GenerateResult['rejected'] = [];
  let requestsUsed = 0;
  let received = 0;
  let stoppedBy: OrsError | null = null;

  for (let i = 0; i < seeds; i++) {
    if (deps.signal?.aborted) throw abortError();
    const seed = seedBase + i;
    requestsUsed++;
    let candidate: RouteCandidate;
    try {
      const f = await fetchOne(deps.apiKey, {
        start: req.start,
        lengthM: req.target.distanceM,
        points: ROUND_TRIP_POINTS,
        seed,
        signal: deps.signal,
      });
      candidate = analyzeRoute(f, seed);
    } catch (e) {
      if (e instanceof OrsError && e.kind === 'no_route') continue;
      if (!(e instanceof OrsError) || received === 0) throw e;
      stoppedBy = e;
      break;
    }
    received++;

    const reason = rejectReason(candidate, req.target.distanceM);
    if (reason) {
      rejected.push({ seed, reason });
      continue;
    }
    accepted.push(rate(candidate, req.target, deps));
  }

  const routes = dedupe(accepted.sort((a, b) => b.score - a.score)).slice(0, count);
  return { routes, rejected, requestsUsed, stoppedBy };
}

function rate(c: RouteCandidate, target: Target, deps: GenerateDeps): GeneratedRoute {
  const newPct = newRoadPct(c.coords, deps.visited);
  const ref = deps.reference;
  return {
    ...c,
    newPct,
    score: scoreCandidate({ distanceM: c.distanceM, elevGainM: c.elevGainM, newPct }, target),
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
