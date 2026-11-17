import type { VapidKeys } from './webpush.ts';

/**
 * Avisos push de la comunidad. La función la dispara un Database Webhook de Supabase al insertar en
 * `community_notifications`; el webhook se identifica con un secreto compartido de servidor.
 * La carga solo lleva texto fijo en castellano y una ruta de la app: ningún nombre, track ni ubicación.
 */
export type PushSubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };
export type PushDependencies = {
  secret: string;
  vapid: VapidKeys | null;
  listSubscriptions: (userId: string) => Promise<PushSubscriptionRow[]>;
  deleteSubscription: (id: string) => Promise<void>;
  markDelivered: (id: string) => Promise<void>;
  encrypt: (plaintext: Uint8Array, subscription: PushSubscriptionRow) => Promise<Uint8Array>;
  authorize: (endpoint: string) => Promise<string>;
  send: (endpoint: string, init: { headers: Record<string, string>; body: Uint8Array }) => Promise<number>;
};
export type PushMessage = { title: string; body: string; url: string; tag: string };

const MAX_BODY_BYTES = 16_000;
const MIN_SECRET_LENGTH = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

// Solo los servicios push de los navegadores; la función nunca hace peticiones a otros destinos (SSRF).
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_HOST_SUFFIXES = ['.push.services.mozilla.com', '.notify.windows.com', '.push.apple.com'];
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  return PUSH_HOSTS.includes(url.hostname) || PUSH_HOST_SUFFIXES.some(suffix => url.hostname.endsWith(suffix));
}

/** Texto y ruta según el tipo de aviso. `null`: ese tipo no genera aviso push. */
export function pushMessage(kind: string, challengeId: string | null): PushMessage | null {
  const reto = challengeId ? `#/retos/comunidad/${challengeId}` : '#/retos';
  switch (kind) {
    case 'invitation': return { title: 'Te han retado', body: 'Tienes una invitación a un reto. Ábrela para aceptarla o rechazarla.', url: reto, tag: 'reto' };
    case 'accepted': return { title: 'Reto aceptado', body: 'Han aceptado tu reto.', url: reto, tag: 'reto' };
    case 'declined': return { title: 'Reto rechazado', body: 'Han rechazado tu reto.', url: reto, tag: 'reto' };
    case 'friendship': return { title: 'Solicitud de amistad', body: 'Tienes una nueva solicitud de amistad.', url: '#/perfil/amigos', tag: 'amistad' };
    default: return null;
  }
}

async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([given, expected].map(async value => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function readBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function handlePush(request: Request, deps: PushDependencies): Promise<Response> {
  // Sin cabeceras CORS: la llama el servidor de Supabase, nunca un navegador.
  const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
  if (deps.secret.length < MIN_SECRET_LENGTH || !deps.vapid) return reply(503, { error: 'unavailable' });
  if (!await sameSecret(request.headers.get('x-push-secret') ?? '', deps.secret)) return reply(401, { error: 'unauthorized' });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return reply(400, { error: 'invalid_request' });
  const raw = await readBody(request);
  if (raw === null) return reply(413, { error: 'too_large' });
  let event: { type?: unknown; table?: unknown; record?: { user_id?: unknown; kind?: unknown; challenge_id?: unknown } | null };
  try { event = JSON.parse(raw); } catch { return reply(400, { error: 'invalid_request' }); }
  if (event?.type !== 'INSERT' || event.table !== 'community_notifications') return reply(200, { ignored: true });
  const record = event.record;
  const challengeId = record?.challenge_id ?? null;
  if (typeof record?.user_id !== 'string' || !UUID.test(record.user_id) || typeof record.kind !== 'string'
    || (challengeId !== null && (typeof challengeId !== 'string' || !UUID.test(challengeId)))) return reply(400, { error: 'invalid_request' });
  const message = pushMessage(record.kind, challengeId);
  if (!message) return reply(200, { ignored: true });

  const plaintext = encoder.encode(JSON.stringify(message));
  const totals = { sent: 0, removed: 0, failed: 0 };
  const rows = await deps.listSubscriptions(record.user_id);
  const deliver = async (row: PushSubscriptionRow) => {
    if (!isAllowedPushEndpoint(row.endpoint)) { await deps.deleteSubscription(row.id); totals.removed++; return; }
    let body: Uint8Array;
    try { body = await deps.encrypt(plaintext, row); }
    catch { await deps.deleteSubscription(row.id); totals.removed++; return; }
    const status = await deps.send(row.endpoint, {
      headers: {
        Authorization: await deps.authorize(row.endpoint), 'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal',
      },
      body,
    });
    if (status >= 200 && status < 300) { await deps.markDelivered(row.id); totals.sent++; }
    else if (status === 404 || status === 410) { await deps.deleteSubscription(row.id); totals.removed++; }
    else totals.failed++;
  };
  // Un dispositivo que falla (red, base de datos) no impide el envío a los demás.
  await Promise.all(rows.map(row => deliver(row).catch(() => { totals.failed++; })));
  return reply(200, totals);
}
