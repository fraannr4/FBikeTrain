import { z } from 'zod';
import { computeTotals, haversineM } from '../../import/summary.ts';
import type { LinePoint } from './cells.ts';

/**
 * Filas de `public.reference_routes`, la biblioteca común de rutas de referencia. Portable (Deno):
 * solo zod y módulos locales con extensión `.ts`. Solo rutas planificadas y publicadas por su autor.
 */

export type ReferenceSource = 'rwgps' | 'komoot' | 'bikemap' | 'wikiloc' | 'strava' | 'other';
export type ReferenceRouteRow = {
  source: ReferenceSource; source_id: string; url: string; name: string; author: string; distance_m: number; elev_gain_m: number | null;
  start_lat: number; start_lng: number; min_lat: number; max_lat: number; min_lng: number; max_lng: number; line: LinePoint[]; loop: boolean; unpaved_pct: number | null;
};

export const MAX_LINE_POINTS = 2000;
/** Una ruta es circular si acaba a esta distancia del inicio o menos (m). */
export const LOOP_CLOSE_M = 500;
/** Más de esto sin asfaltar (%) no es una ruta de carretera. */
export const MAX_UNPAVED_PCT = 5;

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Muestreo uniforme: como mucho `max` puntos, siempre con el primero y el último. */
export function simplifyLine<T>(points: T[], max = MAX_LINE_POINTS): T[] {
  if (points.length <= max) return points;
  return Array.from({ length: max }, (_, i) => points[Math.round((i * (points.length - 1)) / (max - 1))]);
}

type Point = { lat: number; lng: number; ele?: number };

/**
 * Caja, inicio, circularidad y línea simplificada (`[lng, lat, ele?]`, coordenadas a 5 decimales).
 * Distancia y desnivel salen del trazado, con la histéresis de 3 m de los totales de una salida;
 * sin altitud en ningún punto, el desnivel es null.
 */
function geometry(points: Point[]) {
  let minLat = Infinity; let maxLat = -Infinity; let minLng = Infinity; let maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat); minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  const first = points[0];
  const last = points[points.length - 1];
  const hasElevation = points.some(p => p.ele !== undefined);
  // Puntos sin hora: computeTotals solo suma la distancia y el desnivel.
  const totals = computeTotals(points.map(p => ({ t: 0, lat: p.lat, lng: p.lng, ele: p.ele })));
  return {
    distanceM: totals.distanceM,
    elevGainM: hasElevation ? totals.elevGainM : null,
    box: { start_lat: round5(first.lat), start_lng: round5(first.lng), min_lat: round5(minLat), max_lat: round5(maxLat), min_lng: round5(minLng), max_lng: round5(maxLng) },
    line: simplifyLine(points).map((p): LinePoint => (p.ele === undefined ? [round5(p.lng), round5(p.lat)] : [round5(p.lng), round5(p.lat), round1(p.ele)])),
    loop: haversineM(first.lat, first.lng, last.lat, last.lng) <= LOOP_CLOSE_M,
  };
}

const finite = z.number();
const routeDetail = z.object({
  route: z.object({
    visibility: z.literal('public'),
    name: z.string().max(500).nullish(),
    user: z.object({ name: z.string().max(200).nullish() }).nullish(),
    distance: finite.nonnegative().nullish(),
    elevation_gain: finite.nonnegative().nullish(),
    unpaved_pct: finite.min(0).max(100).nullish(),
    track_points: z.array(z.object({ x: finite.min(-180).max(180), y: finite.min(-90).max(90), e: finite.nullish() })).min(2).max(100_000),
  }),
});

/**
 * Fila de una ruta de la API v1 (`/api/v1/routes/{id}.json`). Null si no es pública, no tiene 2 puntos
 * válidos o tiene más de un 5 % sin asfaltar. Nada de la cuenta (correo, ids, privacy_code).
 */
export function rwgpsReferenceRow(id: number, json: unknown): ReferenceRouteRow | null {
  const parsed = routeDetail.safeParse(json);
  if (!parsed.success) return null;
  const { route } = parsed.data;
  const unpaved = route.unpaved_pct ?? null;
  if (unpaved !== null && unpaved > MAX_UNPAVED_PCT) return null;
  const g = geometry(route.track_points.map(p => (typeof p.e === 'number' ? { lat: p.y, lng: p.x, ele: p.e } : { lat: p.y, lng: p.x })));
  const elevation = route.elevation_gain ?? g.elevGainM;
  return {
    source: 'rwgps', source_id: String(id), url: `https://ridewithgps.com/routes/${id}`,
    name: route.name ?? '', author: route.user?.name ?? '',
    distance_m: Math.round(route.distance ?? g.distanceM), elev_gain_m: elevation === null ? null : Math.round(elevation),
    ...g.box, line: g.line, loop: g.loop, unpaved_pct: unpaved,
  };
}

/** Fila desde los puntos de un GPX ya leído. Distancia y desnivel calculados del trazado. */
export function pointsReferenceRow(input: { source: ReferenceSource; sourceId: string; url: string; name: string; author?: string; points: Point[]; unpavedPct?: number | null }): ReferenceRouteRow {
  const g = geometry(input.points);
  return {
    source: input.source, source_id: input.sourceId, url: input.url, name: input.name, author: input.author ?? '',
    distance_m: Math.round(g.distanceM), elev_gain_m: g.elevGainM === null ? null : Math.round(g.elevGainM),
    ...g.box, line: g.line, loop: g.loop, unpaved_pct: input.unpavedPct ?? null,
  };
}
