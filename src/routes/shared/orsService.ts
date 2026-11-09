import { z } from 'zod';

/**
 * Motor de carreteras compartido (función `ors-proxy`). HTTP portable: el perfil, las opciones y la
 * clave los pone el servidor; el cliente solo elige una de dos operaciones con sus cifras.
 * Solo importa zod para que Deno lo pueda cargar tal cual.
 */

const point = z.strictObject({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) });
export const sharedOrsRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    operation: z.literal('round_trip'), start: point,
    lengthM: z.number().finite().positive().max(300_000), points: z.number().int().min(2).max(10), seed: z.number().int().min(0).max(2 ** 31 - 1),
  }),
  z.strictObject({
    operation: z.literal('path'), waypoints: z.array(point).min(2).max(8),
    alternatives: z.number().int().min(2).max(3).optional(),
  }).refine(r => r.alternatives === undefined || r.waypoints.length === 2, 'ORS solo da alternativas entre dos puntos'),
]);
export type SharedOrsRequest = z.infer<typeof sharedOrsRequestSchema>;

/** Cuerpo de `POST /v2/directions/cycling-road/geojson`. Lo usan también las peticiones con clave personal. */
export function buildOrsBody(r: SharedOrsRequest): object {
  // `waycategory` (bit 1 = autopista): descarta autopistas en las vueltas y en los conectores de los empalmes.
  const common = { elevation: true, instructions: false, extra_info: ['surface', 'waytype', 'steepness', 'waycategory'] };
  const avoid_features = ['ferries', 'fords', 'steps'];
  if (r.operation === 'round_trip') {
    return {
      coordinates: [[r.start.lng, r.start.lat]], ...common,
      options: { round_trip: { length: r.lengthM, points: r.points, seed: r.seed }, avoid_features },
    };
  }
  return {
    coordinates: r.waypoints.map(p => [p.lng, p.lat]), ...common, options: { avoid_features },
    // Valores por defecto documentados de ORS; solo admite alternativas con dos coordenadas.
    ...(r.alternatives ? { alternative_routes: { target_count: r.alternatives, weight_factor: 1.4, share_factor: 0.6 } } : {}),
  };
}

export type SharedOrsDependencies = {
  enabled: boolean;
  allowedOrigins: string[];
  authenticate: (token: string) => Promise<string | null>;
  consumeQuota: (userId: string, cost: number) => Promise<{ allowed: boolean; retryAfterS: number }>;
  /** Llama a ORS con la clave del servidor. `json` es el cuerpo ya leído (o null si no era JSON). */
  route: (body: object, signal: AbortSignal) => Promise<{ status: number; json: unknown }>;
};

const MAX_BODY_BYTES = 8_000;
const MAX_POINTS = 50_000;
const TIMEOUT_MS = 20_000;
/** Códigos de ORS para «sin ruta» y «punto no encontrado». */
const NO_ROUTE_CODES = new Set([2009, 2010]);
const EXTRAS = ['surface', 'waytypes', 'steepness', 'waycategory'] as const;

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

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Solo geometría, resumen y extras; fuera `metadata.query`, `segments` y demás. `null` si no es válido. */
function trimFeatures(json: unknown): object[] | null {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features) || features.length === 0 || features.length > 4) return null;
  const out: object[] = [];
  for (const f of features as { geometry?: { coordinates?: unknown }; properties?: { summary?: Record<string, unknown>; extras?: Record<string, unknown> } }[]) {
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2 || coords.length > MAX_POINTS) return null;
    if (!coords.every(c => Array.isArray(c) && c.length >= 2 && c.length <= 3 && c.every(finite))) return null;
    const summary = f.properties?.summary;
    if (!summary || !finite(summary.distance) || !finite(summary.duration)) return null;
    const extras = f.properties?.extras ?? {};
    out.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {
        summary: { distance: summary.distance, duration: summary.duration, ...(finite(summary.ascent) ? { ascent: summary.ascent } : {}), ...(finite(summary.descent) ? { descent: summary.descent } : {}) },
        extras: Object.fromEntries(EXTRAS.filter(k => extras[k] !== undefined).map(k => [k, extras[k]])),
      },
    });
  }
  return out;
}

/** Nunca registra coordenadas ni reenvía el texto de ORS, que las repite. */
export async function handleSharedOrs(request: Request, deps: SharedOrsDependencies): Promise<Response> {
  const origin = request.headers.get('origin');
  const cors: Record<string, string> = { Vary: 'Origin', 'Cache-Control': 'no-store', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (origin && deps.allowedOrigins.includes(origin)) cors['Access-Control-Allow-Origin'] = origin;
  const fail = (status: number, code: string, message: string, retryAfterS?: number) => Response.json({ error: { code, message }, ...(retryAfterS !== undefined ? { retryAfterS } : {}) }, { status, headers: { ...cors, ...(retryAfterS !== undefined ? { 'Retry-After': String(retryAfterS) } : {}) } });
  if (origin && !deps.allowedOrigins.includes(origin)) return fail(403, 'origin_not_allowed', 'Origen no permitido.');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Método no permitido.');
  if (!deps.enabled) return fail(503, 'unavailable', 'El servicio común de rutas todavía no está disponible.');
  const match = /^Bearer ([^\s]{1,4096})$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) return fail(401, 'unauthorized', 'Inicia sesión para calcular rutas.');
  let userId: string | null;
  try { userId = await deps.authenticate(match[1]); }
  catch { return fail(503, 'unavailable', 'No se pudo comprobar la sesión.'); }
  if (!userId) return fail(401, 'unauthorized', 'Inicia sesión para calcular rutas.');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return fail(400, 'invalid_request', 'Petición no válida.');
  let input: SharedOrsRequest;
  try {
    input = sharedOrsRequestSchema.parse(JSON.parse(await readBody(request)));
  } catch (err) {
    return err instanceof RangeError ? fail(413, 'invalid_request', 'Petición demasiado grande.') : fail(400, 'invalid_request', 'Petición no válida.');
  }
  if (request.signal.aborted) return fail(499, 'cancelled', 'Búsqueda cancelada.');
  try {
    // Una consulta a ORS por petición, también con alternativas.
    const quota = await deps.consumeQuota(userId, 1);
    if (!quota.allowed) return fail(429, 'quota_exceeded', 'Has alcanzado el límite del servicio común de rutas.', Math.max(1, Math.ceil(quota.retryAfterS)));
  } catch { return fail(503, 'unavailable', 'No se pudo comprobar la cuota.'); }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  const cancel = () => controller.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  const aborted = () => {
    if (timedOut) return fail(504, 'timeout', 'El motor de rutas está tardando demasiado. Vuelve a probar.');
    return fail(499, 'cancelled', 'Búsqueda cancelada.');
  };
  try {
    const { status, json } = await deps.route(buildOrsBody(input), controller.signal);
    if (controller.signal.aborted) return aborted();
    const orsCode = (json as { error?: { code?: unknown } } | null)?.error?.code;
    if (status === 404 || (typeof orsCode === 'number' && NO_ROUTE_CODES.has(orsCode))) return fail(404, 'no_route', 'No hay carreteras desde ese punto. Mueve el inicio a una carretera.');
    if (status === 429) return fail(429, 'quota_exceeded', 'El motor de rutas está saturado. Espera un minuto.', 60);
    if (status === 401 || status === 403) return fail(503, 'unavailable', 'El servicio común de rutas no está disponible ahora.');
    if (status !== 200) return fail(502, 'provider_error', 'El motor de rutas no ha podido calcular esta ruta.');
    const features = trimFeatures(json);
    if (!features) return fail(502, 'invalid_response', 'El motor de rutas no ha devuelto un trazado válido.');
    return Response.json({ data: { features } }, { headers: cors });
  } catch {
    if (controller.signal.aborted) return aborted();
    return fail(502, 'provider_error', 'El motor de rutas no ha podido calcular esta ruta.');
  } finally {
    clearTimeout(timeout); request.signal.removeEventListener('abort', cancel);
  }
}
