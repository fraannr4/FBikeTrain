import { isAbort } from '../../ai/abort';
import type { LatLng } from '../../domain/types';
import { haversineM } from '../../import/summary';
import { adaptRoute, type AdaptedRoute } from '../adapt';
import type { ReferenceRoute } from '../library';
import { OrsError, type OrsAccess } from '../ors';
import { rankForTarget, type RankCard } from '../rank';
import { CATALOG_RADIUS_M } from './osm';

/**
 * Propuestas desde el catálogo: se ordena por los km y el desnivel pedidos (nunca por nivel), se
 * adapta cada candidata para salir y volver al inicio y se quedan las 3 primeras válidas y distintas.
 */

export const PROPOSALS = 3;
/** Candidatas que se intentan adaptar como mucho: cada una gasta hasta 4 consultas a ORS. */
export const MAX_ATTEMPTS = 8;
/** Esperas por el límite por minuto de ORS antes de rendirse con una candidata. */
const MAX_WAITS = 2;
export const RATE_WAIT_MS = 60_000;
/** Dos propuestas que comparten más de esto de recorrido son la misma salida. */
const OVERLAP_LIMIT = 0.7;
const OVERLAP_NEAR_M = 150;

export type Proposal = { route: ReferenceRoute; adapted: AdaptedRoute; motivo: string };
export type RecommendTarget = { start: LatLng; distanceKm: number; elevGainM: number | null };
export type RecommendUpdate =
  | { kind: 'trying'; route: ReferenceRoute; attempt: number; total: number }
  | { kind: 'waiting'; seconds: number }
  | { kind: 'proposal'; proposal: Proposal };
export type RecommendDeps = {
  ors: OrsAccess;
  signal?: AbortSignal;
  onUpdate?: (u: RecommendUpdate) => void;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  adapt?: typeof adaptRoute;
};
export type RecommendResult = { proposals: Proposal[]; rejected: { route: ReferenceRoute; motivo: string }[]; candidates: number };

type CatalogCard = RankCard & { route: ReferenceRoute };

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });
}

function nearestM(route: ReferenceRoute, start: LatLng): number {
  let near = Infinity;
  for (const p of route.points) near = Math.min(near, haversineM(p.lat, p.lng, start.lat, start.lng));
  return near;
}

/** Parte de `a` (muestreada) que pasa a menos de 150 m de `b`. */
export function overlap(a: LatLng[], b: LatLng[]): number {
  const step = Math.max(1, Math.floor(a.length / 150));
  const bStep = Math.max(1, Math.floor(b.length / 600));
  let near = 0;
  let total = 0;
  for (let i = 0; i < a.length; i += step) {
    total++;
    for (let j = 0; j < b.length; j += bStep) {
      if (haversineM(a[i].lat, a[i].lng, b[j].lat, b[j].lng) <= OVERLAP_NEAR_M) { near++; break; }
    }
  }
  return total ? near / total : 0;
}

/** Candidatas en orden: a menos de 15 km del inicio y dentro de 0,5×–1,6× la distancia pedida. */
export function rankCatalog(routes: ReferenceRoute[], target: RecommendTarget) {
  const cards: CatalogCard[] = routes
    .filter((route) => nearestM(route, target.start) <= CATALOG_RADIUS_M)
    .map((route) => ({ id: route.id, km: route.summary.distanceM / 1000, desnivelM: route.summary.elevGainM, route }));
  return rankForTarget(cards, { distanceKm: target.distanceKm, ...(target.elevGainM !== null ? { elevGainM: target.elevGainM } : {}) }, null);
}

export async function recommendFromCatalog(routes: ReferenceRoute[], target: RecommendTarget, deps: RecommendDeps): Promise<RecommendResult> {
  const { ranked } = rankCatalog(routes, target);
  const wait = deps.wait ?? sleep;
  const adapt = deps.adapt ?? adaptRoute;
  const proposals: Proposal[] = [];
  const rejected: RecommendResult['rejected'] = [];
  const candidates = ranked.slice(0, MAX_ATTEMPTS);
  for (const [i, item] of candidates.entries()) {
    if (proposals.length >= PROPOSALS) break;
    const route = item.card.route;
    deps.onUpdate?.({ kind: 'trying', route, attempt: i + 1, total: candidates.length });
    let adapted: AdaptedRoute | null = null;
    for (let waits = 0; ; waits++) {
      deps.signal?.throwIfAborted();
      try {
        adapted = await adapt(route.points, {
          start: target.start, mode: 'mi-inicio', targetKm: target.distanceKm,
          ...(target.elevGainM !== null ? { targetGainM: target.elevGainM } : {}),
        }, { ors: deps.ors, signal: deps.signal });
        break;
      } catch (e) {
        if (isAbort(e) || deps.signal?.aborted) throw e;
        if (e instanceof OrsError && e.kind === 'rate_minute' && waits < MAX_WAITS) {
          deps.onUpdate?.({ kind: 'waiting', seconds: RATE_WAIT_MS / 1000 });
          await wait(RATE_WAIT_MS, deps.signal);
          continue;
        }
        // Sin cuota del día o sin sesión no hay nada más que probar.
        if (e instanceof OrsError && (e.kind === 'quota_day' || e.kind === 'session' || e.kind === 'unreachable')) throw e;
        rejected.push({ route, motivo: e instanceof Error ? e.message : 'No se ha podido adaptar.' });
        break;
      }
    }
    if (!adapted) continue;
    if (adapted.rejected) {
      rejected.push({ route, motivo: adapted.rejected });
      continue;
    }
    const coords = adapted.coords;
    if (proposals.some((p) => overlap(coords, p.adapted.coords) > OVERLAP_LIMIT)) {
      rejected.push({ route, motivo: 'Repite casi el mismo recorrido que otra propuesta.' });
      continue;
    }
    const proposal = { route, adapted, motivo: item.motivo };
    proposals.push(proposal);
    deps.onUpdate?.({ kind: 'proposal', proposal });
  }
  return { proposals, rejected, candidates: ranked.length };
}
