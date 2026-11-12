import type { LatLng } from '../../domain/types';
import { haversineM } from '../../import/summary';
import { adaptCandidates, overlap, OVERLAP_LIMIT, type AdaptCandidate, type Proposal, type RecommendDeps, type RecommendTarget, type RecommendUpdate, type Rejected } from '../catalog/recommend';
import { analyzeReferenceRoutePoints, routePointsToGpx, type ReferenceRoute } from '../library';
import { rankForTarget } from '../rank';
import { RwgpsError } from './ridewithgps';
import { fetchRwgpsNearby, fetchRwgpsRoute, type RwgpsAccess, type RwgpsNearbyRoute } from './rwgpsImport';

/**
 * Propuestas desde la colección común de Ride with GPS: se buscan las rutas que pasan por la zona,
 * se ordenan por los km y el desnivel pedidos, se eligen en direcciones distintas y se adaptan
 * para salir y volver al inicio. Solo se descarga el track de las que se intentan adaptar.
 */

/** Radios de búsqueda, de menos a más, hasta tener bastantes candidatas. */
export const NEARBY_RADII_KM = [5, 15, 30] as const;
const ENOUGH_CANDIDATES = 10;
export const MIN_PROPOSALS = 5;
export const MAX_PROPOSALS = 6;
/** Candidatas que se intentan adaptar como mucho: cada una gasta una lectura de Ride with GPS y hasta 4 consultas a ORS. */
export const MAX_RWGPS_ATTEMPTS = 12;
/** Separación mínima entre direcciones: primero 45°, después 25° y por último solo que no se solapen. */
const BEARING_STEPS = [45, 25, 0];

export type RwgpsProposalUpdate = { kind: 'searching'; radiusKm: number } | RecommendUpdate;
export type RwgpsProposalDeps = Omit<RecommendDeps, 'onUpdate'> & { rwgps: RwgpsAccess; onUpdate?: (u: RwgpsProposalUpdate) => void };
export type RwgpsProposalResult = {
  proposals: Proposal[];
  rejected: Rejected[];
  /** Rutas de la colección que pasan por la zona, y cuántas tienen una distancia aprovechable. */
  nearby: number;
  candidates: number;
  radiusKm: number;
};

/** Rumbo de `from` a `to`, en grados: 0 norte, 90 este. */
export function bearingDeg(from: LatLng, to: LatLng): number {
  const rad = Math.PI / 180;
  const y = Math.sin((to.lng - from.lng) * rad) * Math.cos(to.lat * rad);
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lng - from.lng) * rad);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

/** Hacia dónde va una ruta: el rumbo desde el inicio a su punto más lejano. */
export function routeBearing(line: LatLng[], start: LatLng): number {
  let far = line[0];
  let farM = -1;
  for (const p of line) {
    const d = haversineM(start.lat, start.lng, p.lat, p.lng);
    if (d > farM) { farM = d; far = p; }
  }
  return bearingDeg(start, far);
}

const angleGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const sameRoute = (a: LatLng[], b: LatLng[]) => Math.max(overlap(a, b), overlap(b, a)) > OVERLAP_LIMIT;

type Ranked = { route: RwgpsNearbyRoute; motivo: string; bearing: number };

/**
 * Orden de intento: primero las mejores separadas 45° entre sí, luego las que caben a 25° y luego las
 * que solo no repiten recorrido. Las que repiten el recorrido de otra elegida no entran nunca.
 */
function diverseOrder(ranked: Ranked[]): Ranked[] {
  const chosen: Ranked[] = [];
  for (const minGap of BEARING_STEPS) {
    for (const item of ranked) {
      if (chosen.includes(item)) continue;
      if (chosen.some((c) => angleGap(c.bearing, item.bearing) < minGap || sameRoute(item.route.line, c.route.line))) continue;
      chosen.push(item);
    }
  }
  return chosen;
}

function toReferenceRoute(r: Awaited<ReturnType<typeof fetchRwgpsRoute>>): ReferenceRoute {
  const now = Date.now();
  const ref = `rwgps-${r.id}`;
  return {
    id: ref, name: r.name, format: 'gpx', sourceFileName: `${ref}.gpx`, sourceUrl: r.sourceUrl, author: `${r.author} en Ride with GPS`,
    originalXml: routePointsToGpx(r.name, r.points), originalPoints: r.points.map((p) => ({ ...p })), points: r.points,
    summary: analyzeReferenceRoutePoints(r.points), catalog: { kind: 'rwgps', ref, tipo: 'carretera' }, createdAt: now, updatedAt: now,
  };
}

export async function proposeRwgpsRoutes(target: RecommendTarget, deps: RwgpsProposalDeps): Promise<RwgpsProposalResult> {
  const { rwgps, signal } = deps;
  let found: RwgpsNearbyRoute[] = [];
  let radiusKm: number = NEARBY_RADII_KM[0];
  for (const r of NEARBY_RADII_KM) {
    signal?.throwIfAborted();
    radiusKm = r;
    deps.onUpdate?.({ kind: 'searching', radiusKm: r });
    found = (await fetchRwgpsNearby(rwgps, { start: target.start, radiusKm: r, distanceKm: Math.round(target.distanceKm) }, signal)).routes;
    if (found.length >= ENOUGH_CANDIDATES) break;
  }

  const cards = found.map((route) => ({ id: route.id, km: route.distanceM / 1000, desnivelM: route.elevGainM, route }));
  const { ranked } = rankForTarget(cards, { distanceKm: target.distanceKm, ...(target.elevGainM !== null ? { elevGainM: target.elevGainM } : {}) }, null);
  const ordered = diverseOrder(ranked.map(({ card, motivo }) => ({ route: card.route, motivo, bearing: routeBearing(card.route.line, target.start) })));

  const candidates = ordered.map(({ route, motivo }): AdaptCandidate => ({
    id: route.id, name: route.name, motivo,
    load: async () => {
      try {
        return toReferenceRoute(await fetchRwgpsRoute(route.id, rwgps, signal));
      } catch (e) {
        // Una ruta que ya no es pública o no tiene track deja paso a la siguiente; sesión o cuota, no.
        if (e instanceof RwgpsError && !e.fatal) return e.message;
        throw e;
      }
    },
  }));
  const { proposals, rejected } = await adaptCandidates(candidates, target, deps, { want: MAX_PROPOSALS, maxAttempts: MAX_RWGPS_ATTEMPTS });
  return { proposals, rejected, nearby: found.length, candidates: ranked.length, radiusKm };
}
