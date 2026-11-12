import { z } from 'zod';
import { buildIndexRow, type RwgpsIndexRow } from './rwgpsSync.ts';

/**
 * Ride with GPS compartido (función `rwgps`). HTTP portable: la clave de API y el token de la cuenta
 * común solo existen en el servidor y nunca se devuelven. El cliente solo elige una ruta o una
 * colección por su id, o rutas cerca de un punto del índice propio (`op: 'nearby'`); la URL la construye
 * el servidor con una lista cerrada de lecturas GET. Solo importa zod y módulos locales para que Deno lo
 * pueda cargar tal cual.
 */

export const rwgpsRequestSchema = z.strictObject({
  kind: z.enum(['route', 'collection']),
  id: z.string().regex(/^[1-9]\d{0,11}$/),
  /** Se acepta por compatibilidad con clientes antiguos, pero no se usa: ver `isPublic`. */
  privacyCode: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
});
export type RwgpsRequest = z.infer<typeof rwgpsRequestSchema>;

/** Rutas del índice propio que pasan a menos de `radiusKm` del punto. */
export const rwgpsNearbySchema = z.strictObject({
  op: z.literal('nearby'),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusKm: z.number().min(1).max(30).default(10),
  distanceKm: z.number().min(5).max(300).optional(),
});
export type RwgpsNearbyRequest = z.infer<typeof rwgpsNearbySchema>;
/** Sin `op` sigue siendo una lectura de ruta o colección, como antes. */
const bodySchema = z.union([rwgpsRequestSchema, rwgpsNearbySchema]);

/** Única forma de construir la petición a Ride with GPS: `/api/v1/routes/{id}.json` o `/api/v1/collections/{id}.json`. */
export function rwgpsApiPath(r: RwgpsRequest): string {
  return `/api/v1/${r.kind === 'route' ? 'routes' : 'collections'}/${r.id}.json`;
}

/** Lista cerrada de GET a Ride with GPS: una ruta, una colección, o una página de las de la cuenta común. */
export function isAllowedRwgpsPath(path: string): boolean {
  return /^\/api\/v1\/(routes|collections)\/[1-9]\d{0,11}\.json$/.test(path)
    || /^\/api\/v1\/(routes|collections)\.json\?page=[1-9]\d{0,2}&page_size=200$/.test(path);
}

export type RwgpsServiceDependencies = {
  enabled: boolean;
  allowedOrigins: string[];
  authenticate: (token: string) => Promise<string | null>;
  consumeQuota: (userId: string) => Promise<{ allowed: boolean; retryAfterS: number }>;
  /** GET a Ride with GPS con la clave y el token del servidor. `json` es el cuerpo ya leído (o null). */
  get: (path: string, signal: AbortSignal) => Promise<{ status: number; json: unknown }>;
  /** Filas del índice cuya caja, ampliada con el radio, contiene el punto (rpc `rwgps_routes_near`). */
  near: (lat: number, lng: number, radiusKm: number) => Promise<RwgpsIndexRow[]>;
  /** Última sincronización del índice, o null si nunca. */
  lastSyncAt: () => Promise<Date | null>;
  /** Lanza la sincronización en segundo plano. No debe esperar ni lanzar. */
  scheduleSync: () => void;
  /** Añade al índice una ruta pública leída por alguien, en segundo plano. Los fallos se ignoran. */
  indexRoute: (row: RwgpsIndexRow) => void;
};

export const SYNC_EVERY_MS = 6 * 60 * 60 * 1000;
export const MAX_NEARBY_ROUTES = 60;

const MAX_BODY_BYTES = 2_000;
const MAX_TRACK_POINTS = 100_000;
const MAX_COLLECTION_ROUTES = 2_000;
const TIMEOUT_MS = 20_000;
const EARTH_M = 6_371_008.8;

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

const indexRowSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d{0,11}$/)]),
  name: z.string().nullish(), author: z.string().nullish(),
  distance_m: z.number().nonnegative(), elev_gain_m: z.number().nullish(),
  start_lat: z.number(), start_lng: z.number(),
  line: z.array(z.tuple([z.number(), z.number()])).min(2),
});

/** Distancia mínima en metros del punto a la polilínea `[[lng, lat], ...]`, proyectada en plano local. */
export function passDistanceM(lat: number, lng: number, line: [number, number][]): number {
  const k = (Math.PI / 180) * EARTH_M;
  const cos = Math.cos(lat * (Math.PI / 180));
  const xy = line.map(([x, y]) => [(x - lng) * k * cos, (y - lat) * k] as const);
  let best = Infinity;
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1]; const [bx, by] = xy[i];
    const dx = bx - ax; const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** Rutas que pasan cerca, ordenadas por cercanía a la distancia pedida (si la hay) y por paso. */
export function rankNearby(input: RwgpsNearbyRequest, rows: unknown[]) {
  const target = input.distanceKm === undefined ? null : input.distanceKm * 1000;
  const found = rows.flatMap(raw => {
    const parsed = indexRowSchema.safeParse(raw);
    if (!parsed.success) return [];
    const r = parsed.data;
    const passM = Math.round(passDistanceM(input.lat, input.lng, r.line));
    if (!(passM <= input.radiusKm * 1000)) return [];
    return [{ id: String(r.id), name: r.name ?? '', author: r.author ?? '', distanceM: r.distance_m, elevGainM: r.elev_gain_m ?? null, start: { lat: r.start_lat, lng: r.start_lng }, line: r.line, passM }];
  });
  found.sort((a, b) => (target === null ? 0 : Math.abs(a.distanceM - target) - Math.abs(b.distanceM - target)) || a.passM - b.passM);
  return { routes: found.slice(0, MAX_NEARBY_ROUTES), total: found.length };
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
  let body: RwgpsRequest | RwgpsNearbyRequest;
  try {
    body = bodySchema.parse(JSON.parse(await readBody(request)));
  } catch (err) {
    return err instanceof RangeError ? fail(413, 'invalid_request', 'Petición demasiado grande.') : fail(400, 'invalid_request', 'Petición no válida.');
  }
  if (request.signal.aborted) return fail(499, 'cancelled', 'Cancelado.');
  try {
    const quota = await deps.consumeQuota(userId);
    if (!quota.allowed) return fail(429, 'quota_exceeded', 'Has alcanzado el límite diario de Ride with GPS.', Math.max(1, Math.ceil(quota.retryAfterS)));
  } catch { return fail(503, 'unavailable', 'No se pudo comprobar la cuota.'); }
  if ('op' in body) return nearby(body, deps, cors, fail);
  const input = body;

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
    // El token común abre lo privado de la cuenta común con cualquier privacy_code, y la API no devuelve
    // el código para comprobarlo: solo sale lo público.
    if (!isPublic(input.kind, json)) return fail(403, 'not_visible', 'La ruta no es pública en Ride with GPS.');
    const data = trimRwgpsResponse(input.kind, json);
    if (!data) return fail(502, 'invalid_response', 'Ride with GPS ha devuelto datos que no se entienden.');
    if (input.kind === 'route') {
      const row = buildIndexRow(Number(input.id), json, 'user');
      if (row) try { deps.indexRoute(row); } catch { /* el índice es un extra: la lectura responde igual */ }
    }
    return Response.json({ data }, { headers: cors });
  } catch {
    if (controller.signal.aborted) return aborted();
    return fail(502, 'provider_error', 'Ride with GPS no ha respondido bien.');
  } finally {
    clearTimeout(timeout); request.signal.removeEventListener('abort', cancel);
  }
}

async function nearby(input: RwgpsNearbyRequest, deps: RwgpsServiceDependencies, cors: Record<string, string>, fail: (status: number, code: string, message: string) => Response): Promise<Response> {
  // La comprobación de la sincronización va en paralelo y nunca rompe ni retrasa el error de la respuesta.
  const lastSync = deps.lastSyncAt().then(at => at, () => undefined);
  let rows: RwgpsIndexRow[];
  try { rows = await deps.near(input.lat, input.lng, input.radiusKm); }
  catch { return fail(503, 'unavailable', 'El índice de rutas no está disponible ahora.'); }
  const at = await lastSync;
  if (at === null || (at instanceof Date && Date.now() - at.getTime() > SYNC_EVERY_MS)) {
    try { deps.scheduleSync(); } catch { /* en segundo plano: no afecta a la respuesta */ }
  }
  return Response.json({ data: rankNearby(input, rows) }, { headers: cors });
}
