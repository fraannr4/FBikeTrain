import type { Coord3, TrackPoint } from '../domain/types';
import { haversineM } from '../import/summary';
import { cellKey, ROUTE_CELL_M } from './routes';

/** Lado de la celda de la rejilla del historial (m): la misma que la de las rutas repetidas. */
export const CELL_M = ROUTE_CELL_M;
/** Entre dos puntos del historial más separados que esto se intercalan puntos (m). */
export const MAX_TRACK_GAP_M = 100;
/** Cada cuántos metros se muestrea la ruta candidata para contar carretera nueva. */
export const ROUTE_SAMPLE_M = 50;

export { cellKey };

type GpsPoint = { lat: number; lng: number };

const hasGps = (p: TrackPoint): p is TrackPoint & GpsPoint => p.lat !== undefined && p.lng !== undefined;

/**
 * Celdas por las que pasa el historial. Los puntos sin GPS se saltan; si dos puntos con GPS
 * seguidos distan más de MAX_TRACK_GAP_M, se marcan también las celdas de la recta que los une.
 */
export function buildVisitedCells(tracks: Iterable<TrackPoint[]>): Set<string> {
  const cells = new Set<string>();
  for (const track of tracks) {
    let prev: GpsPoint | undefined;
    for (const p of track) {
      if (!hasGps(p)) continue;
      if (prev) {
        const steps = Math.ceil(haversineM(prev.lat, prev.lng, p.lat, p.lng) / MAX_TRACK_GAP_M);
        for (let k = 1; k < steps; k++) {
          const f = k / steps;
          cells.add(cellKey(prev.lat + (p.lat - prev.lat) * f, prev.lng + (p.lng - prev.lng) * f));
        }
      }
      cells.add(cellKey(p.lat, p.lng));
      prev = p;
    }
  }
  return cells;
}

/** Celdas de los puntos de la ruta a 0, 50, 100… m desde la salida. */
function sampleCells(coords: Coord3[]): string[] {
  if (coords.length === 0) return [];
  const out = [cellKey(coords[0][1], coords[0][0])];
  let done = 0;
  let next = ROUTE_SAMPLE_M;
  for (let i = 1; i < coords.length; i++) {
    const [aLng, aLat] = coords[i - 1];
    const [bLng, bLat] = coords[i];
    const seg = haversineM(aLat, aLng, bLat, bLng);
    while (next <= done + seg) {
      const f = (next - done) / seg;
      out.push(cellKey(aLat + (bLat - aLat) * f, aLng + (bLng - aLng) * f));
      next += ROUTE_SAMPLE_M;
    }
    done += seg;
  }
  return out;
}

/**
 * Porcentaje (0 a 100) de las muestras de la ruta que caen en celdas que el historial no ha
 * pisado. Sin historial, o con una ruta vacía, todo es carretera nueva: 100.
 */
export function newRoadPct(coords: Coord3[], visited: ReadonlySet<string>): number {
  const samples = sampleCells(coords);
  if (samples.length === 0) return 100;
  const fresh = samples.filter((c) => !visited.has(c)).length;
  return (fresh / samples.length) * 100;
}
