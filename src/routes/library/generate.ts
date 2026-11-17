import { abortError, isAbort } from '../../ai/abort';
import type { Coord3, LatLng } from '../../domain/types';
import { haversineM } from '../../import/summary';
import type { UserReference } from '../../metrics/reference';
import type { Target } from '../../metrics/score';
import { formatMeters, formatNumber } from '../../ui/format';
import { adaptRoute, MAX_ADAPT_REQUESTS, type AdaptedRoute } from '../adapt';
import { accessRoughM, analyzeRoute, rejectReason, unknownSurfaceOffRoadPct, type RejectReason, type RouteCandidate } from '../analyze';
import { sleep } from '../catalog/recommend';
import { MAX_INTENT_BACKTRACK, rateCandidate, type GeneratedRoute } from '../generator';
import { visitsWaypoints } from '../intent';
import { analyzeReferenceRoutePoints, routePointsToGpx, type ParsedReferenceRoute, type RoutePoint } from '../library';
import { fetchPathFeature, OrsError, type OrsAccess, type OrsFeature } from '../ors';
import { geometryQuality } from '../quality';
import { cellOverlap, OVERLAP_LIMIT } from './cells.ts';
import { buildRing, candidateRings, loopPerimeterM, type Ring, type RingOptions } from './ring.ts';
import { SPARSE_ZONE_ROUTES, type LibraryFill, type LibraryRoute, type LibrarySearch, type LibraryZone } from './schema.ts';

/**
 * Generador de rutas sobre la biblioteca común: hasta 2 rutas reales de la zona adaptadas al inicio
 * (B) y vueltas nuevas por las celdas más transitadas del mapa de calor (A). Las carreteras las pone
 * ORS y las cifras las calcula el código; aquí no interviene la IA. Funciones puras con dependencias
 * inyectadas: los anillos se consultan de dos en dos y nunca se pasa del presupuesto.
 */

export const GENERATOR_ORS_BUDGET = 20;
/** Consultas que pueden gastar las rutas de la biblioteca (adaptaciones y re-trazados). */
export const LIBRARY_ORS_BUDGET = 8;
/** Anillos que se consultan a la vez. */
export const RING_LANES = 2;
export const MAX_LIBRARY_PROPOSALS = 2;
export const MIN_PROPOSALS = 3;
export const MAX_PROPOSALS = 5;
export const LENGTH_TOLERANCE = 0.1;
export const GAIN_TOLERANCE = 0.25;
/** Un re-trazado vale si comparte al menos esta fracción de celdas con la ruta adaptada. */
export const RETRACE_MIN_OVERLAP = 0.6;
/** Puntos de paso del re-trazado: el máximo que admite ORS. */
const RETRACE_POINTS = 8;
/** Tramos sin dato de firme fuera de carretera admitidos (%). */
const MAX_UNKNOWN_OFFROAD_PCT = 20;
/** Esperas por el límite por minuto como mucho en una búsqueda. */
const MAX_WAITS = 2;
const MAX_WAIT_S = 60;
/** Fallos del servidor de ORS seguidos, sin ninguna respuesta buena antes, que dan el motor por caído. */
const OUTAGE_FAILS = 3;
export const ORS_DOWN = 'El motor de rutas (openrouteservice) no responde ahora mismo. No depende de ti ni de tu zona: prueba de nuevo en unos minutos.';

export function libraryRadiusM(distanceKm: number): number {
  return Math.round(Math.min(40_000, Math.max(8_000, 0.45 * distanceKm * 1000)));
}

export type GeneratorTarget = { start: LatLng; distanceKm: number; elevGainM: number | null };
export type GeneratorCard =
  | { kind: 'biblioteca'; id: string; route: LibraryRoute; adapted: AdaptedRoute }
  | { kind: 'nueva'; id: string; route: GeneratedRoute };
/** Por qué no vale una vuelta nueva ya calculada. */
export type DiscardReason = RejectReason | 'no pasa por sus puntos' | 'firme desconocido' | 'desnivel' | 'ida y vuelta' | 'repetida';
export type GeneratorUpdate =
  | { kind: 'library' } | { kind: 'library-ready'; routes: number; cells: number; fill: LibraryFill }
  | { kind: 'discarded'; reason: DiscardReason; distanceM: number; elevGainM: number }
  | { kind: 'trying'; used: number; budget: number } | { kind: 'waiting'; seconds: number } | { kind: 'card'; card: GeneratorCard };
export type GeneratorDeps = {
  ors: OrsAccess; library: (search: LibrarySearch, signal?: AbortSignal) => Promise<LibraryZone>;
  reference: UserReference | null; visited: ReadonlySet<string>; signal?: AbortSignal; onUpdate?: (u: GeneratorUpdate) => void;
  fetchPath?: typeof fetchPathFeature; adapt?: typeof adaptRoute; wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
};
export type GeneratorResult = {
  cards: GeneratorCard[]; warnings: string[]; requestsUsed: number;
  zone: { routes: number; cells: number; factor: number; fill: LibraryFill } | null;
};

/**
 * ORS ajusta cada punto de paso a la carretera más próxima, hasta 350 m: una casa o una celda del mapa de
 * calor no están sobre el eje de la carretera. Con los 50 m de `visitsWaypoints` se descartaban todas.
 */
export const WAYPOINT_SNAP_M = 400;

/** Tramo de salida y de llegada (m) cuyo firme no descarta la vuelta: es el acceso a la casa, igual en todas. */
export const START_ACCESS_M = 1500;

/**
 * Filtro de carretera de `rejectReason` sin la longitud: sin autopista, ≤ 100 m sin asfaltar y de pista, ≤ 20 % principal.
 * `access` son los metros malos del acceso al inicio (`accessRoughM`), que no cuentan.
 */
export function meetsRoad(c: RouteCandidate, access: { unpavedM: number; trackM: number } = { unpavedM: 0, trackM: 0 }): boolean {
  return rejectReason({ ...c, unpavedM: c.unpavedM - access.unpavedM, trackM: c.trackM - access.trackM }, c.distanceM) === null;
}

/** ±10 % en km; ±25 % en desnivel si se pide (un desnivel desconocido no cumple). */
export function meetsTarget(distanceM: number, elevGainM: number | null, target: GeneratorTarget): boolean {
  const wantedM = target.distanceKm * 1000;
  if (Math.abs(distanceM - wantedM) > LENGTH_TOLERANCE * wantedM) return false;
  if (target.elevGainM === null) return true;
  return elevGainM !== null && Math.abs(elevGainM - target.elevGainM) <= GAIN_TOLERANCE * target.elevGainM;
}

export const SOURCE_NAMES: Record<LibraryRoute['source'], string | null> = {
  rwgps: 'Ride with GPS', komoot: 'Komoot', bikemap: 'Bikemap', wikiloc: 'Wikiloc', strava: 'Strava', other: null,
};

/** Ruta de la biblioteca como referencia de la biblioteca personal, para la tarjeta y «Guardar» (como `toReferenceRoute`). */
export function toParsedReference(route: LibraryRoute): ParsedReferenceRoute {
  const points: RoutePoint[] = route.line.map(([lng, lat, ele]) => ({ lat, lng, ...(ele !== undefined ? { ele } : {}) }));
  const rwgpsId = route.source === 'rwgps' ? /ridewithgps\.com\/routes\/(\d+)/.exec(route.url)?.[1] : undefined;
  const ref = rwgpsId ? `rwgps-${rwgpsId}` : `${route.source}-${route.id}`;
  const sourceName = SOURCE_NAMES[route.source];
  const author = route.author ? (sourceName ? `${route.author} en ${sourceName}` : route.author) : undefined;
  return {
    name: route.name, format: 'gpx', sourceFileName: `${ref}.gpx`, sourceUrl: route.url, ...(author ? { author } : {}),
    originalXml: routePointsToGpx(route.name, points), originalPoints: points.map(p => ({ ...p })), points,
    summary: analyzeReferenceRoutePoints(points), ...(rwgpsId ? { catalog: { kind: 'rwgps' as const, ref, tipo: 'carretera' as const } } : {}),
  };
}

/** Error de ORS que impide seguir (cuota diaria, sesión, sin conexión): se conserva lo aceptado. */
class StopSearch {
  constructor(public error: OrsError) {}
}

const toLatLng = (coords: Coord3[]): LatLng[] => coords.map(([lng, lat]) => ({ lat, lng }));

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** `count` puntos repartidos por distancia a lo largo de la línea; el primero y el último, `start`. */
function retracePoints(line: LatLng[], start: LatLng, count: number): LatLng[] {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversineM(line[i - 1].lat, line[i - 1].lng, line[i].lat, line[i].lng));
  const total = cum[cum.length - 1];
  const out: LatLng[] = [start];
  let i = 1;
  for (let j = 1; j < count - 1; j++) {
    const at = (total * j) / (count - 1);
    while (i < line.length - 1 && cum[i] < at) i++;
    const seg = cum[i] - cum[i - 1];
    const f = seg === 0 ? 0 : (at - cum[i - 1]) / seg;
    out.push({ lat: line[i - 1].lat + (line[i].lat - line[i - 1].lat) * f, lng: line[i - 1].lng + (line[i].lng - line[i - 1].lng) * f });
  }
  out.push(start);
  return out;
}

/** Candidata medida; `null` si ORS no trae los datos del firme y del tipo de vía. */
function candidateOf(f: OrsFeature, seed: number): RouteCandidate | null {
  const extras = f.properties.extras;
  if (!extras?.surface?.summary.length || !extras.waytypes || !extras.steepness) return null;
  return analyzeRoute(f, seed);
}

function emptyZoneWarning(fill: LibraryFill): string {
  const base = 'No hay rutas de referencia en esta zona todavía. Sin ellas no proponemos vueltas, porque saldrían de mala calidad.';
  return fill === 'unavailable' ? `${base} Además, no se ha podido buscar en Ride with GPS: vuelve a probar más tarde.` : base;
}

export async function generateProposals(target: GeneratorTarget, deps: GeneratorDeps): Promise<GeneratorResult> {
  const { start, distanceKm, elevGainM } = target;
  const { ors, signal, onUpdate } = deps;
  const fetchPath = deps.fetchPath ?? fetchPathFeature;
  const adapt = deps.adapt ?? adaptRoute;
  const wait = deps.wait ?? sleep;
  const targetM = distanceKm * 1000;
  const checkAbort = () => { if (signal?.aborted) throw abortError(); };

  checkAbort();
  onUpdate?.({ kind: 'library' });
  const zone = await deps.library({ lat: start.lat, lon: start.lng, radiusM: libraryRadiusM(distanceKm), distanceKm, elevGainM }, signal);
  checkAbort();
  const zoneInfo = { routes: zone.routeCount, cells: zone.cells.length, factor: zone.zoneFactor, fill: zone.fill };
  onUpdate?.({ kind: 'library-ready', routes: zone.routeCount, cells: zone.cells.length, fill: zone.fill });
  if (zone.routes.length === 0 && zone.cells.length === 0) {
    return { cards: [], warnings: [emptyZoneWarning(zone.fill)], requestsUsed: 0, zone: zoneInfo };
  }

  const warnings: string[] = [];
  const libraryCards: GeneratorCard[] = [];
  const newCards: Extract<GeneratorCard, { kind: 'nueva' }>[] = [];
  const acceptedLines: LatLng[][] = [];
  const scoreTarget: Target = { distanceM: targetM, elevGainM, preferNew: true };
  let used = 0;
  let waits = 0;
  /** Desnivel más alto entre las que daban la distancia, para explicar un desnivel imposible. */
  let bestGain: number | null = null;
  const total = () => libraryCards.length + newCards.length;
  const overlapsAccepted = (line: LatLng[]) => acceptedLines.some(a => cellOverlap(line, a) >= OVERLAP_LIMIT);
  const noteGain = (dM: number, gain: number | null) => {
    if (gain !== null && Math.abs(dM - targetM) <= LENGTH_TOLERANCE * targetM) bestGain = Math.max(bestGain ?? 0, gain);
  };
  const accept = (card: GeneratorCard, line: LatLng[]) => {
    acceptedLines.push(line);
    if (card.kind === 'nueva') newCards.push(card);
    else libraryCards.push(card);
    onUpdate?.({ kind: 'card', card });
  };

  /**
   * Reglas ante un fallo de ORS: el límite por minuto espera lo que dice el servicio (`'retry'`);
   * sin ruta o un fallo del servidor dan `'skip'` (se pasa a la siguiente); el resto corta la búsqueda.
   */
  let serverFails = 0;
  let answered = false;
  async function onOrsError(e: unknown): Promise<'retry' | 'skip'> {
    if (isAbort(e) || signal?.aborted) throw abortError();
    if (!(e instanceof OrsError)) throw e;
    if (e.kind === 'rate_minute' && waits < MAX_WAITS) {
      waits++;
      const seconds = e.retryAfterS === undefined ? MAX_WAIT_S : Math.min(MAX_WAIT_S, e.retryAfterS + 1);
      onUpdate?.({ kind: 'waiting', seconds });
      await wait(seconds * 1000, signal);
      return 'retry';
    }
    // Un fallo suelto del servidor se salta; varios seguidos sin una sola respuesta son una caída: no se gasta el resto.
    if (e.kind === 'server' && !answered && ++serverFails >= OUTAGE_FAILS) throw new StopSearch(new OrsError('server', ORS_DOWN, e.code));
    if (e.kind === 'no_route' || e.kind === 'server' || e.kind === 'bad_request') return 'skip';
    throw new StopSearch(e);
  }

  /** Una llamada a ORS con sus reglas: tras la espera del límite por minuto se repite; si no, `null`. */
  async function withOrs<T>(call: () => Promise<T>): Promise<T | null> {
    for (;;) {
      checkAbort();
      try {
        return await call();
      } catch (e) {
        if (await onOrsError(e) === 'skip') return null;
      }
    }
  }

  /** Una consulta de trayecto dentro del presupuesto; la que se repite por el límite por minuto no gasta. */
  async function ask(waypoints: LatLng[]): Promise<OrsFeature | null> {
    if (used >= GENERATOR_ORS_BUDGET) return null;
    return withOrs(async () => {
      used++;
      onUpdate?.({ kind: 'trying', used, budget: GENERATOR_ORS_BUDGET });
      try {
        const feature = await fetchPath(ors, waypoints, signal);
        answered = true;
        return feature;
      } catch (e) {
        if (e instanceof OrsError && e.kind === 'rate_minute') used--;
        throw e;
      }
    });
  }

  /** B: el re-trazado por ORS mide el firme y la carretera principal de una ruta que no viene de ORS. */
  async function retraceOk(coords: RoutePoint[]): Promise<boolean> {
    const f = await ask(retracePoints(coords, start, RETRACE_POINTS));
    const c = f && candidateOf(f, 0);
    return !!f && !!c && meetsRoad(c, accessRoughM(f, START_ACCESS_M)) && cellOverlap(toLatLng(c.coords), coords) >= RETRACE_MIN_OVERLAP;
  }

  async function libraryPass() {
    let spent = 0;
    for (const route of zone.routes) {
      if (libraryCards.length >= MAX_LIBRARY_PROPOSALS) return;
      // Una adaptación puede gastar MAX_ADAPT_REQUESTS y el re-trazado una más.
      if (spent + MAX_ADAPT_REQUESTS + 1 > LIBRARY_ORS_BUDGET) return;
      const points: RoutePoint[] = route.line.map(([lng, lat, ele]) => ({ lat, lng, ...(ele !== undefined ? { ele } : {}) }));
      let adapted: AdaptedRoute;
      try {
        checkAbort();
        adapted = await adapt(points, { start, mode: 'mi-inicio', targetKm: distanceKm, targetGainM: elevGainM ?? undefined }, { ors, signal });
      } catch (e) {
        // La adaptación no dice cuántas consultas hizo antes del fallo: se cuentan todas las posibles.
        if (e instanceof OrsError) {
          spent += MAX_ADAPT_REQUESTS;
          used += MAX_ADAPT_REQUESTS;
          onUpdate?.({ kind: 'trying', used, budget: GENERATOR_ORS_BUDGET });
        }
        // No se repite: tras la espera del límite por minuto se pasa a la siguiente ruta.
        await onOrsError(e);
        continue;
      }
      spent += adapted.requestsUsed;
      used += adapted.requestsUsed;
      onUpdate?.({ kind: 'trying', used, budget: GENERATOR_ORS_BUDGET });
      noteGain(adapted.distanceM, adapted.elevGainM);
      if (adapted.rejected || !meetsTarget(adapted.distanceM, adapted.elevGainM, target) || overlapsAccepted(adapted.coords)) continue;
      const before = used;
      const ok = await retraceOk(adapted.coords);
      spent += used - before;
      if (ok) accept({ kind: 'biblioteca', id: `biblioteca-${route.id}`, route, adapted }, adapted.coords);
    }
  }

  /** A: vale si pasa por sus puntos, hay firme, es de carretera, cumple el objetivo, no retrocede y no repite otra. */
  function consider(f: OrsFeature, c: RouteCandidate, ring: Ring): boolean {
    noteGain(c.distanceM, c.elevGainM);
    const line = toLatLng(c.coords);
    const access = accessRoughM(f, START_ACCESS_M);
    const reason: DiscardReason | null = !visitsWaypoints(c.coords, [start, ...ring.waypoints, start], WAYPOINT_SNAP_M) ? 'no pasa por sus puntos'
      : unknownSurfaceOffRoadPct(f) > MAX_UNKNOWN_OFFROAD_PCT ? 'firme desconocido'
      : !meetsRoad(c, access) ? rejectReason({ ...c, unpavedM: c.unpavedM - access.unpavedM, trackM: c.trackM - access.trackM }, c.distanceM) ?? 'sin asfaltar'
      : !meetsTarget(c.distanceM, c.elevGainM, target) ? (Math.abs(c.distanceM - targetM) > LENGTH_TOLERANCE * targetM ? 'longitud' : 'desnivel')
      : geometryQuality(c.coords).backtrackM > MAX_INTENT_BACKTRACK * c.distanceM ? 'ida y vuelta'
      : overlapsAccepted(line) ? 'repetida' : null;
    if (reason) {
      onUpdate?.({ kind: 'discarded', reason, distanceM: c.distanceM, elevGainM: c.elevGainM });
      return false;
    }
    accept({ kind: 'nueva', id: `nueva-${newCards.length + 1}`, route: rateCandidate(c, scoreTarget, deps) }, line);
    return true;
  }

  /** Factores medidos: km reales entre el perímetro del polígono pedido. */
  const factors: number[] = [];
  async function measure(ring: Ring, seed: number): Promise<{ f: OrsFeature; c: RouteCandidate; factor: number } | null> {
    const f = await ask([start, ...ring.waypoints, start]);
    const c = f && candidateOf(f, seed);
    if (!f || !c) return null;
    const factor = c.distanceM / loopPerimeterM([start, ...ring.waypoints]);
    factors.push(factor);
    return { f, c, factor };
  }

  /** Como mucho 2 consultas por anillo: la primera y, si se desvía más de un 10 %, la corrección con el factor medido. */
  async function tryRing(ring: Ring, opts: RingOptions, seed: number) {
    const first = await measure(ring, seed);
    if (!first || consider(first.f, first.c, ring)) return;
    if (Math.abs(first.c.distanceM - targetM) <= LENGTH_TOLERANCE * targetM) return;
    const corrected = buildRing(start, zone.cells, ring.axisDeg, ring.k, { ...opts, factor: first.factor });
    if (!corrected) return;
    const second = await measure(corrected, seed + 1);
    if (second) consider(second.f, second.c, corrected);
  }

  // Sin desnivel pedido, los anillos se ordenan por la subida habitual de quien busca, no solo por lo transitado.
  const ref = deps.reference;
  const usualClimbMPerKm = ref && ref.avgDistanceM > 0 ? ref.avgElevGainM / (ref.avgDistanceM / 1000) : null;
  async function ringPasses() {
    const sparse = zone.routeCount < SPARSE_ZONE_ROUTES;
    const tried = new Set<string>();
    let seed = 0;
    for (const broad of [false, true]) {
      if (broad && total() >= MIN_PROPOSALS) return;
      while (total() < MAX_PROPOSALS && used < GENERATOR_ORS_BUDGET) {
        const opts: RingOptions = { distanceKm, factor: factors.length ? median(factors) : zone.zoneFactor, elevGainM, sparse, broad, usualClimbMPerKm };
        // Varios anillos a la vez: la búsqueda tarda la mitad y gasta las mismas consultas.
        const lanes = Math.min(RING_LANES, MAX_PROPOSALS - total());
        const rings = candidateRings(start, zone.cells, opts).filter(r => !tried.has(`${broad}:${r.axisDeg}:${r.k}`)).slice(0, lanes);
        if (!rings.length) break;
        await Promise.all(rings.map(ring => {
          tried.add(`${broad}:${ring.axisDeg}:${ring.k}`);
          const s = seed;
          seed += 2;
          return tryRing(ring, opts, s);
        }));
      }
    }
  }

  let down = false;
  try {
    await libraryPass();
    await ringPasses();
  } catch (e) {
    if (!(e instanceof StopSearch)) throw e;
    warnings.push(e.error.message);
    down = e.error.message === ORS_DOWN;
  }

  const cards: GeneratorCard[] = [...libraryCards, ...newCards.sort((a, b) => b.route.score - a.route.score)];
  // Con el motor caído no se ha podido juzgar ninguna vuelta: no se culpa a la distancia ni a la carretera.
  if (cards.length < MIN_PROPOSALS && !down) {
    const km = `«${formatNumber(distanceKm, Number.isInteger(distanceKm) ? 0 : 1)} km ±10 %»`;
    const goal = elevGainM === null ? km : `${km} y «${formatMeters(elevGainM)} ±25 %»`;
    const n = cards.length;
    const parts = [n === 0 ? `Ninguna vuelta cumple ${goal} por carretera asfaltada.` : `Solo ${n === 1 ? 'una vuelta cumple' : `${n} vueltas cumplen`} ${goal} por carretera asfaltada.`];
    if (elevGainM !== null && bestGain !== null) parts.push(`Con la distancia pedida, el desnivel más alto conseguido es de ${formatMeters(bestGain)}.`);
    if (used >= GENERATOR_ORS_BUDGET) parts.push(`Se ha llegado al límite de ${GENERATOR_ORS_BUDGET} consultas a ORS de esta búsqueda.`);
    warnings.push(parts.join(' '));
  }
  return { cards, warnings, requestsUsed: used, zone: zoneInfo };
}
