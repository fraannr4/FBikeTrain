import type { SupabaseClient } from '@supabase/supabase-js';
import { b64urlDecode } from '../push/webpush';

/** Clave pública VAPID: es pública por diseño. La privada vive solo en los secretos de la Edge Function. */
export const VAPID_PUBLIC_KEY = 'BEcWftIoA550l3d89Hp0UVXhPXJQtmOY-JzRcy08qAIaP5kTyjUKvwNefDSbqR7TucHhx1asEh1GOY1Bff2avww';

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';
export type PushErrorCode = 'denied' | 'unsupported' | 'limit' | 'save';
export class PushError extends Error {
  constructor(public code: PushErrorCode) { super(code); }
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const hasPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const registration = () => navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);

/** Consulta el estado sin pedir nunca el permiso. */
export async function getPushState(): Promise<PushState> {
  // Safari en iPhone solo ofrece avisos a las webs añadidas a la pantalla de inicio.
  if (isIos() && !isInstalled()) return 'needs-install';
  if (!hasPush()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const subscription = await (await registration())?.pushManager.getSubscription();
  return subscription ? 'on' : 'off';
}

/** Activa los avisos. El permiso del navegador se pide aquí, al pulsar el interruptor, y en ningún otro sitio. */
export async function enablePush(client: SupabaseClient): Promise<void> {
  if (!hasPush()) throw new PushError('unsupported');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PushError('denied');
  const current = await registration();
  if (!current) throw new PushError('unsupported');
  const existing = await current.pushManager.getSubscription();
  const subscription = existing ?? await current.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlDecode(VAPID_PUBLIC_KEY) as BufferSource });
  const keys = subscription.toJSON().keys;
  const { error } = await client.rpc('register_push_subscription', {
    push_endpoint: subscription.endpoint, push_p256dh: keys?.p256dh, push_auth: keys?.auth, push_agent: navigator.userAgent.slice(0, 120),
  });
  if (error) {
    // Sin fila en el servidor, la suscripción del navegador no serviría de nada.
    if (!existing) await subscription.unsubscribe().catch(() => false);
    throw new PushError((error as { code?: string }).code === '53400' ? 'limit' : 'save');
  }
}

/** Desactiva los avisos de este dispositivo. Si falla el borrado remoto, el servidor limpiará el endpoint al recibir un 410. */
export async function disablePush(client: SupabaseClient): Promise<void> {
  const subscription = await (await registration())?.pushManager.getSubscription();
  if (!subscription) return;
  await Promise.resolve(client.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)).catch(() => undefined);
  await subscription.unsubscribe();
}
