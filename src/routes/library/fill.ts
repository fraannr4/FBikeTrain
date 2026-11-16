import { z } from 'zod';
import type { SourceTransport } from '../sources/providers.ts';
import { RouteSourceError } from '../sources/schema.ts';
import { MAX_UNPAVED_PCT, rwgpsReferenceRow, type ReferenceRouteRow } from './rows.ts';
import type { LibrarySearch } from './schema.ts';

/**
 * Llenado automático de una zona con pocas rutas de referencia: busca rutas públicas de carretera
 * en el buscador público de Ride with GPS (la API v1 no busca por zona; `robots.txt` no prohíbe
 * `/find/search.json`, comprobado el 2026-11-16) y trae cada una por la API v1 de la cuenta común.
 * A Ride with GPS solo viaja el centro de la zona redondeado a 0,05° (≈ 5 km), nunca el punto pedido.
 */

/** Rutas que se importan como mucho en un llenado. */
export const FILL_MAX_ROUTES = 15;
/** Rejilla del centro que se envía a Ride with GPS (grados). */
export const FILL_GRID_DEG = 0.05;
/** Longitud de las rutas que se importan (m). */
const FILL_LENGTH_M = { min: 20_000, max: 200_000 };
/** Mismo ritmo que el transporte de `route-sources`: el reloj del proveedor admite 1 petición por segundo. */
const REQUEST_GAP_MS = 1050;

const round2 = (v: number) => Math.round(v * 100) / 100;

export function fillCentre(lat: number, lng: number): { lat: number; lng: number } {
  const snap = (v: number) => round2(Math.round(v / FILL_GRID_DEG) * FILL_GRID_DEG);
  return { lat: snap(lat), lng: snap(lng) };
}

/**
 * Búsqueda de rutas (no actividades) que empiezan a `radiusKm` del centro, con la longitud en la
 * ventana de las candidatas B (70-140 % de la pedida) dentro de 20-200 km. Radio y longitud en km.
 */
export function rwgpsSearchUrl(centre: { lat: number; lng: number }, radiusKm: number, distanceKm: number): string {
  const min = Math.max(FILL_LENGTH_M.min / 1000, Math.round(distanceKm * 0.7));
  const max = Math.min(FILL_LENGTH_M.max / 1000, Math.max(min, Math.round(distanceKm * 1.4)));
  const params = new URLSearchParams({
    'search[keywords]': '', 'search[lat]': String(round2(centre.lat)), 'search[lng]': String(round2(centre.lng)),
    'search[start_distance]': String(Math.round(radiusKm)), 'search[length_min]': String(min), 'search[length_max]': String(max),
    'search[model_types]': 'route', 'search[offset]': '0', 'search[limit]': '20', 'search[sort_by]': 'relevance desc',
  });
  return `https://ridewithgps.com/find/search.json?${params}`;
}

const hitSchema = z.object({
  type: z.literal('route'),
  route: z.object({
    id: z.number().int().min(1).max(999_999_999_999),
    distance: z.number().finite().positive(),
    unpaved_pct: z.number().finite().min(0).max(100).nullish(),
    track_type: z.string().nullish(),
    activity_types: z.array(z.string()).nullish(),
    is_trip: z.boolean().nullish(),
    visibility: z.number().nullish(),
  }),
});

/** Rutas públicas de carretera con poca tierra (o sin dato de tierra) de una respuesta de `find/search.json`. */
export function parseRwgpsSearch(json: unknown): { id: number; distanceM: number; unpavedPct: number | null; loop: boolean; road: boolean }[] {
  const results = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap(item => {
    const parsed = hitSchema.safeParse(item);
    if (!parsed.success) return [];
    const r = parsed.data.route;
    const unpavedPct = r.unpaved_pct ?? null;
    const road = r.activity_types?.includes('cycling:road') ?? false;
    if (!road || r.is_trip === true || (r.visibility ?? 0) !== 0 || (unpavedPct !== null && unpavedPct > MAX_UNPAVED_PCT)) return [];
    return [{ id: r.id, distanceM: r.distance, unpavedPct, loop: r.track_type === 'loop', road }];
  });
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new RouteSourceError('cancelled')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Busca, trae y guarda como mucho FILL_MAX_ROUTES rutas de la zona. Cada detalle reclama antes el
 * turno del proveedor `rwgps`; el primer turno denegado o un 429 cortan y se guarda lo ya traído.
 * Sin credenciales de la cuenta común (401) lanza `unavailable`.
 */
export async function fillZone(search: LibrarySearch, deps: {
  transport: SourceTransport; claim: (p: 'rwgps') => Promise<boolean>;
  routeDetail: (id: number, signal: AbortSignal) => Promise<{ status: number; json: unknown }>;
  upsert: (rows: ReferenceRouteRow[]) => Promise<number>; signal: AbortSignal;
}): Promise<{ found: number; imported: number; ids: number[] }> {
  const text = await deps.transport(rwgpsSearchUrl(fillCentre(search.lat, search.lon), Math.ceil(search.radiusM / 1000), search.distanceKm));
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new RouteSourceError('invalid_response'); }
  const found = parseRwgpsSearch(json).filter(r => r.distanceM >= FILL_LENGTH_M.min && r.distanceM <= FILL_LENGTH_M.max);

  const rows: ReferenceRouteRow[] = [];
  const ids: number[] = [];
  let last = Date.now();
  for (const hit of found.slice(0, FILL_MAX_ROUTES)) {
    await pause(last + REQUEST_GAP_MS - Date.now(), deps.signal);
    if (!await deps.claim('rwgps')) break;
    deps.signal.throwIfAborted();
    last = Date.now();
    const detail = await deps.routeDetail(hit.id, deps.signal);
    if (detail.status === 429) break;
    if (detail.status === 401) throw new RouteSourceError('unavailable');
    const row = detail.status === 200 ? rwgpsReferenceRow(hit.id, detail.json) : null;
    if (row) { rows.push(row); ids.push(hit.id); }
  }
  const imported = rows.length ? await deps.upsert(rows) : 0;
  return { found: found.length, imported, ids };
}
