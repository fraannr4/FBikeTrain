import { isAbort } from '../ai/abort';
import type { Direccion } from '../ai/contracts';
import { directionName } from '../ai/references';
import { combineWaypoints, type SharedWaypointPlanner } from '../ai/waypointCombos';
import type { Coord3, LatLng } from '../domain/types';
import type { UserReference } from '../metrics/reference';
import type { Target } from '../metrics/score';
import { analyzeRoute, type RouteCandidate } from './analyze';
import { RATE_WAIT_MS, sleep, type Proposal, type RecommendTarget } from './catalog/recommend';
import { fitsDiversity, routeBearing } from './diversity';
import { generateRoutes, MAX_INTENT_BACKTRACK, rateCandidate, type GeneratedRoute } from './generator';
import type { HistoryWaypoint } from './historyWaypoints';
import { visitsWaypoints } from './intent';
import { fetchPathFeature, OrsError, type OrsErrorKind, type OrsFeature } from './ors';
import { geometryQuality } from './quality';
import { routeSide } from './side';
import { RwgpsError } from './sources/ridewithgps';
import { MAX_PROPOSALS, MIN_PROPOSALS, proposeRwgpsRoutes, type RwgpsProposalDeps, type RwgpsProposalUpdate } from './sources/rwgpsProposals';
import type { OsmWaypoint } from './sources/waypoints';
import { comboWaypoints, estimateLoopKm, fitsTarget, ROAD_FACTOR, toWaypoints, waypointBand, type Combo, type EngineTarget, type Waypoint } from './waypointEngine';

/**
 * «Rutas cerca»: primero las rutas reales de la colección común que encajan y después las del motor,
 * que encadena puntos de paso (puertos, cimas, pueblos, tramos habituales) con ORS. Si faltan, vueltas
 * circulares. Todas pasan el filtro de carretera, el objetivo (±10 % km, ±25 % desnivel) y la diversidad.
 */

/** Consultas a ORS del motor en una búsqueda (las de adaptar rutas de Ride with GPS van aparte). */
export const NEARBY_ORS_BUDGET = 14;
/** Retroceso admitido en una vuelta por una cima en fondo de saco: se sube y se baja por la misma carretera. */
export const DEAD_END_BACKTRACK = 0.3;
/** Esperas por el límite por minuto antes de dar el motor por cortado. */
const MAX_RATE_WAITS = 3;
/** Una combinación cuya estimación corregida queda más lejos que esto de la distancia pedida no se pide. */
const ESTIMATE_TOLERANCE = 0.12;
const RADIUS_STEP_M = 5_000;
const MIN_RADIUS_M = 8_000;
const MAX_RADIUS_M = 35_000;
/** Una ruta dirigida necesita datos de firme: sin ellos no se puede validar como carretera. */
const MAX_UNKNOWN_SURFACE_PCT = 20;
/** Errores de ORS tras los que no tiene sentido seguir pidiendo. */
const STOP_KINDS: ReadonlySet<OrsErrorKind> = new Set(['quota_day', 'session', 'unreachable']);

export type NearbyTarget = RecommendTarget;
export type NearbyCard =
  | { kind: 'real'; source: 'rwgps'; proposal: Proposal }
  | { kind: 'motor'; route: GeneratedRoute; via: string[]; combo: 'ia' | 'codigo' | 'vuelta' };
export type NearbyUpdate =
  | RwgpsProposalUpdate
  | { kind: 'waypoints'; count: number }
  | { kind: 'engine'; tried: number; accepted: number; budget: number }
  | { kind: 'waiting'; seconds: number }
  /** Tarjeta aceptada: la pantalla la enseña ya y la conserva si se cancela la búsqueda. */
  | { kind: 'card'; card: NearbyCard };
export type NearbyDeps = Omit<RwgpsProposalDeps, 'onUpdate'> & {
  onUpdate?: (u: NearbyUpdate) => void;
  reference: UserReference | null;
  visited: ReadonlySet<string>;
  /** Sin esta fuente (o sin la del historial) se sigue con la otra. */
  findWaypoints?: (start: LatLng, radiusM: number, signal?: AbortSignal) => Promise<OsmWaypoint[]>;
  historyWaypoints?: (start: LatLng, band: { minM: number; maxM: number }, signal?: AbortSignal) => Promise<HistoryWaypoint[]>;
  ai: SharedWaypointPlanner | null;
  fetchPath?: typeof fetchPathFeature;
  generate?: typeof generateRoutes;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
};
export type NearbyResult = { cards: NearbyCard[]; warnings: string[]; requestsUsed: number; usedAi: boolean };

type MotorCard = Extract<NearbyCard, { kind: 'motor' }>;

const toLine = (coords: Coord3[]): LatLng[] => coords.map(([lng, lat]) => ({ lat, lng }));
const toCoords = (line: LatLng[]): Coord3[] => line.map((p) => [p.lng, p.lat, 0]);
const fmt = (x: number) => x.toLocaleString('es-ES', { maximumFractionDigits: 1 });

function median(xs: number[], fallback: number): number {
  if (xs.length === 0) return fallback;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Radio de búsqueda de OSM: el borde exterior de la banda, redondeado hacia arriba a 5 km, entre 8 y 35 km. */
function searchRadiusM(maxM: number): number {
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.ceil(maxM / RADIUS_STEP_M) * RADIUS_STEP_M));
}

const hasSurfaceData = (f: OrsFeature) => !!f.properties.extras.surface?.summary.length && !!f.properties.extras.waytypes?.summary.length;

export async function proposeNearbyRoutes(target: NearbyTarget, deps: NearbyDeps): Promise<NearbyResult> {
  const { start, distanceKm, elevGainM } = target;
  const { signal } = deps;
  const wait = deps.wait ?? sleep;
  const engineTarget: EngineTarget = { distanceKm, elevGainM };
  const lengthOnly: EngineTarget = { distanceKm, elevGainM: null };
  const scoreTarget: Target = { distanceM: distanceKm * 1000, elevGainM, preferNew: true };
  const warnings: string[] = [];
  const real: Extract<NearbyCard, { kind: 'real' }>[] = [];
  const motor: MotorCard[] = [];
  /** Recorridos ya elegidos (reales y del motor), para la diversidad. */
  const lines: LatLng[][] = [];
  let used = 0;
  let usedAi = false;
  /** Desnivel más alto de las vueltas que cumplían todo menos el desnivel. */
  let bestGainM = -Infinity;
  const acceptedCount = () => real.length + motor.length;
  const slots = () => MAX_PROPOSALS - acceptedCount();
  const result = (): NearbyResult => ({
    cards: [...real, ...[...motor].sort((a, b) => b.route.score - a.route.score)],
    warnings, requestsUsed: used, usedAi,
  });
  const noteGain = (c: RouteCandidate) => { if (fitsTarget(c, lengthOnly)) bestGainM = Math.max(bestGainM, c.elevGainM); };

  // 1. Rutas reales de la colección común.
  try {
    const { proposals } = await proposeRwgpsRoutes(target, deps);
    for (const proposal of proposals) {
      if (slots() <= 0) break;
      if (!fitsDiversity(proposal.adapted.coords, start, lines)) continue;
      const card = { kind: 'real', source: 'rwgps', proposal } as const;
      real.push(card);
      lines.push(proposal.adapted.coords);
      deps.onUpdate?.({ kind: 'card', card });
    }
  } catch (e) {
    if (isAbort(e) || signal?.aborted) throw e;
    if (e instanceof OrsError && STOP_KINDS.has(e.kind)) {
      warnings.push(e.message);
      return result();
    }
    // Ride with GPS caído, sin desplegar o sin cuota: el motor no depende de él.
    if (!(e instanceof RwgpsError)) throw e;
    warnings.push(e.message);
  }

  // 2. Puntos de paso de OSM y del historial, a la vez; si falla uno se sigue con el otro.
  const band = waypointBand(distanceKm);
  const [osm, history] = await Promise.allSettled([
    deps.findWaypoints ? deps.findWaypoints(start, searchRadiusM(band.maxM), signal) : Promise.resolve([]),
    deps.historyWaypoints ? deps.historyWaypoints(start, band, signal) : Promise.resolve([]),
  ]);
  signal?.throwIfAborted();
  for (const r of [osm, history]) if (r.status === 'rejected' && isAbort(r.reason)) throw r.reason;
  if (osm.status === 'rejected') warnings.push('No se han podido cargar los puertos, cimas y pueblos de la zona: se sigue con tu historial y con vueltas circulares.');
  if (history.status === 'rejected') warnings.push('No se ha podido leer tu historial: se sigue con los puertos y pueblos de la zona.');
  const waypoints = toWaypoints(start, [
    ...(osm.status === 'fulfilled' ? osm.value : []),
    ...(history.status === 'fulfilled' ? history.value : []),
  ], band);
  deps.onUpdate?.({ kind: 'waypoints', count: waypoints.length });
  if (waypoints.length === 0) {
    warnings.push(`No hay puertos, cimas, pueblos ni tramos habituales entre ${fmt(band.minM / 1000)} y ${fmt(band.maxM / 1000)} km del inicio: se buscan vueltas circulares.`);
  }

  // 3. Combinaciones: las de la IA primero, completadas con las del código.
  const combined = await combineWaypoints(start, waypoints, engineTarget, deps.ai, signal);
  usedAi = combined.usedAi;

  // 4. Cada combinación, de una en una, convertida en vuelta por ORS.
  const byId = new Map(waypoints.map((w) => [w.id, w]));
  const occupied = new Set<Direccion>(real.map((c) => directionName(routeBearing(c.proposal.adapted.coords, start))));
  const factors: number[] = [];
  const fetchPath = deps.fetchPath ?? fetchPathFeature;
  let tried = 0;
  let stopped = false;

  const evaluate = (combo: Combo, points: LatLng[], straightKm: number, f: OrsFeature): MotorCard | null => {
    const coords = f.geometry.coordinates;
    if (!visitsWaypoints(coords, points)) return null;
    const c = analyzeRoute(f, tried);
    if (straightKm > 0) factors.push(c.distanceM / 1000 / straightKm);
    if (!hasSurfaceData(f) || c.unknownSurfacePct > MAX_UNKNOWN_SURFACE_PCT) return null;
    const comboPoints = combo.waypointIds.map((id) => byId.get(id)).filter((w): w is Waypoint => !!w);
    const deadEnd = comboPoints.some((w) => w.kind === 'cima' && w.deadEnd);
    if (geometryQuality(coords).backtrackM > c.distanceM * (deadEnd ? DEAD_END_BACKTRACK : MAX_INTENT_BACKTRACK)) return null;
    noteGain(c);
    if (!fitsTarget(c, engineTarget) || !fitsDiversity(toLine(coords), start, lines)) return null;
    // Los tramos del historial no se nombran con su posición.
    const via = comboPoints.map((w) => (w.kind === 'habitual' ? 'tramo habitual' : w.name));
    return { kind: 'motor', route: rateCandidate(c, scoreTarget, deps), via, combo: combo.source };
  };

  for (const combo of combined.combos) {
    if (stopped || used >= NEARBY_ORS_BUDGET || slots() <= 0) break;
    if (occupied.has(combo.direccion)) continue;
    const points = comboWaypoints(start, combo, byId);
    const straightKm = estimateLoopKm(start, points.slice(1, -1), 1);
    const estimateKm = straightKm * median(factors, ROAD_FACTOR);
    if (Math.abs(estimateKm - distanceKm) > ESTIMATE_TOLERANCE * distanceKm) continue;

    let f: OrsFeature | null = null;
    for (let waits = 0; ; waits++) {
      signal?.throwIfAborted();
      used++;
      try {
        f = await fetchPath(deps.ors, points, signal);
        break;
      } catch (e) {
        if (isAbort(e) || signal?.aborted) throw e;
        if (!(e instanceof OrsError)) throw e;
        if (e.kind === 'rate_minute' && waits < MAX_RATE_WAITS && used < NEARBY_ORS_BUDGET) {
          deps.onUpdate?.({ kind: 'waiting', seconds: RATE_WAIT_MS / 1000 });
          await wait(RATE_WAIT_MS, signal);
          continue;
        }
        // Sin cuota, sin sesión o sin conexión se corta y se conserva lo aceptado; una combinación sin ruta deja paso a la siguiente.
        if (STOP_KINDS.has(e.kind) || e.kind === 'rate_minute') {
          warnings.push(e.message);
          stopped = true;
        }
        break;
      }
    }
    tried++;
    const card = f ? evaluate(combo, points, straightKm, f) : null;
    if (card) {
      motor.push(card);
      lines.push(toLine(card.route.coords));
      occupied.add(combo.direccion);
      deps.onUpdate?.({ kind: 'card', card });
    }
    deps.onUpdate?.({ kind: 'engine', tried, accepted: motor.length, budget: NEARBY_ORS_BUDGET });
  }

  // 5. Si faltan, vueltas circulares hacia los lados libres con lo que queda del presupuesto.
  if (!stopped && acceptedCount() < MIN_PROPOSALS && used < NEARBY_ORS_BUDGET) {
    try {
      const res = await (deps.generate ?? generateRoutes)(
        { start, target: scoreTarget, count: slots(), usedSides: lines.map((l) => routeSide(toCoords(l), start)), budget: NEARBY_ORS_BUDGET - used },
        { apiKey: deps.ors, reference: deps.reference, visited: deps.visited, signal },
      );
      used += res.requestsUsed;
      for (const route of res.routes) {
        if (slots() <= 0) break;
        noteGain(route);
        const line = toLine(route.coords);
        if (!fitsTarget(route, engineTarget) || !fitsDiversity(line, start, lines)) continue;
        const card: MotorCard = { kind: 'motor', route, via: [], combo: 'vuelta' };
        motor.push(card);
        lines.push(line);
        deps.onUpdate?.({ kind: 'card', card });
      }
      if (res.stoppedBy) warnings.push(res.stoppedBy.message);
    } catch (e) {
      if (isAbort(e) || signal?.aborted) throw e;
      if (!(e instanceof OrsError)) throw e;
      warnings.push(e.message);
    }
  }

  // 6. Menos de las pedidas: cuántas cumplen y, con desnivel, el más alto conseguido.
  const count = acceptedCount();
  if (count < MIN_PROPOSALS) {
    const goal = `${fmt(distanceKm)} km ±10 %${elevGainM !== null ? ` y ${fmt(elevGainM)} m de desnivel ±25 %` : ''}`;
    let text = `${count === 1 ? 'Solo 1 vuelta cumple' : `Solo ${count} vueltas cumplen`} ${goal} en direcciones distintas, de las ${MIN_PROPOSALS} buscadas.`;
    if (elevGainM !== null && Number.isFinite(bestGainM)) text += ` El desnivel más alto conseguido en la zona es ${fmt(Math.round(bestGainM))} m.`;
    if (used >= NEARBY_ORS_BUDGET) text += ' Se ha llegado al límite de consultas de una búsqueda.';
    warnings.push(text);
  }
  return result();
}
