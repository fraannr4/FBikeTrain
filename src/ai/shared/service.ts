import { z } from 'zod';

const finite = (max: number) => z.number().finite().min(0).max(max);
const summarySchema = z.strictObject({
  fuente: z.enum(['historial', 'declarado']), semanas: finite(520).nullable(),
  salidas: finite(100_000), salidasPorSemana: finite(100), distanciaMediaKm: finite(2000),
  desnivelMedioM: finite(30_000), tiempoMedioMin: finite(30_000), velocidadMediaKmh: finite(150),
  distanciaMaxKm: finite(10_000), desnivelMaxM: finite(100_000), vamMediaMh: finite(20_000).nullable(),
  subidaMasLarga: z.strictObject({ km: finite(1000), pendienteMediaPct: finite(100) }).nullable(),
});
const dayIndex = z.number().int().min(0).max(6);
const uniqueDays = (min: number) => z.array(dayIndex).min(min).max(7).refine(days => new Set(days).size === days.length);
const weekGoalSchema = z.strictObject({
  diasHasta: z.number().int().min(0).max(3650), distanciaKm: finite(2000).nullable(), desnivelM: finite(30_000).nullable(),
});
// Solo queda la semana con IA: las operaciones de rutas (plan, explain, splice, waypoints) se han retirado.
// Como antes, las notas libres no salen del navegador por el servicio común.
export const sharedAiRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('workouts'), summary: summarySchema, objetivo: weekGoalSchema.nullable(),
    ocupados: uniqueDays(0), disponibles: uniqueDays(1), notas: z.literal('').default('') }),
]);
export type SharedAiRequest = z.infer<typeof sharedAiRequestSchema>;
export type SharedAiDependencies = {
  enabled: boolean;
  allowedOrigins: string[];
  authenticate: (token: string) => Promise<string | null>;
  consumeQuota: (userId: string) => Promise<{ allowed: boolean; retryAfterS: number }>;
  complete: (input: SharedAiRequest, signal: AbortSignal) => Promise<unknown>;
  validateOutput: (input: SharedAiRequest, output: unknown) => boolean;
};
/** Solo metadatos controlados; nunca texto del proveedor. */
export class SharedAiRateLimit extends Error {
  constructor(public retryAfterS = 60) { super('provider_rate_limit'); }
}

const MAX_BODY_BYTES = 24_000;
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

/** HTTP portable: el modelo, prompt y proveedor los controla la función, nunca el cliente. */
export async function handleSharedAi(request: Request, deps: SharedAiDependencies): Promise<Response> {
  const origin = request.headers.get('origin');
  const cors: Record<string, string> = { Vary: 'Origin', 'Cache-Control': 'no-store', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (origin && deps.allowedOrigins.includes(origin)) cors['Access-Control-Allow-Origin'] = origin;
  const fail = (status: number, code: string, message: string, retryAfterS?: number) => Response.json({ error: { code, message }, ...(retryAfterS !== undefined ? { retryAfterS } : {}) }, { status, headers: { ...cors, ...(retryAfterS !== undefined ? { 'Retry-After': String(retryAfterS) } : {}) } });
  if (origin && !deps.allowedOrigins.includes(origin)) return fail(403, 'origin_not_allowed', 'Origen no permitido.');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Método no permitido.');
  if (!deps.enabled) return fail(503, 'unavailable', 'El servicio compartido todavía no está disponible.');
  const match = /^Bearer ([^\s]{1,4096})$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) return fail(401, 'unauthorized', 'Inicia sesión para usar la IA compartida.');
  let userId: string | null;
  try { userId = await deps.authenticate(match[1]); }
  catch { return fail(503, 'unavailable', 'No se pudo comprobar la sesión.'); }
  if (!userId) return fail(401, 'unauthorized', 'Inicia sesión para usar la IA compartida.');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return fail(400, 'invalid_request', 'Petición no válida.');
  let input: SharedAiRequest;
  try {
    const raw = JSON.parse(await readBody(request));
    input = sharedAiRequestSchema.parse(raw);
  } catch (err) {
    return err instanceof RangeError ? fail(413, 'invalid_request', 'Petición demasiado grande.') : fail(400, 'invalid_request', 'Petición no válida.');
  }
  if (request.signal.aborted) return fail(499, 'cancelled', 'Petición cancelada.');
  try {
    const quota = await deps.consumeQuota(userId);
    if (!quota.allowed) return fail(429, 'quota_exceeded', 'Has alcanzado el límite del servicio gratuito. Inténtalo más tarde.', Math.max(1, Math.ceil(quota.retryAfterS)));
  } catch { return fail(503, 'unavailable', 'No se pudo comprobar la cuota.'); }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
  const cancel = () => controller.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  try {
    const output = await deps.complete(input, controller.signal);
    if (controller.signal.aborted) return fail(timedOut ? 504 : 499, timedOut ? 'timeout' : 'cancelled', timedOut ? 'La IA está tardando demasiado. Vuelve a probar.' : 'Petición cancelada.');
    if (!deps.validateOutput(input, output)) return fail(502, 'invalid_response', 'La IA no ha devuelto un resultado válido.');
    return Response.json({ data: output }, { headers: cors });
  } catch (error) {
    if (controller.signal.aborted) return fail(timedOut ? 504 : 499, timedOut ? 'timeout' : 'cancelled', timedOut ? 'La IA está tardando demasiado. Vuelve a probar.' : 'Petición cancelada.');
    if (error instanceof SharedAiRateLimit) return fail(429, 'quota_exceeded', 'El servicio gratuito está ocupado. Inténtalo más tarde.', Math.max(1, Math.min(86_400, Math.ceil(error.retryAfterS) || 60)));
    return fail(502, 'provider_error', 'El servicio de IA no ha podido completar la petición.');
  } finally {
    clearTimeout(timeout); request.signal.removeEventListener('abort', cancel);
  }
}
