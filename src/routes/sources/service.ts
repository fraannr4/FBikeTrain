import { z } from 'zod';
import { routeSearchSchema, routeReferencesSchema, RouteSourceError, type RouteReference, type RouteSearch } from './schema.ts';
import { loadOverpass, loadWikiloc, readLimited, sourceTransport } from './providers.ts';
import { normalizeRouteSearch, simplifyRouteReference, MAX_REFERENCE_POINTS } from './limits.ts';
import { loadWaypoints, normalizeWaypointSearch, osmWaypointsSchema, waypointSearchSchema } from './waypoints.ts';
import { loadMountainPasses, mountainPassesSchema, normalizePassSearch, passSearchSchema } from './passes.ts';
import { encodeLibraryZone, librarySearchSchema, normalizeLibrarySearch, SPARSE_ZONE_ROUTES, type LibrarySearch, type LibraryZone } from '../library/schema.ts';
import { buildLibraryZone, circleBox } from '../library/zoneResponse.ts';
import { fillCentre, fillZone } from '../library/fill.ts';
import { buildHeatCells, type HeatCell } from '../library/heat.ts';
import type { ReferenceRouteRow } from '../library/rows.ts';

const requestSchema = z.union([
  routeSearchSchema.extend({ source: z.enum(['wikiloc', 'osm']).default('wikiloc') }),
  passSearchSchema.extend({ source: z.literal('osm'), kind: z.literal('passes') }),
  waypointSearchSchema.extend({ source: z.literal('osm'), kind: z.literal('waypoints') }),
  librarySearchSchema.extend({ source: z.literal('library'), kind: z.literal('library') }),
]);
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 30_000;
/** Los puntos de paso admiten reintentos y Overpass público tarda decenas de segundos con carga. */
const WAYPOINTS_TIMEOUT_MS = 60_000;
export type SourceCacheRow = { payload: unknown; fetched_at: string; expires_at: string };
export type RouteSourceDependencies = {
  enabled: boolean; wikilocAuthorized: boolean; wikilocSearchTemplate: string; allowedOrigins: string[];
  authenticate: (token: string) => Promise<{ id: string; isAnonymous: boolean } | null>;
  consumeQuota: (userId: string) => Promise<{ allowed: boolean; retryAfterS: number }>;
  readCache: (key: string) => Promise<SourceCacheRow | null>;
  writeCache: (row: SourceCacheRow & { cache_key: string; source: 'wikiloc' | 'osm' | 'rwgps' }) => Promise<void>;
  claim: (source: 'wikiloc' | 'osm' | 'rwgps') => Promise<boolean>;
  fetch: typeof fetch;
  now?: () => number;
  /** Biblioteca común (rpc de `reference_routes` y `reference_heat_cells`) y API v1 de Ride with GPS. */
  routesInBox: (box: Box) => Promise<(ReferenceRouteRow & { id: string })[]>;
  heatCellsInBox: (box: Box) => Promise<HeatCell[]>;
  replaceHeatCells: (cells: HeatCell[], box: Box) => Promise<void>;
  upsertRoutes: (rows: ReferenceRouteRow[]) => Promise<number>;
  rwgpsRouteDetail: (id: number, signal: AbortSignal) => Promise<{ status: number; json: unknown }>;
};
type Box = ReturnType<typeof circleBox>;
type SearchKind = 'routes' | 'passes' | 'waypoints';
const NORMALIZERS: Record<SearchKind, (search: RouteSearch) => RouteSearch> = {
  routes: normalizeRouteSearch, passes: normalizePassSearch, waypoints: normalizeWaypointSearch,
};
const KEY_PREFIXES: Record<SearchKind, string> = { routes: 'v2', passes: 'v1:passes', waypoints: 'v2:waypoints' };

export async function sourceCacheKey(source: string, search: RouteSearch, kind: SearchKind = 'routes'): Promise<string> {
  // No almacena el punto de consulta legible en la clave de caché.
  const normalized = NORMALIZERS[kind](search);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([source, normalized.lat, normalized.lon, normalized.radiusM])));
  return `${KEY_PREFIXES[kind]}:${source}:${Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')}`;
}
export async function handleRouteSources(request: Request, deps: RouteSourceDependencies): Promise<Response> {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = { Vary: 'Origin', 'Cache-Control': 'no-store', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' };
  if (origin && deps.allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const fail = (status: number, code: string, retryAfterS = 30) => Response.json({ error: { code, message: 'No se pudo consultar esta fuente de rutas.' } }, { status, headers: { ...headers, ...(status === 429 ? { 'Retry-After': String(retryAfterS) } : {}) } });
  if (origin && !deps.allowedOrigins.includes(origin)) return fail(403, 'origin_not_allowed');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return fail(405, 'method_not_allowed');
  if (!deps.enabled) return fail(503, 'unavailable');
  const token = /^Bearer ([^\s]{1,4096})$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return fail(401, 'unauthorized');
  let userId: string;
  try {
    const user = await deps.authenticate(token);
    if (!user || user.isAnonymous !== false || !z.uuid().safeParse(user.id).success) return fail(401, 'unauthorized');
    userId = user.id;
  }
  catch { return fail(503, 'unavailable'); }
  let input: z.infer<typeof requestSchema>;
  try {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return fail(400, 'invalid_request');
    // Response permite compartir el lector acotado para cuerpos chunked.
    input = requestSchema.parse(JSON.parse(await readLimited(new Response(request.body), 2048)));
  } catch { return fail(400, 'invalid_request'); }
  if (request.signal.aborted) return fail(499, 'cancelled');
  if (input.source === 'library') return serveLibrary(request, input, userId, deps, headers, fail);
  if (input.source === 'wikiloc' && (!deps.wikilocAuthorized || !deps.wikilocSearchTemplate)) return fail(503, 'wikiloc_authorization_required');
  const { source, lat, lon, radiusM } = input;
  const passes = 'kind' in input && input.kind === 'passes';
  const waypoints = 'kind' in input && input.kind === 'waypoints';
  const kind: SearchKind = passes ? 'passes' : waypoints ? 'waypoints' : 'routes';
  const search = NORMALIZERS[kind]({ lat, lon, radiusM });
  const now = deps.now ?? Date.now;
  const controller = new AbortController();
  const signal = controller.signal;
  const timeout = setTimeout(() => controller.abort(), waypoints ? WAYPOINTS_TIMEOUT_MS : TIMEOUT_MS);
  const cancel = () => controller.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  try {
    signal.throwIfAborted();
    const quota = await deps.consumeQuota(userId);
    signal.throwIfAborted();
    if (!quota.allowed) return fail(429, 'quota_exceeded', Math.max(1, Math.min(86400, Math.ceil(quota.retryAfterS) || 30)));
    const key = await sourceCacheKey(source, search, kind);
    const cached = await deps.readCache(key);
    signal.throwIfAborted();
    if (cached && Date.parse(cached.expires_at) > now() && Date.parse(cached.fetched_at) <= now()
      && Date.parse(cached.expires_at) - Date.parse(cached.fetched_at) === CACHE_TTL_MS) {
      const cachedPasses = passes ? mountainPassesSchema.safeParse(cached.payload) : null;
      if (cachedPasses?.success && cachedPasses.data.every(pass => pass.distanceM <= search.radiusM)) {
        return Response.json({ data: cachedPasses.data }, { headers });
      }
      const cachedWaypoints = waypoints ? osmWaypointsSchema.safeParse(cached.payload) : null;
      if (cachedWaypoints?.success && cachedWaypoints.data.every(w => w.distanceM <= search.radiusM)) {
        return Response.json({ data: cachedWaypoints.data }, { headers });
      }
      const parsed = !passes && !waypoints ? routeReferencesSchema.safeParse(cached.payload) : null;
      if (parsed?.success && parsed.data.every(route => route.source === input.source && Date.parse(route.fetchedAt) === Date.parse(cached.fetched_at)
        && (!route.geometry || route.geometry.coordinates.reduce((n, line) => n + line.length, 0) <= MAX_REFERENCE_POINTS))) {
        return Response.json({ data: parsed.data }, { headers });
      }
    }
    signal.throwIfAborted();
    const fetchedAt = new Date(now()).toISOString();
    const transport = sourceTransport(source, { fetch: deps.fetch, claim: deps.claim, signal });
    if (passes || waypoints) {
      const data = passes ? await loadMountainPasses(search, transport) : await loadWaypoints(search, transport);
      signal.throwIfAborted();
      // Sin caché la respuesta sigue valiendo: un fallo al guardar no deja al móvil sin puntos.
      await deps.writeCache({ cache_key: key, source: 'osm', payload: data, fetched_at: fetchedAt, expires_at: new Date(Date.parse(fetchedAt) + CACHE_TTL_MS).toISOString() }).catch(() => undefined);
      signal.throwIfAborted();
      return Response.json({ data }, { headers });
    }
    const routes: RouteReference[] = source === 'wikiloc'
      ? await loadWikiloc(search, fetchedAt, transport, deps.wikilocSearchTemplate)
      : await loadOverpass(search, fetchedAt, transport);
    const data = routeReferencesSchema.parse(routes).map(simplifyRouteReference);
    signal.throwIfAborted();
    await deps.writeCache({ cache_key: key, source: input.source, payload: data, fetched_at: fetchedAt, expires_at: new Date(Date.parse(fetchedAt) + CACHE_TTL_MS).toISOString() });
    signal.throwIfAborted();
    return Response.json({ data }, { headers });
  } catch (error) {
    if (request.signal.aborted) return fail(499, 'cancelled');
    if (signal.aborted) return fail(504, 'timeout');
    if (error instanceof RouteSourceError) return fail(error.code === 'busy' ? 429 : 502, error.code);
    return fail(503, 'unavailable');
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', cancel);
  }
}

/** Marca de «zona ya llenada» en la caché de `route-sources`: sin el punto pedido, solo el centro redondeado. */
async function fillMarkKey(search: LibrarySearch): Promise<string> {
  const centre = fillCentre(search.lat, search.lon);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([centre.lat, centre.lng, search.radiusM])));
  return `v1:rwgps-fill:${Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Lee la biblioteca de la caja del círculo (sin caché: debe ver lo último importado). Si la zona tiene
 * pocas rutas y no hay marca de los últimos 7 días, la llena desde Ride with GPS, recalcula el calor
 * de la caja y vuelve a leer. Un fallo de Ride with GPS deja lo que había con `fill: 'unavailable'`.
 */
async function loadLibraryZone(search: LibrarySearch, deps: RouteSourceDependencies, signal: AbortSignal, now: () => number): Promise<LibraryZone> {
  const box = circleBox(search.lat, search.lon, search.radiusM);
  const zone = buildLibraryZone(search, await deps.routesInBox(box), await deps.heatCellsInBox(box), 'none');
  if (zone.routeCount >= SPARSE_ZONE_ROUTES) return zone;
  signal.throwIfAborted();
  const key = await fillMarkKey(search);
  const mark = await deps.readCache(key);
  if (mark && Date.parse(mark.expires_at) > now()) return zone;
  try {
    const transport = sourceTransport('rwgps', { fetch: deps.fetch, claim: deps.claim, signal });
    const result = await fillZone(search, { transport, claim: deps.claim, routeDetail: deps.rwgpsRouteDetail, upsert: deps.upsertRoutes, signal });
    signal.throwIfAborted();
    const fetchedAt = new Date(now()).toISOString();
    await deps.writeCache({ cache_key: key, source: 'rwgps', payload: result.ids, fetched_at: fetchedAt, expires_at: new Date(Date.parse(fetchedAt) + CACHE_TTL_MS).toISOString() }).catch(() => undefined);
    if (!result.imported) return { ...zone, fill: 'nothing-found' };
    const rows = await deps.routesInBox(box);
    const inBox = (c: HeatCell) => c.lat >= box.minLat && c.lat <= box.maxLat && c.lng >= box.minLng && c.lng <= box.maxLng;
    const cells = buildHeatCells(rows.map(r => r.line)).filter(inBox);
    await deps.replaceHeatCells(cells, box);
    return buildLibraryZone(search, rows, cells, 'imported');
  } catch (error) {
    if (signal.aborted) throw error;
    return { ...zone, fill: 'unavailable' };
  }
}

async function serveLibrary(request: Request, input: LibrarySearch, userId: string, deps: RouteSourceDependencies,
  headers: Record<string, string>, fail: (status: number, code: string, retryAfterS?: number) => Response): Promise<Response> {
  const search = normalizeLibrarySearch({ lat: input.lat, lon: input.lon, radiusM: input.radiusM, distanceKm: input.distanceKm, elevGainM: input.elevGainM });
  const controller = new AbortController();
  const signal = controller.signal;
  // Un llenado son 1 búsqueda y hasta 15 detalles a 1 por segundo: el mismo margen que los puntos de paso.
  const timeout = setTimeout(() => controller.abort(), WAYPOINTS_TIMEOUT_MS);
  const cancel = () => controller.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  try {
    signal.throwIfAborted();
    const quota = await deps.consumeQuota(userId);
    signal.throwIfAborted();
    if (!quota.allowed) return fail(429, 'quota_exceeded', Math.max(1, Math.min(86400, Math.ceil(quota.retryAfterS) || 30)));
    const zone = await loadLibraryZone(search, deps, signal, deps.now ?? Date.now);
    signal.throwIfAborted();
    return Response.json({ data: encodeLibraryZone(zone) }, { headers });
  } catch {
    if (request.signal.aborted) return fail(499, 'cancelled');
    if (signal.aborted) return fail(504, 'timeout');
    return fail(503, 'unavailable');
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', cancel);
  }
}
