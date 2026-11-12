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
const BAND_MIN = 0.15;
const BAND_MAX = 0.42;
const DUPLICATE_M = 300;
const PAIR_GAP_MIN_DEG = 20;
const PAIR_GAP_MAX_DEG = 90;
const COMBO_TOLERANCE = 0.15;
const CLOSE_TOLERANCE = 0.05;
/** Lo que vale para la puntuación un punto del historial: el usuario ya lo elige. */
const HISTORY_INTEREST = 2;
const CLIMB_BONUS = 2;
const MAX_COMBOS = 16;
const DISTANCE_TOLERANCE = 0.1;
const ELEVATION_TOLERANCE = 0.25;
const EPS = 1e-6;

/** Distancias en línea recta a las que se buscan puntos de paso para una vuelta de `distanceKm`. */
export function waypointBand(distanceKm: number): { minM: number; maxM: number } {
  return { minM: BAND_MIN * distanceKm * 1000, maxM: BAND_MAX * distanceKm * 1000 };
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

type Scored = { combo: Combo; score: number; error: number };

/**
 * Combinaciones de 1 punto o de 2 con rumbos separados entre 20° y 90° (en el orden de giro). Entran las que
 * estiman la distancia pedida ±15 %. En cada dirección gana la que pasa por los puntos de más interés y,
 * con desnivel pedido, por más puertos y cimas.
 */
export function codeCombos(start: LatLng, waypoints: Waypoint[], target: EngineTarget, roadFactor: number = ROAD_FACTOR): Combo[] {
  const scored: Scored[] = [];
  const consider = (points: Waypoint[], direccion: Direccion) => {
    const km = estimateLoopKm(start, points, roadFactor);
    const error = Math.abs(km - target.distanceKm) / target.distanceKm;
    if (error > COMBO_TOLERANCE) return;
    let score = points.reduce((sum, p) => sum + interestOf(p), 0);
    if (target.elevGainM !== null) score += CLIMB_BONUS * points.filter((p) => p.kind === 'puerto' || p.kind === 'cima').length;
    if (error <= CLOSE_TOLERANCE) score += 1;
    const waypointIds = points.map((p) => p.id);
    scored.push({ combo: { id: waypointIds.join('+'), waypointIds, direccion, source: 'codigo' }, score, error });
  };

  for (const a of waypoints) {
    consider([a], a.direccion);
    for (const b of waypoints) {
      if (a === b) continue;
      const gap = (b.bearing - a.bearing + 360) % 360;
      if (gap >= PAIR_GAP_MIN_DEG && gap <= PAIR_GAP_MAX_DEG) consider([a, b], directionName(a.bearing + gap / 2));
    }
  }

  const better = (x: Scored, y: Scored) => y.score - x.score || x.error - y.error || x.combo.id.localeCompare(y.combo.id);
  const byDirection = new Map<Direccion, Scored[]>();
  for (const s of scored) {
    const list = byDirection.get(s.combo.direccion);
    if (list) list.push(s);
    else byDirection.set(s.combo.direccion, [s]);
  }
  for (const list of byDirection.values()) list.sort(better);

  const out: Scored[] = [];
  for (let rank = 0; rank < 2; rank++) {
    const round = [...byDirection.values()].map((list) => list[rank]).filter((s): s is Scored => !!s).sort(better);
    out.push(...round);
  }
  return out.slice(0, MAX_COMBOS).map((s) => s.combo);
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
