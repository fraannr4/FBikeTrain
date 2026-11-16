import { createClient } from '@supabase/supabase-js';
import type { LinePoint } from '../../../src/routes/library/cells.ts';
import { buildHeatCells } from '../../../src/routes/library/heat.ts';
import { handleRwgps, SYNC_EVERY_MS } from '../../../src/routes/sources/rwgpsService.ts';
import { syncReferenceRoutes } from '../../../src/routes/sources/rwgpsSync.ts';
import { rwgpsApi } from '../_shared/rwgpsApi.ts';

// Cuenta común de Ride with GPS. Secrets del proyecto (Dashboard → Edge Functions → Secrets):
// RWGPS_API_KEY y, o bien RWGPS_AUTH_TOKEN, o bien RWGPS_EMAIL + RWGPS_PASSWORD.
// Nada de esto sale nunca en una respuesta ni en los registros.
/** Una pasada de sincronización en segundo plano no pasa de 2 min (cada petición, 20 s). */
const SYNC_TIMEOUT_MS = 120_000;
const SYNC_REQUEST_TIMEOUT_MS = 20_000;
/** Celdas de calor por llamada a `replace_reference_heat_cells`. */
const HEAT_CHUNK = 3_000;
/** Margen (grados, ≈ 1 km) para leer también las rutas que solo rozan el borde de la caja que se recalcula. */
const HEAT_MARGIN_DEG = 0.01;
const projectUrl = Deno.env.get('SUPABASE_URL') ?? '';
const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const api = rwgpsApi({
  apiKey: Deno.env.get('RWGPS_API_KEY') ?? '',
  fixedToken: Deno.env.get('RWGPS_AUTH_TOKEN') ?? '',
  email: Deno.env.get('RWGPS_EMAIL') ?? '',
  password: Deno.env.get('RWGPS_PASSWORD') ?? '',
});
const enabled = Boolean(projectUrl && publicKey && serviceKey) && api.enabled;
const allowedOrigins = (Deno.env.get('APP_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean);

const fetchTimed: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10_000)]) });
const serverClient = (key: string) => createClient(projectUrl, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchTimed } });

/** Tareas que siguen tras responder: `EdgeRuntime.waitUntil` si existe. Nunca lanzan. */
function background(task: () => Promise<unknown>): void {
  const running = task().catch(() => {});
  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(running);
}

type Box = { minLat: number; maxLat: number; minLng: number; maxLng: number };
const boxOf = (r: { min_lat: number; max_lat: number; min_lng: number; max_lng: number }): Box => ({ minLat: r.min_lat, maxLat: r.max_lat, minLng: r.min_lng, maxLng: r.max_lng });
const union = (a: Box | null, b: Box): Box => (a ? { minLat: Math.min(a.minLat, b.minLat), maxLat: Math.max(a.maxLat, b.maxLat), minLng: Math.min(a.minLng, b.minLng), maxLng: Math.max(a.maxLng, b.maxLng) } : b);

/** Recalcula las celdas de calor de la caja con todas las rutas de referencia que pasan por ella o cerca. */
async function refreshHeat(admin: ReturnType<typeof serverClient>, box: Box): Promise<void> {
  const { data, error } = await admin.rpc('reference_routes_in_box', {
    p_min_lat: box.minLat - HEAT_MARGIN_DEG, p_max_lat: box.maxLat + HEAT_MARGIN_DEG, p_min_lng: box.minLng - HEAT_MARGIN_DEG, p_max_lng: box.maxLng + HEAT_MARGIN_DEG,
  });
  if (error) throw new Error('heat');
  const cells = buildHeatCells(((data ?? []) as { line: LinePoint[] }[]).map(r => r.line))
    .filter(c => c.lat >= box.minLat && c.lat <= box.maxLat && c.lng >= box.minLng && c.lng <= box.maxLng);
  // El primer trozo borra las celdas de la caja; los siguientes solo añaden.
  for (let i = 0; i === 0 || i < cells.length; i += HEAT_CHUNK) {
    const { error } = await admin.rpc('replace_reference_heat_cells', { p_cells: cells.slice(i, i + HEAT_CHUNK), p_box: box, p_append: i > 0 });
    if (error) throw new Error('heat');
  }
}

/**
 * Pasada de sincronización de la biblioteca común (`reference_routes`, `source = 'rwgps'`) y del calor
 * de las cajas tocadas. La reserva es atómica: una sola pasada cada 6 h aunque lleguen varias peticiones.
 */
async function runSync(): Promise<void> {
  const admin = serverClient(serviceKey);
  const staleBefore = new Date(Date.now() - SYNC_EVERY_MS).toISOString();
  const { data: claimed, error } = await admin.from('rwgps_sync_state').update({ last_sync_at: new Date().toISOString() })
    .eq('id', 1).or(`last_sync_at.is.null,last_sync_at.lt."${staleBefore}"`).select('id');
  if (error || !claimed?.length) return;
  /** Unión de las cajas de las filas subidas o borradas en esta pasada. */
  const touched: { box: Box | null } = { box: null };
  const result = await syncReferenceRoutes({
    get: (path, signal) => api.get(path, AbortSignal.any([signal, AbortSignal.timeout(SYNC_REQUEST_TIMEOUT_MS)])),
    importedAt: async sourceIds => {
      const known = new Map<string, number>();
      for (let i = 0; i < sourceIds.length; i += 200) {
        const { data, error } = await admin.from('reference_routes').select('source_id,imported_at').eq('source', 'rwgps').in('source_id', sourceIds.slice(i, i + 200));
        if (error) throw new Error('library');
        for (const row of data ?? []) known.set(String(row.source_id), Date.parse(row.imported_at));
      }
      return known;
    },
    upsert: async row => {
      const { error } = await admin.rpc('upsert_reference_routes', { p_rows: [row] });
      if (error) throw new Error('library');
      touched.box = union(touched.box, boxOf(row));
    },
    remove: async sourceId => {
      const { data, error } = await admin.from('reference_routes').delete().eq('source', 'rwgps').eq('source_id', sourceId).select('min_lat,max_lat,min_lng,max_lng');
      if (error) throw new Error('library');
      for (const row of data ?? []) touched.box = union(touched.box, boxOf(row));
    },
  }, AbortSignal.timeout(SYNC_TIMEOUT_MS));
  // Solo códigos (p. ej. «provider_busy»), nunca texto de Ride with GPS.
  let heatError: string | null = null;
  if (touched.box) { try { await refreshHeat(admin, touched.box); } catch { heatError = 'heat_error'; } }
  await admin.from('rwgps_sync_state').update({ last_error: result.error ?? heatError }).eq('id', 1);
}

// Sin console.log: ni la clave, ni el token, ni los ids que pide cada persona llegan a los registros.
// `route-sources` pide la pasada con `{ op: 'sync' }` y la clave de servicio; solo ese token la lanza.
Deno.serve(request => handleRwgps(request, {
  enabled, allowedOrigins, serviceToken: serviceKey,
  authenticate: async token => {
    const { data, error } = await serverClient(publicKey).auth.getUser(token);
    // Como route-sources: las sesiones anónimas no gastan la cuenta común.
    return error || !data.user || data.user.is_anonymous === true ? null : data.user.id;
  },
  consumeQuota: async userId => {
    const { data, error } = await serverClient(serviceKey).rpc('consume_shared_rwgps_quota', { account_id: userId });
    if (error || !data?.[0]) throw new Error('quota');
    return { allowed: data[0].allowed === true, retryAfterS: Number(data[0].retry_after_s) || 60 };
  },
  get: api.get,
  scheduleSync: () => background(runSync),
}));
