import { z } from 'zod';
import type { LinePoint } from './cells.ts';
import type { ReferenceSource } from './rows.ts';
import { ZONE_FACTOR_RANGE } from './zone.ts';

/**
 * Operación `library` de `route-sources`: lo que pide el móvil y lo que responde la función.
 * Portable (Deno): solo zod y módulos locales con extensión `.ts`.
 */

/** Con menos rutas de referencia en el círculo, la zona se llena desde Ride with GPS. */
export const SPARSE_ZONE_ROUTES = 15;
/** Rutas de referencia candidatas (B) que se devuelven con su línea completa. */
export const MAX_LIBRARY_ROUTES = 6;
/** Celdas del mapa de calor que se devuelven, de más a menos rutas. */
export const MAX_LIBRARY_CELLS = 8000;

export const librarySearchSchema = z.strictObject({
  lat: z.number().finite().min(-85).max(85),
  lon: z.number().finite().min(-180).max(180),
  radiusM: z.number().int().min(8_000).max(40_000),
  distanceKm: z.number().finite().min(5).max(300),
  elevGainM: z.number().finite().min(0).max(20_000).nullable(),
});
export type LibrarySearch = z.infer<typeof librarySearchSchema>;

/** Agrupa búsquedas próximas: punto a 3 decimales, radio hacia arriba al km, km al entero y desnivel a 50 m. */
export function normalizeLibrarySearch(s: LibrarySearch): LibrarySearch {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    lat: r3(s.lat), lon: r3(s.lon), radiusM: Math.ceil(s.radiusM / 1000) * 1000,
    distanceKm: Math.round(s.distanceKm), elevGainM: s.elevGainM === null ? null : Math.round(s.elevGainM / 50) * 50,
  };
}

export type LibraryRoute = {
  id: string; source: ReferenceSource; url: string; name: string; author: string;
  distanceM: number; elevGainM: number | null; loop: boolean; passM: number; line: LinePoint[];
};
export type HeatCellLite = { lat: number; lng: number; routes: number; climbMPerKm: number | null };
export type LibraryFill = 'none' | 'imported' | 'nothing-found' | 'unavailable';
export type LibraryZone = {
  routeCount: number; cells: HeatCellLite[]; routes: LibraryRoute[]; zoneFactor: number; factorSamples: number; climbMPerKm: number | null; fill: LibraryFill;
};

const lng = z.number().finite().min(-180).max(180);
const lat = z.number().finite().min(-90).max(90);
const linePoint = z.union([z.tuple([lng, lat]), z.tuple([lng, lat, z.number().finite()])]);
const libraryRouteSchema = z.strictObject({
  id: z.string().min(1).max(64),
  source: z.enum(['rwgps', 'komoot', 'bikemap', 'wikiloc', 'strava', 'other']),
  url: z.string().max(500).regex(/^https:\/\//),
  name: z.string().max(300),
  author: z.string().max(200),
  distanceM: z.number().finite().positive(),
  elevGainM: z.number().finite().nonnegative().nullable(),
  loop: z.boolean(),
  passM: z.number().finite().nonnegative(),
  line: z.array(linePoint).min(2).max(2000),
});
/** En el cable cada celda es `[lat, lng, routes, climbMPerKm | null]`: 8.000 objetos pesarían el doble. */
const wireCell = z.tuple([lat, lng, z.number().int().min(1), z.number().finite().nonnegative().nullable()]);

export const libraryZoneSchema = z.strictObject({
  routeCount: z.number().int().nonnegative(),
  cells: z.array(wireCell).max(MAX_LIBRARY_CELLS),
  routes: z.array(libraryRouteSchema).max(MAX_LIBRARY_ROUTES),
  zoneFactor: z.number().finite().min(ZONE_FACTOR_RANGE.min).max(ZONE_FACTOR_RANGE.max),
  factorSamples: z.number().int().nonnegative(),
  climbMPerKm: z.number().finite().nonnegative().nullable(),
  fill: z.enum(['none', 'imported', 'nothing-found', 'unavailable']),
}).transform((wire): LibraryZone => ({
  ...wire,
  cells: wire.cells.map(([cellLat, cellLng, routes, climbMPerKm]) => ({ lat: cellLat, lng: cellLng, routes, climbMPerKm })),
}));

/** Forma de cable de una zona: celdas en tuplas con 5 decimales y la subida a 1 decimal. */
export function encodeLibraryZone(zone: LibraryZone) {
  const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
  return {
    ...zone,
    cells: zone.cells.map(c => [r(c.lat, 5), r(c.lng, 5), c.routes, c.climbMPerKm === null ? null : r(c.climbMPerKm, 1)] as const),
  };
}
