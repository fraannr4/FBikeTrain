import type { Direccion } from '../ai/contracts';
import { directionName } from '../ai/references';
import type { LatLng } from '../domain/types';
import { haversineM } from '../import/summary';
import { rejectReason, type RouteCandidate } from './analyze';
import { bearingDeg } from './diversity';
import type { HistoryWaypoint } from './historyWaypoints';
import type { OsmWaypoint } from './sources/waypoints';

/** Puntos de paso del motor: de OSM o del historial local, con su rumbo desde el inicio. */

export type Waypoint = (OsmWaypoint | HistoryWaypoint) & { bearing: number; direccion: Direccion };
export type Combo = { id: string; waypointIds: string[]; direccion: Direccion; source: 'ia' | 'codigo'; titulo?: string };
export type EngineTarget = { distanceKm: number; elevGainM: number | null };

/** Cuánto más larga que la línea recta es una vuelta de carretera. */
export const ROAD_FACTOR = 1.3;
/** En carreteras de montaña la vuelta sale 1,6 a 1,9 veces la línea recta: hacen falta puntos cercanos. */
const BAND_MIN = 0.1;
const BAND_MAX = 0.42;
const DUPLICATE_M = 300;
const PAIR_GAP_MIN_DEG = 20;
const PAIR_GAP_MAX_DEG = 90;
const COMBO_TOLERANCE = 0.15;
const CLOSE_TOLERANCE = 0.05;
/** Lo que vale para la puntuación un punto del historial: el usuario ya lo elige. */
const HISTORY_INTEREST = 2;
const CLIMB_BONUS = 2;
/** Con desnivel estimado: lo que resta cada 10 % de más que se aleja del pedido, pasado un 10 % de margen. */
const GAIN_PENALTY = 10;
const GAIN_MARGIN = 0.1;
/**
 * Lo que resta una pareja con un punto mucho más cerca del inicio que el otro. Medido desde Caldes: esas
 * vueltas salen estrechas y repiten del 20 al 40 % de la carretera; las de puntos a distancia parecida, menos del 10 %.
 */
const UNBALANCED_PENALTY = 2;
const MAX_COMBOS = 16;
const DISTANCE_TOLERANCE = 0.1;
const ELEVATION_TOLERANCE = 0.25;
const EPS = 1e-6;

/** Distancias en línea recta a las que se buscan puntos de paso para una vuelta de `distanceKm`. */
export function waypointBand(distanceKm: number): { minM: number; maxM: number } {
  return { minM: BAND_MIN * distanceKm * 1000, maxM: BAND_MAX * distanceKm * 1000 };
}

const RING_STEP_DEG = 30;
/** Distancias del anillo, como fracción de la distancia pedida: con carreteras 1,5 a 1,9 veces la línea recta dan vueltas de una pareja o de un punto. */
const RING_FRACTIONS = [0.2, 0.28];

/**
 * Puntos de paso sin datos de OSM: un anillo de rumbos alrededor del inicio. ORS ajusta cada uno a la
 * carretera más próxima. Solo sirven cuando no hay puertos ni pueblos que elegir.
 */
export function ringWaypoints(start: LatLng, distanceKm: number): OsmWaypoint[] {
  const out: OsmWaypoint[] = [];
  for (const fraction of RING_FRACTIONS) {
    const distanceM = fraction * distanceKm * 1000;
    for (let deg = 0; deg < 360; deg += RING_STEP_DEG) {
      const rad = (deg * Math.PI) / 180;
      const lat = start.lat + (distanceM * Math.cos(rad)) / 111_320;
      const lng = start.lng + (distanceM * Math.sin(rad)) / (111_320 * Math.cos((start.lat * Math.PI) / 180));
      out.push({ id: `rumbo-${Math.round(fraction * 100)}-${deg}`, kind: 'pueblo', name: `rumbo ${directionName(deg)}`, lat, lng, ele: null, distanceM, interes: 0 });
    }
  }
  return out;
}

/** Puntos dentro de la banda, con rumbo y dirección. Los duplicados a menos de 300 m se quitan: gana el del historial. */
export function toWaypoints(start: LatLng, points: (OsmWaypoint | HistoryWaypoint)[], band: { minM: number; maxM: number }): Waypoint[] {
  const inBand = points.filter((p) => {
    const d = haversineM(start.lat, start.lng, p.lat, p.lng);
    return d >= band.minM && d <= band.maxM;
  });
  const kept = new Set<string>();
  const keptPoints: LatLng[] = [];
  const priority = [...inBand.filter((p) => p.kind === 'habitual'), ...inBand.filter((p) => p.kind !== 'habitual')];
  for (const p of priority) {
    if (keptPoints.some((k) => haversineM(k.lat, k.lng, p.lat, p.lng) < DUPLICATE_M)) continue;
    kept.add(p.id);
    keptPoints.push(p);
  }
  return inBand.filter((p) => kept.has(p.id)).map((p) => {
    const bearing = bearingDeg(start, p);
    return { ...p, bearing, direccion: directionName(bearing) };
  });
}

/** Km de la vuelta que sale del inicio, pasa por los puntos en orden y vuelve, con el factor de carretera. */
export function estimateLoopKm(start: LatLng, points: LatLng[], roadFactor: number = ROAD_FACTOR): number {
  const chain = [start, ...points, start];
  let m = 0;
  for (let i = 1; i < chain.length; i++) m += haversineM(chain[i - 1].lat, chain[i - 1].lng, chain[i].lat, chain[i].lng);
  return (m * roadFactor) / 1000;
}

/** Interés de un punto para puntuar: los del historial valen 2 porque el usuario ya los elige. */
export const interestOf = (w: Waypoint): number => (w.kind === 'habitual' ? HISTORY_INTEREST : w.interes);

export type RankedCombo = {
  combo: Combo; points: Waypoint[];
  /** Rumbo del punto más lejano: hacia donde irá la vuelta. */
  bearing: number;
  straightKm: number; estimateKm: number;
  /** Desnivel estimado, si se ha dado con qué estimarlo. */
  gainM: number | null;
  score: number; error: number;
};
export type RankOptions = {
  /** Cuánto más larga que la línea recta sale la vuelta; puede depender del rumbo. */
  roadFactor?: number | ((bearing: number) => number);
  /** Desnivel estimado de una vuelta. Con él se ordena por cercanía al pedido en vez de preferir puertos y cimas. */
  gainM?: (points: Waypoint[], estimateKm: number, bearing: number) => number | null;
  skip?: (candidate: { combo: Combo; points: Waypoint[]; bearing: number; estimateKm: number }) => boolean;
  /** Error admitido entre la estimación y la distancia pedida. */
  tolerance?: number;
};

const better = (x: RankedCombo, y: RankedCombo) => y.score - x.score || x.error - y.error || x.combo.id.localeCompare(y.combo.id);

/**
 * Combinaciones de 1 punto o de 2 con rumbos separados entre 20° y 90° (en el orden de giro) cuya estimación
 * cae dentro de la tolerancia, de mejor a peor: más interés, más cerca de la distancia y, con desnivel pedido,
 * más cerca del desnivel (o, sin forma de estimarlo, con más puertos y cimas).
 */
export function rankCombos(start: LatLng, waypoints: Waypoint[], target: EngineTarget, options: RankOptions = {}): RankedCombo[] {
  const { roadFactor = ROAD_FACTOR, tolerance = COMBO_TOLERANCE } = options;
  const ranked: RankedCombo[] = [];
  const consider = (points: Waypoint[], direccion: Direccion) => {
    const bearing = points.reduce((far, p) => (p.distanceM > far.distanceM ? p : far)).bearing;
    const straightKm = estimateLoopKm(start, points, 1);
    const estimateKm = straightKm * (typeof roadFactor === 'number' ? roadFactor : roadFactor(bearing));
    const error = Math.abs(estimateKm - target.distanceKm) / target.distanceKm;
    if (error > tolerance) return;
    const waypointIds = points.map((p) => p.id);
    const combo: Combo = { id: waypointIds.join('+'), waypointIds, direccion, source: 'codigo' };
    if (options.skip?.({ combo, points, bearing, estimateKm })) return;
    let score = points.reduce((sum, p) => sum + interestOf(p), 0);
    if (points.length === 2) {
      const [near, far] = points.map((p) => p.distanceM).sort((x, y) => x - y);
      score -= UNBALANCED_PENALTY * (1 - near / far);
    }
    const gainM = target.elevGainM !== null ? options.gainM?.(points, estimateKm, bearing) ?? null : null;
    if (target.elevGainM !== null) {
      if (gainM === null) score += CLIMB_BONUS * points.filter((p) => p.kind === 'puerto' || p.kind === 'cima').length;
      else score -= GAIN_PENALTY * Math.max(0, Math.abs(gainM - target.elevGainM) / target.elevGainM - GAIN_MARGIN);
    }
    if (error <= CLOSE_TOLERANCE) score += 1;
    ranked.push({ combo, points, bearing, straightKm, estimateKm, gainM, score, error });
  };

  for (const a of waypoints) {
    consider([a], a.direccion);
    for (const b of waypoints) {
      if (a === b) continue;
      const gap = (b.bearing - a.bearing + 360) % 360;
      if (gap >= PAIR_GAP_MIN_DEG && gap <= PAIR_GAP_MAX_DEG) consider([a, b], directionName(a.bearing + gap / 2));
    }
  }
  return ranked.sort(better);
}

/**
 * Las combinaciones de `rankCombos` repartidas por rumbo: primero la mejor de cada dirección, de más a menos
 * puntuación, y después la segunda mejor de cada una. Como mucho 16.
 */
export function codeCombos(start: LatLng, waypoints: Waypoint[], target: EngineTarget, roadFactor: number = ROAD_FACTOR): Combo[] {
  const byDirection = new Map<Direccion, RankedCombo[]>();
  for (const r of rankCombos(start, waypoints, target, { roadFactor })) {
    const list = byDirection.get(r.combo.direccion);
    if (list) list.push(r);
    else byDirection.set(r.combo.direccion, [r]);
  }
  const out: RankedCombo[] = [];
  for (let rank = 0; rank < 2; rank++) {
    out.push(...[...byDirection.values()].map((list) => list[rank]).filter((r): r is RankedCombo => !!r).sort(better));
  }
  return out.slice(0, MAX_COMBOS).map((r) => r.combo);
}

/** Línea de paso de una combinación: inicio, puntos (con entrada y salida del historial) e inicio. */
export function comboWaypoints(start: LatLng, combo: Combo, byId: ReadonlyMap<string, Waypoint>): LatLng[] {
  const line: LatLng[] = [start];
  for (const id of combo.waypointIds) {
    const w = byId.get(id);
    if (!w) continue;
    if (w.kind === 'habitual' && w.approach) line.push(w.approach);
    line.push({ lat: w.lat, lng: w.lng });
    if (w.kind === 'habitual' && w.departure) line.push(w.departure);
  }
  line.push(start);
  return line;
}

/**
 * La candidata cumple el filtro de carretera, la distancia ±10 % y, si se pidió, el desnivel ±25 %.
 * La longitud la decide aquí el ±10 %: el límite de `rejectReason` (+8 %) es más estricto y se ignora.
 */
export function fitsTarget(c: RouteCandidate, target: EngineTarget): boolean {
  const targetM = target.distanceKm * 1000;
  const reason = rejectReason(c, targetM);
  if (reason !== null && reason !== 'longitud') return false;
  if (Math.abs(c.distanceM - targetM) > DISTANCE_TOLERANCE * targetM + EPS) return false;
  if (target.elevGainM !== null && Math.abs(c.elevGainM - target.elevGainM) > ELEVATION_TOLERANCE * target.elevGainM + EPS) return false;
  return true;
}
