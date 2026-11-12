import { z } from 'zod';
import { DIRECCIONES } from '../contracts.ts';

const finite = (max: number) => z.number().finite().min(0).max(max);
const summarySchema = z.strictObject({
  fuente: z.enum(['historial', 'declarado']), semanas: finite(520).nullable(),
  salidas: finite(100_000), salidasPorSemana: finite(100), distanciaMediaKm: finite(2000),
  desnivelMedioM: finite(30_000), tiempoMedioMin: finite(30_000), velocidadMediaKmh: finite(150),
  distanciaMaxKm: finite(10_000), desnivelMaxM: finite(100_000), vamMediaMh: finite(20_000).nullable(),
  subidaMasLarga: z.strictObject({ km: finite(1000), pendienteMediaPct: finite(100) }).nullable(),
});
const factSchema = z.strictObject({
  id: z.string().regex(/^r[1-5]$/), titulo: z.string().max(60), distanciaKm: finite(2000), desnivelM: finite(30_000),
  tiempoEstimadoMin: finite(30_000).nullable(), carreteraNuevaPct: finite(100),
  dificultad: z.enum(['Suave', 'Media', 'Dura']).nullable(), sobreReferenciaPct: z.number().finite().min(-100).max(100_000),
  dimension: z.enum(['distancia', 'desnivel']),
  pendienteMaxima: z.enum(['de menos del 1 %', 'del 1 al 4 %', 'del 4 al 7 %', 'del 7 al 10 %', 'del 10 al 16 %', 'del 16 % o más']),
  limitadoPorTiempo: z.boolean(),
});
const spliceFactSchema = z.strictObject({
  id: z.string().regex(/^c([1-9]|1[0-2])$/), distanciaKm: finite(2000), desnivelM: finite(30_000).nullable(),
  viasPrincipalesPct: finite(100), conectorKm: finite(2000), solapeKm: finite(2000), retrocesoKm: finite(2000), alternativa: z.boolean(),
});
const referenceSchema = z.strictObject({
  id: z.string().regex(/^ref([1-9]|10)$/), nombre: z.string().trim().min(1).max(80), fuente: z.enum(['wikiloc', 'osm', 'biblioteca', 'rwgps']),
  distanciaKm: finite(2000), desnivelM: finite(200_000).nullable(),
  // Solo cifras y una de las 8 direcciones: nunca coordenadas.
  aInicioKm: finite(100).optional(), direccion: z.enum(DIRECCIONES).optional(),
});
const passSchema = z.strictObject({
  id: z.string().regex(/^pass[1-6]$/), nombre: z.string().trim().min(1).max(80),
  cotaM: finite(12_000).nullable(), distanciaKm: finite(40),
});
// Puntos de paso para combinar: nombre y cifras con un id propio (w1..w24); nunca coordenadas.
const waypointSchema = z.strictObject({
  id: z.string().regex(/^w([1-9]|1\d|2[0-4])$/), tipo: z.enum(['puerto', 'cima', 'pueblo', 'habitual']),
  nombre: z.string().trim().min(1).max(60), cotaM: finite(12_000).nullable(), distanciaKm: finite(100),
  direccion: z.enum(DIRECCIONES), interes: z.number().int().min(0).max(3),
});
const waypointGoalSchema = z.strictObject({ distanciaKm: finite(1000), desnivelM: finite(20_000).nullable() });
const dayIndex = z.number().int().min(0).max(6);
const uniqueDays = (min: number) => z.array(dayIndex).min(min).max(7).refine(days => new Set(days).size === days.length);
const weekGoalSchema = z.strictObject({
  diasHasta: z.number().int().min(0).max(3650), distanciaKm: finite(2000).nullable(), desnivelM: finite(30_000).nullable(),
});
// Objetivo del usuario como contexto de `plan` y `splice`: solo cifras; sin nombre ni lugar.
const aiGoalSchema = z.discriminatedUnion('tipo', [
  z.strictObject({ tipo: z.literal('evento'), diasHasta: z.number().int().min(0).max(730), distanciaKm: finite(1000).nullable(), desnivelM: finite(20_000).nullable() }),
  z.strictObject({ tipo: z.literal('volumen'), diasRestantes: z.number().int().min(0).max(366), distanciaRestanteKm: finite(5000).nullable(), desnivelRestanteM: finite(100_000).nullable() }),
]);
export const sharedAiRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('plan'), summary: summarySchema,
    answers: z.strictObject({ focus: z.enum(['fondo', 'subidas', 'mixto']), minutes: z.number().int().min(10).max(1440), explore: z.enum(['repetir', 'descubrir']), notes: z.literal('').default('') }),
    maxDistanciaKm: z.number().finite().min(0).max(200),
    referencias: z.array(referenceSchema).max(6).refine(refs => new Set(refs.map(ref => ref.id)).size === refs.length).optional(),
    puertos: z.array(passSchema).max(6).refine(passes => new Set(passes.map(pass => pass.id)).size === passes.length).optional(),
    objetivo: aiGoalSchema.nullable().optional(),
  }),
  z.strictObject({ operation: z.literal('explain'), summary: summarySchema, facts: z.array(factSchema).min(1).max(5).refine(facts => new Set(facts.map(fact => fact.id)).size === facts.length) }),
  z.strictObject({ operation: z.literal('splice'), facts: z.array(spliceFactSchema).min(1).max(12).refine(facts => new Set(facts.map(fact => fact.id)).size === facts.length),
    objetivo: aiGoalSchema.nullable().optional(),
  }),
  // Como en `plan`, las notas libres no salen del navegador por el servicio común.
  z.strictObject({ operation: z.literal('workouts'), summary: summarySchema, objetivo: weekGoalSchema.nullable(),
    ocupados: uniqueDays(0), disponibles: uniqueDays(1), notas: z.literal('').default('') }),
  z.strictObject({ operation: z.literal('waypoints'), objetivo: waypointGoalSchema,
    puntos: z.array(waypointSchema).min(1).max(24).refine(points => new Set(points.map(point => point.id)).size === points.length) }),
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
  if (!match) return fail(401, 'unauthorized', 'Inicia sesión para generar rutas.');
  let userId: string | null;
  try { userId = await deps.authenticate(match[1]); }
  catch { return fail(503, 'unavailable', 'No se pudo comprobar la sesión.'); }
  if (!userId) return fail(401, 'unauthorized', 'Inicia sesión para generar rutas.');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return fail(400, 'invalid_request', 'Petición no válida.');
  let input: SharedAiRequest;
  try {
    const raw = JSON.parse(await readBody(request));
    input = sharedAiRequestSchema.parse(raw);
  } catch (err) {
    return err instanceof RangeError ? fail(413, 'invalid_request', 'Petición demasiado grande.') : fail(400, 'invalid_request', 'Petición no válida.');
  }
  // Los títulos pueden proceder de ficheros y contener ubicaciones. Al modelo, solo etiquetas neutras.
  if (input.operation === 'explain') input.facts = input.facts.map((fact, index) => ({ ...fact, titulo: `Ruta ${index + 1}` }));
  if (request.signal.aborted) return fail(499, 'cancelled', 'Búsqueda cancelada.');
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
    if (controller.signal.aborted) return fail(timedOut ? 504 : 499, timedOut ? 'timeout' : 'cancelled', timedOut ? 'La IA está tardando demasiado. Vuelve a probar.' : 'Búsqueda cancelada.');
    if (!deps.validateOutput(input, output)) return fail(502, 'invalid_response', 'La IA no ha devuelto un resultado válido.');
    return Response.json({ data: output }, { headers: cors });
  } catch (error) {
    if (controller.signal.aborted) return fail(timedOut ? 504 : 499, timedOut ? 'timeout' : 'cancelled', timedOut ? 'La IA está tardando demasiado. Vuelve a probar.' : 'Búsqueda cancelada.');
    if (error instanceof SharedAiRateLimit) return fail(429, 'quota_exceeded', 'El servicio gratuito está ocupado. Inténtalo más tarde.', Math.max(1, Math.min(86_400, Math.ceil(error.retryAfterS) || 60)));
    return fail(502, 'provider_error', 'El servicio de IA no ha podido completar la búsqueda.');
  } finally {
    clearTimeout(timeout); request.signal.removeEventListener('abort', cancel);
  }
}
