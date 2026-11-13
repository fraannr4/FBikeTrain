import { z } from 'zod';
import { routeSearchSchema, routeReferencesSchema, RouteSourceError, type RouteReference, type RouteSearch } from './schema.ts';
import { loadOverpass, loadWikiloc, readLimited, sourceTransport } from './providers.ts';
import { normalizeRouteSearch, simplifyRouteReference, MAX_REFERENCE_POINTS } from './limits.ts';
import { loadWaypoints, normalizeWaypointSearch, osmWaypointsSchema, waypointSearchSchema } from './waypoints.ts';
import { loadMountainPasses, mountainPassesSchema, normalizePassSearch, passSearchSchema } from './passes.ts';

const requestSchema = z.union([
  routeSearchSchema.extend({ source: z.enum(['wikiloc', 'osm']).default('wikiloc') }),
  passSearchSchema.extend({ source: z.literal('osm'), kind: z.literal('passes') }),
  waypointSearchSchema.extend({ source: z.literal('osm'), kind: z.literal('waypoints') }),
]);
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Puertos, cimas y pueblos casi no cambian y Overpass público es lento: se guardan 30 días. */
export const WAYPOINTS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 30_000;
/** Los puntos de paso admiten reintentos y Overpass público tarda decenas de segundos con carga. */
const WAYPOINTS_TIMEOUT_MS = 60_000;
export type SourceCacheRow = { payload: unknown; fetched_at: string; expires_at: string };
export type RouteSourceDependencies = {
  enabled: boolean; wikilocAuthorized: boolean; wikilocSearchTemplate: string; allowedOrigins: string[];
  authenticate: (token: string) => Promise<{ id: string; isAnonymous: boolean } | null>;
  consumeQuota: (userId: string) => Promise<{ allowed: boolean; retryAfterS: number }>;
  readCache: (key: string) => Promise<SourceCacheRow | null>;
  writeCache: (row: SourceCacheRow & { cache_key: string; source: 'wikiloc' | 'osm' }) => Promise<void>;
  claim: (source: 'wikiloc' | 'osm') => Promise<boolean>;
  fetch: typeof fetch;
  now?: () => number;
};
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
    const ttl = waypoints ? WAYPOINTS_CACHE_TTL_MS : CACHE_TTL_MS;
    const cached = await deps.readCache(key);
    signal.throwIfAborted();
    if (cached && Date.parse(cached.expires_at) > now() && Date.parse(cached.fetched_at) <= now()
      && Date.parse(cached.expires_at) - Date.parse(cached.fetched_at) === ttl) {
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
      await deps.writeCache({ cache_key: key, source: 'osm', payload: data, fetched_at: fetchedAt, expires_at: new Date(Date.parse(fetchedAt) + ttl).toISOString() });
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
