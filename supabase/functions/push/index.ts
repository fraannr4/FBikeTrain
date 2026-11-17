import { createClient } from '@supabase/supabase-js';
import { handlePush, type PushSubscriptionRow } from '../../../src/push/service.ts';
import { encryptPayload, vapidAuthorization, type VapidKeys } from '../../../src/push/webpush.ts';

const projectUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const secret = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? '';
const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const subject = Deno.env.get('VAPID_SUBJECT') ?? '';
const vapid: VapidKeys | null = projectUrl && serviceKey && publicKey && privateKey && /^(mailto:|https:\/\/)/.test(subject)
  ? { publicKey, privateKey, subject } : null;

const admin = createClient(projectUrl || 'http://localhost', serviceKey || 'unset', { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(request => handlePush(request, {
  secret, vapid,
  listSubscriptions: async userId => {
    const { data, error } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId);
    if (error) throw new Error('db');
    return (data ?? []) as PushSubscriptionRow[];
  },
  deleteSubscription: async id => { await admin.from('push_subscriptions').delete().eq('id', id); },
  markDelivered: async id => { await admin.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('id', id); },
  encrypt: (plaintext, row) => encryptPayload(plaintext, row.p256dh, row.auth),
  authorize: endpoint => vapidAuthorization(endpoint, vapid as VapidKeys),
  // Sin seguir redirecciones y con tiempo máximo: el destino ya está limitado a servicios push conocidos.
  send: async (endpoint, init) => (await fetch(endpoint, { method: 'POST', headers: init.headers, body: init.body as BodyInit, redirect: 'manual', signal: AbortSignal.timeout(10_000) })).status,
}));
