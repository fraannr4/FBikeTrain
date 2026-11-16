import { haversineM } from '../../import/summary.ts';
import { passDistanceM } from './cells.ts';
import type { HeatCell } from './heat.ts';
import type { ReferenceRouteRow } from './rows.ts';
import { MAX_LIBRARY_CELLS, MAX_LIBRARY_ROUTES, type LibraryFill, type LibrarySearch, type LibraryRoute, type LibraryZone } from './schema.ts';
import { typicalClimb, zoneFactor } from './zone.ts';

/** Una candidata B pasa a esta distancia del inicio o menos (m). */
const MAX_PASS_M = 5_000;
/** Longitud de una candidata B respecto a la pedida. */
const LENGTH_RANGE = { min: 0.7, max: 1.4 };
const M_PER_DEG_LAT = 111_195;

/** Caja que contiene el círculo de `radiusM` alrededor del punto. */
export function circleBox(lat: number, lng: number, radiusM: number): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

/**
 * Respuesta de la operación `library` a partir de las filas y celdas leídas de la caja del círculo.
 * Cuentan las rutas cuya línea pasa por el círculo; de ellas salen el factor de la zona, la subida
 * típica y las candidatas B (70-140 % de la longitud, a ≤ 5 km del inicio, por parecido).
 */
export function buildLibraryZone(search: LibrarySearch, rows: (ReferenceRouteRow & { id: string })[], cells: HeatCell[], fill: LibraryFill): LibraryZone {
  const inZone = rows
    .map(row => ({ row, passM: passDistanceM(search.lat, search.lon, row.line) }))
    .filter(({ passM }) => passM <= search.radiusM);
  const factor = zoneFactor(inZone.map(({ row }) => ({ line: row.line.map(([lng, lat]) => ({ lat, lng })), distanceM: row.distance_m, loop: row.loop })));

  const wanted = search.distanceKm * 1000;
  const wantedGain = search.elevGainM;
  const missingGain = (r: ReferenceRouteRow) => (wantedGain !== null && r.elev_gain_m === null ? 1 : 0);
  const score = (r: ReferenceRouteRow) => Math.abs(r.distance_m - wanted) / wanted
    + (wantedGain && r.elev_gain_m !== null ? Math.abs(r.elev_gain_m - wantedGain) / wantedGain : 0);
  const routes: LibraryRoute[] = inZone
    .filter(({ row, passM }) => passM <= MAX_PASS_M && row.distance_m >= wanted * LENGTH_RANGE.min && row.distance_m <= wanted * LENGTH_RANGE.max)
    .sort((a, b) => missingGain(a.row) - missingGain(b.row) || score(a.row) - score(b.row))
    .slice(0, MAX_LIBRARY_ROUTES)
    .map(({ row, passM }) => ({
      id: row.id, source: row.source, url: row.url, name: row.name, author: row.author,
      distanceM: row.distance_m, elevGainM: row.elev_gain_m, loop: row.loop, passM: Math.round(passM), line: row.line,
    }));

  return {
    routeCount: inZone.length,
    cells: cells
      .filter(c => haversineM(search.lat, search.lon, c.lat, c.lng) <= search.radiusM)
      .sort((a, b) => b.routes - a.routes)
      .slice(0, MAX_LIBRARY_CELLS)
      .map(c => ({ lat: c.lat, lng: c.lng, routes: c.routes, climbMPerKm: c.climbMPerKm })),
    routes,
    zoneFactor: factor.factor,
    factorSamples: factor.samples,
    climbMPerKm: typicalClimb(inZone.map(({ row }) => ({ distanceM: row.distance_m, elevGainM: row.elev_gain_m }))),
    fill,
  };
}
