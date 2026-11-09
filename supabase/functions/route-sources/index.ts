import { createClient } from '@supabase/supabase-js';
import { handleRouteSources } from '../../../src/routes/sources/service.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10_000)]) });
const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedFetch } };

Deno.serve(request => {
  // Las credenciales de servicio existen solo en el runtime de Supabase.
  const admin = url && serviceKey ? createClient(url, serviceKey, options) : null;
  return handleRouteSources(request, {
    enabled: Boolean(url && anonKey && admin),
    allowedOrigins: (Deno.env.get('APP_ALLOWED_ORIGINS') ?? '').split(',').map(v => v.trim()).filter(Boolean),
    wikilocAuthorized: Deno.env.get('WIKILOC_AUTOMATION_AUTHORIZED') === 'true',
    wikilocSearchTemplate: Deno.env.get('WIKILOC_PUBLIC_SEARCH_TEMPLATE') ?? '',
    authenticate: async token => {
      const { data, error } = await createClient(url, anonKey, options).auth.getUser(token);
      return !error && data.user ? { id: data.user.id, isAnonymous: data.user.is_anonymous === true } : null;
    },
    consumeQuota: async userId => {
      const { data, error } = await admin!.rpc('consume_route_sources_quota', { account_id: userId });
      if (error || !data?.[0] || typeof data[0].allowed !== 'boolean') throw new Error('quota');
      return { allowed: data[0].allowed, retryAfterS: Number(data[0].retry_after_s) || 30 };
    },
    readCache: async key => {
      const { data, error } = await admin!.from('route_sources_cache').select('payload,fetched_at,expires_at').eq('cache_key', key).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (error) throw new Error('cache');
      return data;
    },
    writeCache: async row => {
      const { error } = await admin!.rpc('write_route_sources_cache', { p_cache_key: row.cache_key, p_source: row.source, p_payload: row.payload, p_fetched_at: row.fetched_at });
      if (error) throw new Error('cache');
    },
    claim: async source => {
      const { data, error } = await admin!.rpc('claim_route_source_request', { provider: source });
      if (error) throw new Error('rate_limit');
      return data === true;
    },
    fetch: timedFetch,
  });
});
