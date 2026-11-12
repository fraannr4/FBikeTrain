import { createClient } from '@supabase/supabase-js';
import { handleRwgps } from '../../../src/routes/sources/rwgpsService.ts';

// Cuenta común de Ride with GPS. Secrets del proyecto (Dashboard → Edge Functions → Secrets):
// RWGPS_API_KEY y, o bien RWGPS_AUTH_TOKEN, o bien RWGPS_EMAIL + RWGPS_PASSWORD.
// Nada de esto sale nunca en una respuesta ni en los registros.
const API = 'https://ridewithgps.com';
const MAX_RESPONSE_BYTES = 15_000_000;
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

/** Solo GET a la ruta que construye `rwgpsApiPath`; sin redirecciones. Un 401 renueva el token una vez. */
async function get(path: string, signal: AbortSignal): Promise<{ status: number; json: unknown }> {
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
}));
