import { z } from 'zod';

/**
 * Ride with GPS compartido (función `rwgps`). HTTP portable: la clave de API y el token de la cuenta
 * común solo existen en el servidor y nunca se devuelven. El cliente solo elige una ruta o una
 * colección por su id; la URL la construye el servidor con una lista cerrada de dos lecturas GET.
 * Solo importa zod para que Deno lo pueda cargar tal cual.
 */

export const rwgpsRequestSchema = z.strictObject({
  kind: z.enum(['route', 'collection']),
  id: z.string().regex(/^[1-9]\d{0,11}$/),
  privacyCode: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
});
export type RwgpsRequest = z.infer<typeof rwgpsRequestSchema>;

/** Única forma de construir la petición a Ride with GPS: `/api/v1/routes/{id}.json` o `/api/v1/collections/{id}.json`. */
export function rwgpsApiPath(r: RwgpsRequest): string {
  const query = r.privacyCode ? `?privacy_code=${encodeURIComponent(r.privacyCode)}` : '';
  return `/api/v1/${r.kind === 'route' ? 'routes' : 'collections'}/${r.id}.json${query}`;
}

export type RwgpsServiceDependencies = {
  enabled: boolean;
  allowedOrigins: string[];
  authenticate: (token: string) => Promise<string | null>;
  consumeQuota: (userId: string) => Promise<{ allowed: boolean; retryAfterS: number }>;
  /** GET a Ride with GPS con la clave y el token del servidor. `json` es el cuerpo ya leído (o null). */
  get: (path: string, signal: AbortSignal) => Promise<{ status: number; json: unknown }>;
};

const MAX_BODY_BYTES = 2_000;
const MAX_TRACK_POINTS = 100_000;
const MAX_COLLECTION_ROUTES = 2_000;
const TIMEOUT_MS = 20_000;

/** En zod 4, `z.number()` ya rechaza NaN e Infinity. */
const finite = z.number();
const routeSchema = z.object({
  route: z.object({
    name: z.string().max(500).nullish(),
    user: z.object({ name: z.string().max(200).nullish() }).nullish(),
    track_points: z.array(z.object({ x: finite.min(-180).max(180), y: finite.min(-90).max(90), e: finite.nullish() })).min(2).max(MAX_TRACK_POINTS),
  }),
});
const collectionSchema = z.object({
  collection: z.object({
    name: z.string().max(500).nullish(),
    routes: z.array(z.object({ id: z.number().int().positive() })).max(MAX_COLLECTION_ROUTES).nullish(),
  }),
});

/** `visibility` documentada en Route y Collection (OpenAPI v1). Si falta, no se da por pública. */
function isPublic(kind: RwgpsRequest['kind'], json: unknown): boolean {
  const body = json as { route?: { visibility?: unknown }; collection?: { visibility?: unknown } } | null;
  return (kind === 'route' ? body?.route?.visibility : body?.collection?.visibility) === 'public';
}

/** Solo nombre, autor y puntos (o ids de rutas): nada más de la cuenta ni de la respuesta original. */
export function trimRwgpsResponse(kind: RwgpsRequest['kind'], json: unknown): object | null {
  if (kind === 'route') {
    const parsed = routeSchema.safeParse(json);
    if (!parsed.success) return null;
    const { route } = parsed.data;
    return {
      route: {
        name: route.name ?? null,
        user: { name: route.user?.name ?? null },
        track_points: route.track_points.map(p => (typeof p.e === 'number' ? { x: p.x, y: p.y, e: p.e } : { x: p.x, y: p.y })),
      },
    };
  }
  const parsed = collectionSchema.safeParse(json);
  if (!parsed.success) return null;
  return { collection: { name: parsed.data.collection.name ?? null, routes: (parsed.data.collection.routes ?? []).map(r => ({ id: r.id })) } };
}

async function readBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new RangeError('body'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Nunca registra ni reenvía la clave, el token ni el texto de error de Ride with GPS. */
export async function handleRwgps(request: Request, deps: RwgpsServiceDependencies): Promise<Response> {
  const origin = request.headers.get('origin');
  const cors: Record<string, string> = { Vary: 'Origin', 'Cache-Control': 'no-store', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (origin && deps.allowedOrigins.includes(origin)) cors['Access-Control-Allow-Origin'] = origin;
  const fail = (status: number, code: string, message: string, retryAfterS?: number) => Response.json({ error: { code, message }, ...(retryAfterS !== undefined ? { retryAfterS } : {}) }, { status, headers: { ...cors, ...(retryAfterS !== undefined ? { 'Retry-After': String(retryAfterS) } : {}) } });
  if (origin && !deps.allowedOrigins.includes(origin)) return fail(403, 'origin_not_allowed', 'Origen no permitido.');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Método no permitido.');
  if (!deps.enabled) return fail(503, 'unavailable', 'Ride with GPS todavía no está disponible.');
  const match = /^Bearer ([^\s]{1,4096})$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) return fail(401, 'unauthorized', 'Inicia sesión para traer rutas de Ride with GPS.');
  let userId: string | null;
  try { userId = await deps.authenticate(match[1]); }
  catch { return fail(503, 'unavailable', 'No se pudo comprobar la sesión.'); }
  if (!userId) return fail(401, 'unauthorized', 'Inicia sesión para traer rutas de Ride with GPS.');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return fail(400, 'invalid_request', 'Petición no válida.');
  let input: RwgpsRequest;
  try {
    input = rwgpsRequestSchema.parse(JSON.parse(await readBody(request)));
  } catch (err) {
    return err instanceof RangeError ? fail(413, 'invalid_request', 'Petición demasiado grande.') : fail(400, 'invalid_request', 'Petición no válida.');
  }
  if (request.signal.aborted) return fail(499, 'cancelled', 'Cancelado.');
  try {
    const quota = await deps.consumeQuota(userId);
    if (!quota.allowed) return fail(429, 'quota_exceeded', 'Has alcanzado el límite diario de Ride with GPS.', Math.max(1, Math.ceil(quota.retryAfterS)));
  } catch { return fail(503, 'unavailable', 'No se pudo comprobar la cuota.'); }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  const cancel = () => controller.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  const aborted = () => (timedOut ? fail(504, 'timeout', 'Ride with GPS está tardando demasiado. Vuelve a probar.') : fail(499, 'cancelled', 'Cancelado.'));
  try {
    const { status, json } = await deps.get(rwgpsApiPath(input), controller.signal);
    if (controller.signal.aborted) return aborted();
    if (status === 403) return fail(403, 'not_visible', 'La ruta no es pública en Ride with GPS.');
    if (status === 404) return fail(404, 'not_found', 'No existe en Ride with GPS.');
    if (status === 429) return fail(429, 'provider_busy', 'Ride with GPS limita las peticiones ahora.', 60);
    if (status === 401) return fail(503, 'unavailable', 'Ride with GPS no está disponible ahora.');
    if (status !== 200) return fail(502, 'provider_error', 'Ride with GPS no ha respondido bien.');
    // El token común también abre lo privado de la cuenta común: sin privacy_code, solo lo público.
    if (!input.privacyCode && !isPublic(input.kind, json)) return fail(403, 'not_visible', 'La ruta no es pública en Ride with GPS.');
    const data = trimRwgpsResponse(input.kind, json);
    if (!data) return fail(502, 'invalid_response', 'Ride with GPS ha devuelto datos que no se entienden.');
    return Response.json({ data }, { headers: cors });
  } catch {
    if (controller.signal.aborted) return aborted();
    return fail(502, 'provider_error', 'Ride with GPS no ha respondido bien.');
  } finally {
    clearTimeout(timeout); request.signal.removeEventListener('abort', cancel);
  }
}
