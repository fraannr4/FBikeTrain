import { createClient } from '@supabase/supabase-js';
import { handleRwgps, isAllowedRwgpsPath, SYNC_EVERY_MS } from '../../../src/routes/sources/rwgpsService.ts';
import { syncRwgpsIndex, type RwgpsIndexRow } from '../../../src/routes/sources/rwgpsSync.ts';

// Cuenta común de Ride with GPS. Secrets del proyecto (Dashboard → Edge Functions → Secrets):
// RWGPS_API_KEY y, o bien RWGPS_AUTH_TOKEN, o bien RWGPS_EMAIL + RWGPS_PASSWORD.
// Nada de esto sale nunca en una respuesta ni en los registros.
const API = 'https://ridewithgps.com';
const MAX_RESPONSE_BYTES = 15_000_000;
/** Una pasada de sincronización en segundo plano no pasa de 2 min (cada petición, 20 s). */
const SYNC_TIMEOUT_MS = 120_000;
const SYNC_REQUEST_TIMEOUT_MS = 20_000;
const projectUrl = Deno.env.get('SUPABASE_URL') ?? '';
const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const apiKey = Deno.env.get('RWGPS_API_KEY') ?? '';
const fixedToken = Deno.env.get('RWGPS_AUTH_TOKEN') ?? '';
const email = Deno.env.get('RWGPS_EMAIL') ?? '';
const password = Deno.env.get('RWGPS_PASSWORD') ?? '';
const enabled = Boolean(projectUrl && publicKey && serviceKey && apiKey && (fixedToken || (email && password)));
const allowedOrigins = (Deno.env.get('APP_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean);

const fetchTimed: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10_000)]) });
const serverClient = (key: string) => createClient(projectUrl, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchTimed } });

/** Token de la cuenta común: el fijo, o uno pedido con el correo y la contraseña y guardado en memoria. */
let cachedToken = '';
async function authToken(renew: boolean, signal: AbortSignal): Promise<string> {
  if (fixedToken) return fixedToken;
  if (cachedToken && !renew) return cachedToken;
  const response = await fetch(`${API}/api/v1/auth_tokens.json`, {
    method: 'POST', signal, redirect: 'error',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-rwgps-api-key': apiKey },
    body: JSON.stringify({ user: { email, password } }),
  });
  const json = await response.json().catch(() => null) as { auth_token?: { auth_token?: unknown } } | null;
  const token = json?.auth_token?.auth_token;
  if (!response.ok || typeof token !== 'string' || token.length < 8) throw new Error('auth');
  cachedToken = token;
  return token;
}

async function readCapped(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  let text = ''; let size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('oversize'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return JSON.parse(text); } catch { return null; }
}

/** Solo GET a la lista cerrada de `isAllowedRwgpsPath`; sin redirecciones. Un 401 renueva el token una vez. */
async function get(path: string, signal: AbortSignal): Promise<{ status: number; json: unknown }> {
  if (!isAllowedRwgpsPath(path)) throw new Error('path');
  for (const renew of [false, true]) {
    let token: string;
    // Sin token de la cuenta común el servicio no está disponible (503 en el handler): el cliente para el lote.
    try { token = await authToken(renew, signal); }
    catch (e) { if (signal.aborted) throw e; return { status: 401, json: null }; }
    const response = await fetch(`${API}${path}`, {
      method: 'GET', signal, redirect: 'error',
      headers: { Accept: 'application/json', 'x-rwgps-api-key': apiKey, 'x-rwgps-auth-token': token },
    });
    if (response.status === 401 && !fixedToken && !renew) { await response.body?.cancel(); continue; }
    if (response.status !== 200) { await response.body?.cancel(); return { status: response.status, json: null }; }
    return { status: 200, json: await readCapped(response) };
  }
  return { status: 401, json: null };
}

/** Tareas que siguen tras responder: `EdgeRuntime.waitUntil` si existe. Nunca lanzan. */
function background(task: () => Promise<unknown>): void {
  const running = task().catch(() => {});
  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(running);
}

/** Pasada de sincronización del índice. La reserva es atómica: una sola pasada cada 6 h aunque lleguen varias peticiones. */
async function runSync(): Promise<void> {
  const admin = serverClient(serviceKey);
  const staleBefore = new Date(Date.now() - SYNC_EVERY_MS).toISOString();
  const { data: claimed, error } = await admin.from('rwgps_sync_state').update({ last_sync_at: new Date().toISOString() })
    .eq('id', 1).or(`last_sync_at.is.null,last_sync_at.lt."${staleBefore}"`).select('id');
  if (error || !claimed?.length) return;
  const result = await syncRwgpsIndex({
    get: (path, signal) => get(path, AbortSignal.any([signal, AbortSignal.timeout(SYNC_REQUEST_TIMEOUT_MS)])),
    indexedAt: async ids => {
      const known = new Map<number, number>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await admin.from('rwgps_route_index').select('id,indexed_at').in('id', ids.slice(i, i + 200));
        if (error) throw new Error('index');
        for (const row of data ?? []) known.set(Number(row.id), Date.parse(row.indexed_at));
      }
      return known;
    },
    upsert: async row => {
      const { error } = await admin.from('rwgps_route_index').upsert({ ...row, indexed_at: new Date().toISOString() }, { onConflict: 'id' });
      if (error) throw new Error('index');
    },
    remove: async id => {
      const { error } = await admin.from('rwgps_route_index').delete().eq('id', id);
      if (error) throw new Error('index');
    },
  }, AbortSignal.timeout(SYNC_TIMEOUT_MS));
  // Solo el código (p. ej. «provider_busy»), nunca texto de Ride with GPS.
  await admin.from('rwgps_sync_state').update({ last_error: result.error }).eq('id', 1);
}

// Sin console.log: ni la clave, ni el token, ni los ids que pide cada persona llegan a los registros.
Deno.serve(request => handleRwgps(request, {
  enabled, allowedOrigins,
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
  get,
  near: async (lat, lng, radiusKm) => {
    const { data, error } = await serverClient(serviceKey).rpc('rwgps_routes_near', { p_lat: lat, p_lng: lng, p_radius_km: radiusKm });
    if (error) throw new Error('index');
    return (data ?? []) as RwgpsIndexRow[];
  },
  lastSyncAt: async () => {
    const { data, error } = await serverClient(serviceKey).from('rwgps_sync_state').select('last_sync_at').eq('id', 1).maybeSingle();
    if (error) throw new Error('sync_state');
    return data?.last_sync_at ? new Date(data.last_sync_at) : null;
  },
  scheduleSync: () => background(runSync),
  // Las rutas sembradas mandan: lo que lee una persona solo entra si aún no está en el índice.
  indexRoute: (row: RwgpsIndexRow) => background(async () => {
    await serverClient(serviceKey).from('rwgps_route_index').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
  }),
}));
