import { isAbort } from '../ai/abort';
import type { Direccion } from '../ai/contracts';
import { combineWaypoints, type SharedWaypointPlanner } from '../ai/waypointCombos';
import type { Coord3, LatLng } from '../domain/types';
import { haversineM } from '../import/summary';
import type { UserReference } from '../metrics/reference';
import type { Target } from '../metrics/score';
import { analyzeRoute, rejectReason, roughSpots, type RouteCandidate, unknownSurfaceOffRoadPct } from './analyze';
import { RATE_WAIT_MS, sleep, type Proposal, type RecommendTarget } from './catalog/recommend';
import { angleGap, fitsDiversity, MIN_HEADING_GAP_DEG, routeBearing } from './diversity';
import { generateRoutes, MAX_INTENT_BACKTRACK, rateCandidate, type GeneratedRoute } from './generator';
import type { HistoryWaypoint } from './historyWaypoints';
import { visitsWaypoints } from './intent';
import { fetchPathFeature, fetchRoundTrip, OrsError, type OrsErrorKind, type OrsFeature } from './ors';
import { geometryQuality } from './quality';
import { routeSide } from './side';
import { RwgpsError } from './sources/ridewithgps';
import { MAX_PROPOSALS, MIN_PROPOSALS, proposeRwgpsRoutes, type RwgpsProposalDeps, type RwgpsProposalUpdate } from './sources/rwgpsProposals';
import type { OsmWaypoint } from './sources/waypoints';
import { comboWaypoints, estimateLoopKm, fitsTarget, rankCombos, ringWaypoints, ROAD_FACTOR, toWaypoints, waypointBand, type Combo, type EngineTarget, type Waypoint } from './waypointEngine';

/**
 * «Rutas cerca»: primero las rutas reales de la colección común que encajan y después las del motor,
 * que encadena puntos de paso (puertos, cimas, pueblos, tramos habituales) con ORS. Si faltan, vueltas
 * circulares. Todas pasan el filtro de carretera, el objetivo (±10 % km, ±25 % desnivel) y la diversidad.
 */

/** Consultas a ORS del motor en una búsqueda (las de adaptar rutas de Ride with GPS van aparte). */
export const NEARBY_ORS_BUDGET = 14;
/** Retroceso admitido en una vuelta por una cima en fondo de saco: se sube y se baja por la misma carretera. */
export const DEAD_END_BACKTRACK = 0.3;
/** Esperas por el límite por minuto en toda la búsqueda antes de dar el motor por cortado. */
const MAX_RATE_WAITS = 3;
/** Una combinación cuya estimación corregida queda más lejos que esto de la distancia pedida no se pide. */
const ESTIMATE_TOLERANCE = 0.12;
/** Lo medido en una vuelta vale para las combinaciones cuyo rumbo queda a menos de esto: las carreteras de un mismo lado se parecen. */
const LOCAL_DEG = 60;
/** Metros de subida por km que no explican las cotas de los puntos (el terreno ondula), antes de medirlo. */
const UNDULATION_PRIOR = 10;
/** Con el desnivel ya medido hacia un rumbo, no se pide una combinación cuya estimación se aleja más que esto del pedido. */
const GAIN_ESTIMATE_TOLERANCE = 0.35;
/** Puntos de pista que se piden evitar a ORS, como mucho (el límite del servicio). */
const MAX_AVOID = 12;
/** Dos puntos de pista a menos de esto son el mismo tramo. */
const SAME_SPOT_M = 150;
/** Pistas a menos de esto de la salida no se piden evitar: todas las vueltas pasan por allí y ORS se queda sin ruta. */
const AVOID_CLEAR_START_M = 2000;
/** El móvil no espera más que esto a Overpass: el servidor sigue y lo deja en caché para la siguiente búsqueda. */
const WAYPOINTS_WAIT_MS = 20_000;
/** Consultas por dirección: si tres combinaciones hacia el mismo lado no valen, se deja ese lado. */
const MAX_TRIES_PER_DIRECTION = 3;
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
  /** Puntos de paso cuando OSM no da ninguno; por defecto, un anillo de rumbos (`ringWaypoints`). */
  fallbackWaypoints?: (start: LatLng, distanceKm: number) => OsmWaypoint[];
  /** Lo que se espera a los puntos de OSM antes de seguir sin ellos; por defecto 20 s. */
  waypointsWaitMs?: number;
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
  let rateWaits = 0;
  /**
   * Límite por minuto del servicio de rutas: espera con cuenta atrás y repite la misma consulta, tanto en las
   * vueltas por puntos de paso como en las circulares. La consulta rechazada no gasta presupuesto.
   */
  const patient = async <T>(call: () => Promise<T>): Promise<T> => {
    for (;;) {
      signal?.throwIfAborted();
      try {
        return await call();
      } catch (e) {
        if (signal?.aborted || !(e instanceof OrsError) || e.kind !== 'rate_minute' || rateWaits >= MAX_RATE_WAITS) throw e;
        rateWaits++;
        deps.onUpdate?.({ kind: 'waiting', seconds: RATE_WAIT_MS / 1000 });
        await wait(RATE_WAIT_MS, signal);
      }
    }
  };

  // Los puntos de paso de OSM (lentos en frío) y los del historial se piden ya, a la vez que las rutas reales.
  const band = waypointBand(distanceKm);
  let waitTimer: ReturnType<typeof setTimeout> | undefined;
  const tooSlow = new Promise<never>((_, reject) => {
    waitTimer = setTimeout(() => reject(new Error('lento')), deps.waypointsWaitMs ?? WAYPOINTS_WAIT_MS);
  });
  const loading = Promise.allSettled([
    deps.findWaypoints
      ? Promise.race([deps.findWaypoints(start, searchRadiusM(band.maxM), signal), tooSlow]).finally(() => clearTimeout(waitTimer))
      : Promise.resolve([]),
    deps.historyWaypoints ? deps.historyWaypoints(start, band, signal) : Promise.resolve([]),
  ]);

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

  // 2. Puntos de paso de OSM y del historial; si falla uno se sigue con el otro.
  const [osm, history] = await loading;
  signal?.throwIfAborted();
  for (const r of [osm, history]) if (r.status === 'rejected' && isAbort(r.reason)) throw r.reason;
  if (history.status === 'rejected') warnings.push('No se ha podido leer tu historial: se sigue con los puertos y pueblos de la zona.');
  const found = [
    ...(osm.status === 'fulfilled' ? osm.value : []),
    ...(history.status === 'fulfilled' ? history.value : []),
  ];
  let waypoints = toWaypoints(start, found, band);
  // Sin puntos de OSM (servicio caído, lento o zona vacía) se usan puntos por rumbo: ORS los ajusta a carretera.
  if (osm.status === 'rejected' || waypoints.length === 0) {
    waypoints = toWaypoints(start, [...found, ...(deps.fallbackWaypoints ?? ringWaypoints)(start, distanceKm)], band);
    warnings.push(osm.status === 'rejected'
      ? 'No se han podido cargar a tiempo los puertos, cimas y pueblos de la zona: se usan puntos por rumbo alrededor del inicio.'
      : `No hay puertos, cimas, pueblos ni tramos habituales entre ${fmt(band.minM / 1000)} y ${fmt(band.maxM / 1000)} km del inicio: se usan puntos por rumbo alrededor del inicio.`);
  }
  deps.onUpdate?.({ kind: 'waypoints', count: waypoints.length });

  // 3. Combinaciones: las de la IA primero, completadas con las del código.
  const combined = await combineWaypoints(start, waypoints, engineTarget, deps.ai, signal);
  usedAi = combined.usedAi;

  // 4. De una en una. Cada respuesta de ORS enseña cuánto se alarga la carretera y cuánto ondula el terreno
  // hacia ese rumbo, y con eso se elige la siguiente combinación: así no se gastan consultas en vueltas que
  // van a salir largas, con demasiado desnivel o hacia un lado ya ocupado.
  const byId = new Map(waypoints.map((w) => [w.id, w]));
  const fetchPath = deps.fetchPath ?? fetchPathFeature;
  type Sample = { bearing: number; factor: number; undulation: number };
  const samples: Sample[] = [];
  /** Cota del inicio, de la primera respuesta de ORS. */
  let baseEle: number | null = null;
  /** Rumbos de las vueltas ya elegidas. */
  const taken = lines.map((l) => routeBearing(l, start));
  const triedKeys = new Set<string>();
  const triesByDirection = new Map<Direccion, number>();
  const aiCombos = combined.combos.filter((c) => c.source === 'ia');
  let tried = 0;
  let stopped = false;

  const keyOf = (combo: Combo) => [...combo.waypointIds].sort().join('|');
  const informed = (bearing: number) => samples.some((s) => angleGap(s.bearing, bearing) <= LOCAL_DEG);
  /** Media de las dos medidas más próximas en rumbo; sin ninguna cerca, la mediana de todas; sin medidas, `prior`. */
  const learned = (bearing: number, value: (s: Sample) => number, prior: number): number => {
    const near = samples.filter((s) => angleGap(s.bearing, bearing) <= LOCAL_DEG)
      .sort((x, y) => angleGap(x.bearing, bearing) - angleGap(y.bearing, bearing)).slice(0, 2);
    return near.length ? near.reduce((sum, s) => sum + value(s), 0) / near.length : median(samples.map(value), prior);
  };
  const roadFactor = (bearing: number) => learned(bearing, (s) => s.factor, ROAD_FACTOR);
  /** Subida que explican las cotas: del inicio a cada punto con cota conocida y de vuelta. */
  const climbM = (points: Waypoint[], base: number): number => {
    let prev = base;
    let sum = 0;
    for (const ele of [...points.map((p) => p.ele), base]) {
      if (ele === null) continue;
      sum += Math.max(0, ele - prev);
      prev = ele;
    }
    return sum;
  };
  const gainOf = (points: Waypoint[], km: number, bearing: number): number | null =>
    baseEle === null ? null : climbM(points, baseEle) + learned(bearing, (s) => s.undulation, UNDULATION_PRIOR) * km;
  const skip = (c: { combo: Combo; points: Waypoint[]; bearing: number; estimateKm: number }): boolean => {
    if (triedKeys.has(keyOf(c.combo)) || (triesByDirection.get(c.combo.direccion) ?? 0) >= MAX_TRIES_PER_DIRECTION) return true;
    if (taken.some((h) => angleGap(h, c.bearing) < MIN_HEADING_GAP_DEG)) return true;
    if (elevGainM === null || !informed(c.bearing)) return false;
    const gain = gainOf(c.points, c.estimateKm, c.bearing);
    return gain !== null && Math.abs(gain - elevGainM) > GAIN_ESTIMATE_TOLERANCE * elevGainM;
  };
  type Pick = { combo: Combo; points: Waypoint[]; bearing: number; straightKm: number };
  /** Primero lo que propuso la IA; después la mejor del código, antes hacia donde ya se ha medido la carretera. */
  const pick = (): Pick | null => {
    for (const combo of aiCombos) {
      const points = combo.waypointIds.map((id) => byId.get(id)).filter((w): w is Waypoint => !!w);
      if (points.length === 0) continue;
      const bearing = points.reduce((far, p) => (p.distanceM > far.distanceM ? p : far)).bearing;
      const straightKm = estimateLoopKm(start, points, 1);
      const estimateKm = straightKm * roadFactor(bearing);
      if (Math.abs(estimateKm - distanceKm) > ESTIMATE_TOLERANCE * distanceKm || skip({ combo, points, bearing, estimateKm })) continue;
      return { combo, points, bearing, straightKm };
    }
    const ranked = rankCombos(start, waypoints, engineTarget, { roadFactor, gainM: gainOf, skip, tolerance: ESTIMATE_TOLERANCE });
    return ranked.find((r) => informed(r.bearing)) ?? ranked[0] ?? null;
  };

  /** Pistas vistas en las respuestas de ORS: las consultas siguientes las evitan. */
  let avoid: LatLng[] = [];
  /** Apunta las pistas nuevas de una vuelta descartada por pista o por tierra; `true` si había alguna. */
  const learnTracks = (f: OrsFeature): boolean => {
    const reason = rejectReason(analyzeRoute(f, tried), distanceKm * 1000);
    if (reason !== 'pistas' && reason !== 'sin asfaltar') return false;
    const fresh = roughSpots(f).filter((s) => haversineM(start.lat, start.lng, s.lat, s.lng) >= AVOID_CLEAR_START_M
      && !avoid.some((a) => haversineM(a.lat, a.lng, s.lat, s.lng) < SAME_SPOT_M));
    if (fresh.length === 0) return false;
    avoid = [...avoid, ...fresh].slice(-MAX_AVOID);
    return true;
  };

  const evaluate = (next: Pick, line: LatLng[], f: OrsFeature): MotorCard | null => {
    const coords = f.geometry.coordinates;
    if (!visitsWaypoints(coords, line)) return null;
    const c = analyzeRoute(f, tried);
    if (next.straightKm > 0 && c.distanceM > 0) {
      const km = c.distanceM / 1000;
      baseEle ??= coords[0]?.[2] ?? null;
      samples.push({ bearing: next.bearing, factor: km / next.straightKm, undulation: baseEle === null ? UNDULATION_PRIOR : Math.max(0, (c.elevGainM - climbM(next.points, baseEle)) / km) });
    }
    if (!hasSurfaceData(f) || unknownSurfaceOffRoadPct(f) > MAX_UNKNOWN_SURFACE_PCT) return null;
    const deadEnd = next.points.some((w) => w.kind === 'cima' && w.deadEnd);
    if (geometryQuality(coords).backtrackM > c.distanceM * (deadEnd ? DEAD_END_BACKTRACK : MAX_INTENT_BACKTRACK)) return null;
    noteGain(c);
    if (!fitsTarget(c, engineTarget) || !fitsDiversity(toLine(coords), start, lines)) return null;
    // Los tramos del historial no se nombran con su posición.
    const via = next.points.map((w) => (w.kind === 'habitual' ? 'tramo habitual' : w.name));
    return { kind: 'motor', route: rateCandidate(c, scoreTarget, deps), via, combo: next.combo.source };
  };

  while (!stopped && used < NEARBY_ORS_BUDGET && slots() > 0) {
    const next = pick();
    if (!next) break;
    triedKeys.add(keyOf(next.combo));
    triesByDirection.set(next.combo.direccion, (triesByDirection.get(next.combo.direccion) ?? 0) + 1);
    const line = comboWaypoints(start, next.combo, byId);

    let card: MotorCard | null = null;
    // Cada combinación se pide como mucho dos veces: se repite cuando la vuelta sale con una pista que la
    // segunda consulta ya puede evitar.
    // Si los cuadrados que evitar dejan a ORS sin ruta, la misma combinación se repite una vez sin ellos.
    let skipAvoid = false;
    for (let attempt = 0; attempt < 2 && !stopped && used < NEARBY_ORS_BUDGET; attempt++) {
      signal?.throwIfAborted();
      used++;
      let f: OrsFeature;
      const sent = skipAvoid ? [] : avoid;
      try {
        f = await patient(() => fetchPath(deps.ors, line, signal, sent.length ? sent : undefined));
      } catch (e) {
        if (isAbort(e) || signal?.aborted) throw e;
        if (!(e instanceof OrsError)) throw e;
        // Solo pasa una vez por combinación: después `sent` va vacío.
        if (e.kind === 'no_route' && sent.length) { skipAvoid = true; attempt--; continue; }
        // Sin cuota, sin sesión, sin conexión o con las esperas agotadas se corta y se conserva lo aceptado;
        // una combinación sin ruta deja paso a la siguiente.
        if (STOP_KINDS.has(e.kind) || e.kind === 'rate_minute') {
          if (e.kind === 'rate_minute') used--;
          warnings.push(e.message);
          stopped = true;
        }
        break;
      }
      card = evaluate(next, line, f);
      if (card || !learnTracks(f)) break;
    }
    tried++;
    if (card) {
      const accepted = toLine(card.route.coords);
      motor.push(card);
      lines.push(accepted);
      taken.push(routeBearing(accepted, start));
      deps.onUpdate?.({ kind: 'card', card });
    }
    deps.onUpdate?.({ kind: 'engine', tried, accepted: motor.length, budget: NEARBY_ORS_BUDGET });
  }

  // 5. Si faltan, vueltas circulares hacia los lados libres con lo que queda del presupuesto.
  if (!stopped && acceptedCount() < MIN_PROPOSALS && used < NEARBY_ORS_BUDGET) {
    try {
      const res = await (deps.generate ?? generateRoutes)(
        { start, target: scoreTarget, count: slots(), usedSides: lines.map((l) => routeSide(toCoords(l), start)), budget: NEARBY_ORS_BUDGET - used },
        { apiKey: deps.ors, reference: deps.reference, visited: deps.visited, signal,
          fetchRoundTrip: (access, r, fetchImpl) => patient(() => fetchRoundTrip(access, r, fetchImpl)) },
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
