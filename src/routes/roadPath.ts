import type { LatLng } from '../domain/types';
import { haversineM } from '../import/summary';
import { fetchRoadFeature } from './ors';
import { ROAD_FILTER, UNPAVED_SURFACES } from './analyze';

export type RoadPoint = LatLng & { ele?: number };
/** El punto solicitado debe estar cerca de la carretera devuelta; no fabricar enlaces lejanos. */
export const MAX_ROAD_SNAP_M = 30;

export async function fetchRoadPath(key: string, waypoints: LatLng[], signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<RoadPoint[]> {
  if (!key.trim()) throw new Error('Añade tu clave de rutas en Ajustes para calcular conexiones por carretera.');
  if (waypoints.length < 2 || waypoints.length > 8 || waypoints.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180)) {
    throw new Error('Elige entre dos y ocho puntos válidos.');
  }
  const feature = await fetchRoadFeature(key, {
    coordinates: waypoints.map(p => [p.lng, p.lat]), elevation: true, instructions: false,
    extra_info: ['surface', 'waytype', 'steepness'], options: { avoid_features: ['ferries', 'fords', 'steps'] },
  }, signal, fetchImpl);
  const extras = feature.properties?.extras;
  for (const extra of [extras?.surface, extras?.waytypes]) {
    if (!extra || !Array.isArray(extra.summary) || extra.summary.length === 0 || extra.summary.some(s => !Number.isFinite(s.value) || !Number.isFinite(s.distance) || s.distance < 0 || !Number.isFinite(s.amount) || s.amount < 0 || s.amount > 100)) {
      throw new Error('El motor no ha dado datos suficientes del firme y del tipo de vía para esta conexión.');
    }
  }
  const unpaved = extras.surface.summary.filter(s => UNPAVED_SURFACES.has(s.value)).reduce((n,s) => n + s.distance, 0);
  const track = extras.waytypes.summary.filter(s => s.value === 5).reduce((n,s) => n + s.distance, 0);
  const mainRoad = extras.waytypes.summary.filter(s => s.value === 1).reduce((n,s) => n + s.amount, 0);
  const unknown = extras.surface.summary.filter(s => s.value === 0).reduce((n,s) => n + s.amount, 0);
  if (unpaved > ROAD_FILTER.maxUnpavedM || track > ROAD_FILTER.maxTrackM || mainRoad > ROAD_FILTER.maxMainRoadPct || unknown > 20) {
    throw new Error('La conexión no cumple los filtros de carretera o tiene demasiado firme desconocido. Prueba otro punto.');
  }
  const coords: unknown = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2 || coords.length > 50_000) throw new Error('El motor no ha devuelto un trazado válido.');
  const points = coords.map((c): RoadPoint => {
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90 || (c[2] !== undefined && !Number.isFinite(c[2]))) {
      throw new Error('El motor ha devuelto coordenadas inválidas.');
    }
    return { lat: c[1], lng: c[0], ...(c[2] === undefined ? {} : { ele: c[2] }) };
  });
  const gap = (a: LatLng, b: LatLng) => haversineM(a.lat, a.lng, b.lat, b.lng);
  if (gap(points[0], waypoints[0]) > MAX_ROAD_SNAP_M || gap(points[points.length - 1], waypoints[waypoints.length - 1]) > MAX_ROAD_SNAP_M) {
    throw new Error('El punto está demasiado lejos de una carretera. Acércalo al trazado y vuelve a calcular.');
  }
  for (const via of waypoints.slice(1, -1)) {
    if (!points.some(p => gap(p, via) <= MAX_ROAD_SNAP_M)) throw new Error('La conexión no pasa cerca del punto elegido. Mueve el punto a una carretera.');
  }
  return points;
}
