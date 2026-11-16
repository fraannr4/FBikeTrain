import { createClient } from '@supabase/supabase-js';
import { createGarminService, guardedFetch, signedInAccount, type GarminStore, type GarminTokens } from '../../../src/connections/garminServer/service.ts';

const projectUrl = Deno.env.get('SUPABASE_URL') ?? '';
const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const fetchTimed: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(15_000)]) });
const client = (key: string, fetcher = fetchTimed) => createClient(projectUrl, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
function createStore(server: ReturnType<typeof client>, deadline: AbortSignal): GarminStore {
const bucket = server.storage.from('garmin-originals');
const iso = (ms: number) => new Date(ms).toISOString();
const checked = <T>(value: { data: T; error: unknown }): T => { if (value.error) throw new Error('storage'); return value.data; };

async function purge(userId: string, all = false) {
  let query = server.from('garmin_activity_files').select('id,object_path').eq('user_id', userId);
  if (!all) query = query.lte('expires_at', iso(Date.now()));
  const rows = checked(await query) ?? [];
  if (!rows.length) return;
  checked(await bucket.remove(rows.map(row => row.object_path)));
  checked(await server.from('garmin_activity_files').delete().eq('user_id', userId).in('id', rows.map(row => row.id)));
}
const tokens = (row: Record<string, unknown>): GarminTokens => ({ garminUserId: String(row.garmin_user_id), ciphertext: String(row.ciphertext), expiresAt: Date.parse(String(row.expires_at)), refreshExpiresAt: Date.parse(String(row.refresh_expires_at)), permissions: row.permissions as string[], ...(row.last_sync_at ? { lastSyncAt: Date.parse(String(row.last_sync_at)) } : {}) });
const store: GarminStore = {
  putState: async (hash, value) => {
    checked(await server.from('garmin_oauth_states').delete().lte('expires_at', iso(Date.now())));
    checked(await server.from('garmin_oauth_states').upsert({ state_hash: hash, user_id: value.userId, verifier: value.verifier, expires_at: iso(value.expiresAt) }, { onConflict: 'user_id' }));
  },
  consumeState: async hash => {
    const row = checked(await server.rpc('garmin_consume_state', { state_key: hash }))?.[0];
    return row ? { userId: row.user_id, verifier: row.verifier, expiresAt: Date.parse(row.expires_at) } : undefined;
  },
  putCompletion: async (hash, value) => {
    checked(await server.from('garmin_pending_connections').delete().lte('expires_at', iso(Date.now())));
    const c = value.connection;
    checked(await server.from('garmin_pending_connections').upsert({ code_hash: hash, user_id: value.userId, garmin_user_id: c.garminUserId, ciphertext: c.ciphertext, token_expires_at: iso(c.expiresAt), refresh_expires_at: iso(c.refreshExpiresAt), permissions: c.permissions, expires_at: iso(value.expiresAt) }, { onConflict: 'user_id' }));
  },
  consumeCompletion: async hash => {
    const row = checked(await server.rpc('garmin_consume_completion', { code_key: hash }))?.[0];
    return row ? { userId: row.user_id, expiresAt: Date.parse(row.expires_at), connection: { garminUserId: row.garmin_user_id, ciphertext: row.ciphertext, expiresAt: Date.parse(row.token_expires_at), refreshExpiresAt: Date.parse(row.refresh_expires_at), permissions: row.permissions } } : undefined;
  },
  loadConnection: async userId => {
    const row = checked(await server.from('garmin_connections').select('*').eq('user_id', userId).maybeSingle());
    return row ? tokens(row) : undefined;
  },
  saveConnection: async (userId, value) => {
    checked(await server.from('garmin_connections').upsert({ user_id: userId, garmin_user_id: value.garminUserId, ciphertext: value.ciphertext, expires_at: iso(value.expiresAt), refresh_expires_at: iso(value.refreshExpiresAt), permissions: value.permissions, ...(value.lastSyncAt ? { last_sync_at: iso(value.lastSyncAt) } : {}) }));
  },
  withAccountLock: async (userId, run) => {
    const owner = crypto.randomUUID();
    if (!checked(await server.rpc('garmin_acquire_lock', { account_id: userId, lock_owner: owner }))) throw new Error('busy');
    try { return await run(); }
    finally {
      // After abort leave the lease to expire: a request already sent may still be finishing remotely.
      if (!deadline.aborted) checked(await client(serviceKey).from('garmin_account_locks').delete().eq('user_id', userId).eq('owner', owner));
    }
  },
  removeConnection: async userId => {
    await purge(userId, true);
    checked(await server.from('garmin_connections').delete().eq('user_id', userId));
    checked(await server.from('garmin_oauth_states').delete().eq('user_id', userId));
    checked(await server.from('garmin_pending_connections').delete().eq('user_id', userId));
    checked(await server.from('garmin_notification_queue').delete().eq('user_id', userId));
  },
  userForGarmin: async id => checked(await server.from('garmin_connections').select('user_id').eq('garmin_user_id', id).maybeSingle())?.user_id,
  activities: async (userId, since) => {
    await purge(userId);
    return (checked(await server.from('garmin_activity_files').select('id,device_name,created_at').eq('user_id', userId).gte('created_at', iso(since)).gt('expires_at', iso(Date.now())).order('created_at', { ascending: true })) ?? []).map(row => ({ id: row.id, ...(row.device_name ? { deviceName: row.device_name } : {}), createdAt: Date.parse(row.created_at) }));
  },
  file: async (userId, id, since) => {
    const row = checked(await server.from('garmin_activity_files').select('object_path').eq('user_id', userId).eq('id', id).gte('created_at', iso(since)).gt('expires_at', iso(Date.now())).maybeSingle());
    if (!row) return null;
    const blob = checked(await bucket.download(row.object_path));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  },
  claimEvent: async (userId, id, kind) => !!checked(await server.rpc('garmin_claim_event', { account_id: userId, event_id: id, event_kind: kind })),
  finishEvent: async (userId, id, success) => { checked(await server.from('garmin_notification_queue').update({ status: success ? 'done' : 'pending', updated_at: iso(Date.now()) }).eq('user_id', userId).eq('id', id)); },
  saveFile: async (userId, activity, bytes, expiresAt) => {
    await purge(userId);
    const path = `${userId}/${activity.id}.fit`;
    checked(await bucket.upload(path, new Uint8Array(bytes), { contentType: 'application/octet-stream', upsert: true }));
    checked(await server.from('garmin_activity_files').upsert({ user_id: userId, id: activity.id, object_path: path, device_name: activity.deviceName ?? null, created_at: iso(activity.createdAt), expires_at: iso(expiresAt) }));
    checked(await server.from('garmin_connections').update({ last_sync_at: iso(activity.createdAt) }).eq('user_id', userId));
  },
  updatePermissions: async (userId, permissions) => { checked(await server.from('garmin_connections').update({ permissions }).eq('user_id', userId)); },
  pendingCount: async userId => {
    const result = await server.from('garmin_notification_queue').select('id', { count: 'exact', head: true }).eq('user_id', userId).neq('status', 'done');
    checked(result); return result.count ?? 0;
  },
};
return store;
}

// OAuth callback and notifications are public routes. Deploy with --no-verify-jwt: all account
// routes validate their JWT with auth.getUser in the handler. Never trust unsigned JWT claims.
// Garmin does not sign push bodies: /notifications/<GARMIN_WEBHOOK_SECRET> plus the garmin-client-id
// header gate the receiver. Without that secret it answers 503 and stores nothing.
Deno.serve(request => {
// Garmin espera respuesta al push en unos 30 s: un 503 por plazo hace que reintente sin duplicar.
const deadline = AbortSignal.timeout(25_000);
const requestFetch = guardedFetch(fetchTimed, deadline);
const server = client(serviceKey, requestFetch);
return createGarminService({
  clientId: Deno.env.get('GARMIN_CLIENT_ID') ?? '', clientSecret: Deno.env.get('GARMIN_CLIENT_SECRET') ?? '',
  encryptionKey: Deno.env.get('GARMIN_TOKEN_ENCRYPTION_KEY') ?? '',
  webhookSecret: Deno.env.get('GARMIN_WEBHOOK_SECRET') ?? '',
  callbackUrl: `${projectUrl}/functions/v1/garmin/callback`,
  appUrl: Deno.env.get('GARMIN_APP_URL') ?? 'https://fraannr4.github.io/FBikeTrain/',
  allowedOrigins: (Deno.env.get('APP_ALLOWED_ORIGINS') ?? '').split(',').map(v => v.trim()).filter(Boolean),
  // Las cuentas anónimas no conectan Garmin (igual que ors-proxy y route-sources).
  authenticate: async token => { const { data, error } = await client(publicKey, requestFetch).auth.getUser(token); return error ? null : signedInAccount(data.user); },
  fetcher: requestFetch, signal: deadline, store: createStore(server, deadline),
})(request);
});
