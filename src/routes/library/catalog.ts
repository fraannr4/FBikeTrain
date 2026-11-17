import { z } from 'zod';
import { haversineM } from '../../import/summary.ts';
import type { LinePoint } from './cells.ts';
import { simplifyLine, type ReferenceRouteRow } from './rows.ts';

/**
 * Operaciones `library-list` y `library-route` de `route-sources`: el catálogo de la biblioteca común
 * para verlo en la app. Portable (Deno): solo zod y módulos locales con extensión `.ts`.
 */

/** Rutas del catálogo por respuesta, de la más cercana a la más lejana. */
export const MAX_CATALOG_ROUTES = 300;
/** Puntos de la línea de miniatura. */
export const THUMB_POINTS = 48;

const SOURCES = ['rwgps', 'komoot', 'bikemap', 'wikiloc', 'strava', 'other'] as const;
const lat = z.number().finite().min(-90).max(90);
const lng = z.number().finite().min(-180).max(180);

export const catalogRequestSchema = z.strictObject({
  lat: z.number().finite().min(-85).max(85),
  lon: lng,
  radiusM: z.number().int().min(5_000).max(150_000),
});
export type CatalogRequest = z.infer<typeof catalogRequestSchema>;

/** Agrupa peticiones próximas: punto a 3 decimales y radio hacia arriba al km. */
export function normalizeCatalogRequest(r: CatalogRequest): CatalogRequest {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { lat: r3(r.lat), lon: r3(r.lon), radiusM: Math.ceil(r.radiusM / 1000) * 1000 };
}

export const detailRequestSchema = z.strictObject({ id: z.uuid() });

const base = {
  id: z.string().min(1).max(64),
  source: z.enum(SOURCES),
  url: z.string().max(500).regex(/^https:\/\//),
  name: z.string().max(300),
  author: z.string().max(200),
  distanceM: z.number().finite().positive(),
  elevGainM: z.number().finite().nonnegative().nullable(),
  loop: z.boolean(),
};
const catalogRouteSchema = z.strictObject({
  ...base,
  unpavedPct: z.number().finite().min(0).max(100).nullable(),
  startLat: lat,
  startLng: lng,
  /** `[lat, lng]`, sin altitud, para dibujar la forma. */
  thumb: z.array(z.tuple([lat, lng])).min(2).max(60),
});
export type CatalogRoute = z.infer<typeof catalogRouteSchema>;

export const catalogResponseSchema = z.strictObject({
  /** Rutas de la biblioteca dentro del círculo, aunque la lista se corte en `MAX_CATALOG_ROUTES`. */
  total: z.number().int().nonnegative(),
  routes: z.array(catalogRouteSchema).max(MAX_CATALOG_ROUTES),
});
export type LibraryCatalog = z.infer<typeof catalogResponseSchema>;

const linePoint = z.union([z.tuple([lng, lat]), z.tuple([lng, lat, z.number().finite()])]);
export const detailResponseSchema = z.strictObject({ ...base, line: z.array(linePoint).min(2).max(2000) });
export type LibraryDetail = z.infer<typeof detailResponseSchema>;

type Row = ReferenceRouteRow & { id: string };
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Línea de miniatura: `[lat, lng]` a 4 decimales (~11 m), sin altitud, con el primer y el último punto. */
export function thumbLine(line: LinePoint[]): [number, number][] {
  return simplifyLine(line, THUMB_POINTS).map(p => [round(p[1], 4), round(p[0], 4)]);
}

/** Rutas con el inicio dentro del círculo, de la más cercana a la más lejana, con la forma aligerada. */
export function buildLibraryCatalog(search: CatalogRequest, rows: Row[]): LibraryCatalog {
  const near = rows
    .map(row => ({ row, awayM: haversineM(search.lat, search.lon, row.start_lat, row.start_lng) }))
    .filter(({ awayM }) => awayM <= search.radiusM)
    .sort((a, b) => a.awayM - b.awayM);
  return {
    total: near.length,
    routes: near.slice(0, MAX_CATALOG_ROUTES).map(({ row }) => ({
      id: row.id, source: row.source, url: row.url, name: row.name, author: row.author,
      distanceM: row.distance_m, elevGainM: row.elev_gain_m, loop: row.loop, unpavedPct: row.unpaved_pct,
      startLat: round(row.start_lat, 3), startLng: round(row.start_lng, 3), thumb: thumbLine(row.line),
    })),
  };
}

/** Una ruta con su línea completa (con altitud si la tiene), para el mapa y el perfil. */
export function toLibraryDetail(row: Row): LibraryDetail {
  return {
    id: row.id, source: row.source, url: row.url, name: row.name, author: row.author,
    distanceM: row.distance_m, elevGainM: row.elev_gain_m, loop: row.loop, line: row.line,
  };
}
