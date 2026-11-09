import { z } from 'zod';
import { routeSearchSchema, routeReferencesSchema, RouteSourceError, type RouteReference, type RouteSearch } from './schema';
import { loadOverpass, loadWikiloc, readLimited, sourceTransport } from './providers';
import { normalizeRouteSearch, simplifyRouteReference, MAX_REFERENCE_POINTS } from './limits';

const requestSchema = routeSearchSchema.extend({ source: z.enum(['wikiloc', 'osm']).default('wikiloc') });
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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
export async function sourceCacheKey(source: string, search: RouteSearch): Promise<string> {
  // No almacena el punto de consulta legible en la clave de caché.
  const normalized = normalizeRouteSearch(search);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([source, normalized.lat, normalized.lon, normalized.radiusM])));
  return `v2:${source}:${Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')}`;
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
  const { source, ...rawSearch } = input;
  const search = normalizeRouteSearch(rawSearch);
  const now = deps.now ?? Date.now;
  const controller = new AbortController();
  const signal = controller.signal;
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const cancel = () => controller.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  try {
    signal.throwIfAborted();
    const quota = await deps.consumeQuota(userId);
    signal.throwIfAborted();
    if (!quota.allowed) return fail(429, 'quota_exceeded', Math.max(1, Math.min(86400, Math.ceil(quota.retryAfterS) || 30)));
    const key = await sourceCacheKey(source, search);
    const cached = await deps.readCache(key);
    signal.throwIfAborted();
    if (cached && Date.parse(cached.expires_at) > now() && Date.parse(cached.fetched_at) <= now()
      && Date.parse(cached.expires_at) - Date.parse(cached.fetched_at) === CACHE_TTL_MS) {
      const parsed = routeReferencesSchema.safeParse(cached.payload);
      if (parsed.success && parsed.data.every(route => route.source === input.source && Date.parse(route.fetchedAt) === Date.parse(cached.fetched_at)
        && (!route.geometry || route.geometry.coordinates.reduce((n, line) => n + line.length, 0) <= MAX_REFERENCE_POINTS))) {
        return Response.json({ data: parsed.data }, { headers });
      }
    }
    signal.throwIfAborted();
    const fetchedAt = new Date(now()).toISOString();
    const transport = sourceTransport(source, { fetch: deps.fetch, claim: deps.claim, signal });
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
