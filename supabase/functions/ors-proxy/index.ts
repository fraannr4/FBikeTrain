import { createClient } from '@supabase/supabase-js';
import { handleSharedOrs } from '../../../src/routes/shared/orsService.ts';

// Host vigente de HeiGIT (src/routes/endpoint.ts). El perfil cycling-road lo fija el servidor.
const ORS_URL = 'https://api.heigit.org/openrouteservice/v2/directions/cycling-road/geojson';
/** 50.000 puntos con elevación caben de sobra; más es una respuesta anómala. */
const MAX_RESPONSE_BYTES = 8_000_000;
const projectUrl = Deno.env.get('SUPABASE_URL') ?? '';
const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const orsKey = Deno.env.get('ORS_API_KEY') ?? '';
const enabled = Deno.env.get('SHARED_ORS_ENABLED') === 'true' && Boolean(projectUrl && publicKey && serviceKey && orsKey);
const allowedOrigins = (Deno.env.get('APP_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean);

const fetchTimed: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10_000)]) });
/** Cliente de Supabase sin sesión guardada y con el tiempo de espera de `fetchTimed`. */
const serverClient = (key: string) => createClient(projectUrl, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchTimed } });

async function route(body: object, signal: AbortSignal): Promise<{ status: number; json: unknown }> {
  const response = await fetch(ORS_URL, {
    method: 'POST', signal,
    headers: { Authorization: orsKey, 'Content-Type': 'application/json', Accept: 'application/json, application/geo+json' },
    body: JSON.stringify(body),
  });
  const reader = response.body?.getReader();
  if (!reader) return { status: response.status, json: null };
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
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* el handler lo trata como respuesta no válida */ }
  return { status: response.status, json };
}

// Sin console.log: ni coordenadas ni errores de ORS, que las repiten, llegan a los registros.
Deno.serve(request => handleSharedOrs(request, {
  enabled, allowedOrigins,
  authenticate: async token => {
    const { data, error } = await serverClient(publicKey).auth.getUser(token);
    // Las cuentas anónimas no gastan el cupo común de ORS.
    return error || !data.user || data.user.is_anonymous === true ? null : data.user.id;
  },
  consumeQuota: async (userId, cost) => {
    const { data, error } = await serverClient(serviceKey).rpc('consume_shared_ors_quota', { account_id: userId, cost });
    if (error || !data?.[0]) throw new Error('quota');
    return { allowed: data[0].allowed === true, retryAfterS: Number(data[0].retry_after_s) || 60 };
  },
  route,
}));
