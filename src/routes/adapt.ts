import { abortError, isAbort } from '../ai/abort';
import type { Coord3, LatLng } from '../domain/types';
import { haversineM } from '../import/summary';
import { formatKm, formatMeters } from '../ui/format';
import { analyzeRoute, rejectReason, type RouteCandidate } from './analyze';
import { AIM_FRACTION, INITIAL_ROAD_FACTOR, MAX_INTENT_BACKTRACK, ROUND_TRIP_POINTS } from './generator';
import { orient } from './intent';
import { analyzeReferenceRoutePoints, RouteLibraryError, type RoutePoint } from './library';
import { fetchRoundTrip, OrsError, type OrsAccess, type OrsFeature } from './ors';
import { geometryQuality } from './quality';
import { fetchRoadPath } from './roadPath';
import { SPLICE } from './splice';
import { EXTEND_BELOW_PCT, TRIM_ABOVE_PCT } from './wikilocNearby';

/**
 * Adaptación de una ruta ajena (un GPX de Wikiloc) a lo que pide el usuario: salir de su inicio y
 * acercarse a la distancia pedida. El código decide dónde rotar, entrar, salir o cortar; las
 * carreteras nuevas las pone ORS y las cifras las calcula el código. Nada de esto pasa por la IA.
 */

/** Consultas a ORS como mucho por adaptación: cerrar el circuito, entrar, salir o recortar, y alargar. */
export const MAX_ADAPT_REQUESTS = 4;
/** Un circuito cierra a menos de esto, y si pasa a menos de esto del inicio se rota sin conectores. */
const NEAR_M = SPLICE.nearM;
/** Por debajo, se une directamente, sin pedir conector. */
const DIRECT_JOIN_M = SPLICE.directJoinM;
/** Supuesto: la carretera de vuelta mide un 25 % más que la línea recta. Solo sirve para elegir dónde cortar. */
const ROAD_DETOUR = 1.25;
/** Supuesto: el desnivel se avisa si se aparta más de un 20 % del pedido, medido sobre al menos 100 m. */
const GAIN_TOLERANCE = 0.2;
const GAIN_FLOOR_M = 100;

export type AdaptMode = 'mi-inicio' | 'inicio-ruta';
export type AdaptOptions = { start: LatLng; mode: AdaptMode; targetKm: number; targetGainM?: number };
export type AdaptDeps = { ors: OrsAccess; signal?: AbortSignal; road?: typeof fetchRoadPath };
export type AdaptedRoute = {
  coords: RoutePoint[];
  distanceM: number;
  /** `null` si falta la altitud en algún punto: no se inventa. */
  elevGainM: number | null;
  /** Carreteras de unión, cierre y regreso calculadas por ORS (sin la vuelta para alargar). */
  connectorM: number;
  /** Distancia mínima de la ruta original al inicio elegido. */
  passesNearM: number;
  /** El circuito se ha rotado para empezar en otro punto. */
  rotated: boolean;
  warnings: string[];
  /** Motivo, en castellano, por el que el resultado no es válido; nunca se presenta como bueno. */
  rejected?: string;
};

const gap = (a: LatLng, b: LatLng) => haversineM(a.lat, a.lng, b.lat, b.lng);

function lengthM(points: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += gap(points[i - 1], points[i]);
  return d;
}

/** Une tramos consecutivos quitando el punto repetido de cada unión. */
function join(...parts: RoutePoint[][]): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const part of parts) {
    if (part.length === 0) continue;
    out.push(...(out.length > 0 && gap(out[out.length - 1], part[0]) <= 1 ? part.slice(1) : part));
  }
  return out;
}

/** Último punto de corte cuya distancia, más la vuelta estimada, no pasa de `aimM`. */
function cutIndex(core: RoutePoint[], leadM: number, home: LatLng, aimM: number, returnsHome: boolean): { i: number; walkedM: number } | null {
  let walked = leadM;
  let best: { i: number; walkedM: number } | null = null;
  for (let i = 1; i < core.length; i++) {
    walked += gap(core[i - 1], core[i]);
    const back = returnsHome ? gap(core[i], home) * ROAD_DETOUR : 0;
    if (walked + back <= aimM) best = { i, walkedM: walked };
  }
  return best;
}

/**
 * `mi-inicio`: un circuito que pasa a menos de 300 m se rota; si no, se entra y se sale por
 * carretera (una ruta lineal, por su extremo más próximo). `inicio-ruta`: la ruta tal cual.
 * Después se recorta (más de un 8 % por encima) o se alarga con una vuelta de ORS (más de un 20 %
 * por debajo) y se valida. Los errores de cuota y de red de ORS se lanzan con su mensaje.
 */
export async function adaptRoute(points: RoutePoint[], opts: AdaptOptions, deps: AdaptDeps): Promise<AdaptedRoute> {
  const { start, mode, targetKm, targetGainM } = opts;
  if (points.length < 2 || points.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng))) throw new RangeError('La ruta necesita al menos dos puntos válidos.');
  if (!Number.isFinite(targetKm) || targetKm <= 0) throw new RangeError('La distancia pedida no es válida.');
  if (targetGainM !== undefined && (!Number.isFinite(targetGainM) || targetGainM < 0)) throw new RangeError('El desnivel pedido no es válido.');
  const { signal } = deps;
  const roadFn = deps.road ?? fetchRoadPath;
  const targetM = targetKm * 1000;
  /** Por encima se recorta y por debajo se alarga; fuera de este margen se avisa. */
  const trimAboveM = targetM * (1 + TRIM_ABOVE_PCT / 100);
  const extendBelowM = targetM * (1 - EXTEND_BELOW_PCT / 100);
  const warnings: string[] = [];
  let used = 0;
  let connectorM = 0;
  let rotated = false;
  const checkAbort = () => { if (signal?.aborted) throw abortError(); };
  checkAbort();

  const passesNearM = points.reduce((min, p) => Math.min(min, gap(start, p)), Infinity);

  /** Consulta a ORS dentro del presupuesto. Cuota, red y cancelación se lanzan; un trayecto no válido da su motivo. */
  async function ask<T>(call: () => Promise<T>): Promise<T | string> {
    checkAbort();
    if (used >= MAX_ADAPT_REQUESTS) return `no quedan consultas a ORS en esta adaptación (máximo ${MAX_ADAPT_REQUESTS}).`;
    used++;
    try {
      const result = await call();
      checkAbort();
      return result;
    } catch (e) {
      if (isAbort(e) || signal?.aborted) throw abortError();
      if (e instanceof OrsError && e.kind !== 'no_route') throw e;
      return e instanceof Error ? e.message : 'El motor no ha dado un trayecto válido.';
    }
  }

  async function road(from: LatLng, to: LatLng): Promise<RoutePoint[] | string> {
    const path = await ask(() => roadFn(deps.ors, [from, to], signal));
    if (typeof path !== 'string') connectorM += lengthM(path);
    return path;
  }

  /** Vuelta de ORS desde el inicio para alargar; descartada si no es de carretera o no sale del inicio. */
  async function extension(home: LatLng, missingM: number): Promise<RoutePoint[] | string> {
    const lengthReq = missingM / INITIAL_ROAD_FACTOR;
    const f = await ask<OrsFeature>(() => fetchRoundTrip(deps.ors, { start: { lat: home.lat, lng: home.lng }, lengthM: lengthReq, points: ROUND_TRIP_POINTS, seed: 0, signal }));
    if (typeof f === 'string') return f;
    let candidate: RouteCandidate;
    try { candidate = analyzeRoute(f, 0); } catch { return 'el motor no ha dado datos del firme y del tipo de vía.'; }
    const reason = rejectReason(candidate, lengthReq);
    if (reason && reason !== 'longitud') return `la vuelta de ORS no es de carretera (${reason}).`;
    const loop = candidate.coords.map(([lng, lat, ele]): RoutePoint => ({ lat, lng, ...(Number.isFinite(ele) ? { ele } : {}) }));
    if (loop.length < 2 || gap(loop[0], home) > SPLICE.maxGapM || gap(loop[loop.length - 1], home) > SPLICE.maxGapM) return 'la vuelta de ORS no sale del inicio.';
    return loop;
  }

  function finish(coords: RoutePoint[], rejected?: string): AdaptedRoute {
    const distanceM = lengthM(coords);
    let elevGainM: number | null = null;
    let reason = rejected;
    try {
      elevGainM = analyzeReferenceRoutePoints(coords).elevGainM;
    } catch (e) {
      // Saltos de más de 5 km, coordenadas o alturas no válidas: la ruta no se puede presentar.
      if (!(e instanceof RouteLibraryError)) throw e;
      reason ??= e.message;
    }
    if (!reason) {
      const { backtrackM } = geometryQuality(coords.map((p): Coord3 => [p.lng, p.lat, p.ele ?? 0]));
      if (backtrackM > distanceM * MAX_INTENT_BACKTRACK) {
        reason = `Repite ${formatKm(backtrackM, 1)} en sentido contrario (más del ${Math.round(MAX_INTENT_BACKTRACK * 100)} %): sería ir y volver por la misma carretera.`;
      }
    }
    if (distanceM > trimAboveM || distanceM < extendBelowM) {
      warnings.push(`Queda en ${formatKm(distanceM)} frente a ${formatKm(targetM)} pedidos.`);
    }
    if (targetGainM !== undefined) {
      if (elevGainM === null) warnings.push('Falta la altitud en algún punto: no se puede comparar el desnivel.');
      else if (Math.abs(elevGainM - targetGainM) > GAIN_TOLERANCE * Math.max(targetGainM, GAIN_FLOOR_M)) {
        warnings.push(`Desnivel de ${formatMeters(elevGainM)} frente a ${formatMeters(targetGainM)} pedidos.`);
      }
    }
    return { coords, distanceM, elevGainM, connectorM, passesNearM, rotated, warnings, ...(reason ? { rejected: reason } : {}) };
  }

  // 1. La ruta orientada: circuito rotado hacia el inicio o ruta lineal por su extremo más próximo.
  const closed = points.length > 2 && gap(points[0], points[points.length - 1]) <= NEAR_M;
  let core = points;
  if (mode === 'mi-inicio') {
    if (closed) {
      if (gap(points[0], points[points.length - 1]) > DIRECT_JOIN_M) {
        const closing = await road(points[points.length - 1], points[0]);
        if (typeof closing === 'string') return finish(points, `No se puede cerrar el circuito por carretera: ${closing}`);
        core = join(points, closing);
      }
      const ring = orient(core, start, NEAR_M);
      rotated = ring[0] !== core[0];
      core = ring;
    } else if (gap(start, points[points.length - 1]) < gap(start, points[0])) {
      core = [...points].reverse();
      warnings.push('Se recorre al revés para entrar por el extremo más próximo: comprueba que no haya sentidos únicos.');
    }
  }

  // 2. Entrada por carretera desde el inicio, si la ruta no pasa cerca o es lineal.
  const viaConnectors = mode === 'mi-inicio' && !(closed && passesNearM < NEAR_M);
  let lead: RoutePoint[] = [];
  if (viaConnectors && gap(start, core[0]) > DIRECT_JOIN_M) {
    const into = await road(start, core[0]);
    if (typeof into === 'string') return finish(core, `No hay conexión por carretera desde tu inicio: ${into}`);
    lead = into;
  }
  const home = lead[0] ?? core[0];
  const returnsHome = mode === 'mi-inicio' || closed;

  // 3. Recorte: se corta la ruta y el regreso por carretera sale del punto de corte.
  const leadM = lengthM(lead);
  const exit = core[core.length - 1];
  const estimateM = leadM + lengthM(core) + (returnsHome ? gap(exit, home) * ROAD_DETOUR : 0);
  let body = core;
  if (estimateM > trimAboveM) {
    const cut = cutIndex(core, leadM, home, targetM * AIM_FRACTION, returnsHome);
    if (!cut) warnings.push(`No se puede recortar a ${formatKm(targetM)}: la entrada a la ruta ya se acerca a esa distancia.`);
    else {
      body = core.slice(0, cut.i + 1);
      warnings.push(`Se recorta en el km ${formatKm(cut.walkedM).replace(' km', '')}${returnsHome ? ' y se vuelve al inicio por carretera' : ''}.`);
    }
  }

  // 4. Regreso al inicio por carretera.
  let tail: RoutePoint[] = [];
  if (returnsHome && gap(body[body.length - 1], home) > DIRECT_JOIN_M) {
    const back = await road(body[body.length - 1], home);
    if (typeof back === 'string') return finish(join(lead, body), `No hay regreso por carretera hasta el inicio: ${back}`);
    tail = back;
  }
  let route = join(lead, body, tail);

  // 5. Alargado con una vuelta de ORS desde el inicio de la longitud que falta.
  const totalM = lengthM(route);
  if (totalM < extendBelowM) {
    const extra = await extension(route[0], targetM * AIM_FRACTION - totalM);
    if (typeof extra === 'string') warnings.push(`No se ha podido alargar: ${extra}`);
    else {
      route = join(extra, route);
      warnings.push(`Se alarga con una vuelta de ${formatKm(lengthM(extra))} desde el inicio.`);
    }
  }
  return finish(route);
}
