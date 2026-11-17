import type { SupabaseClient } from '@supabase/supabase-js';
import { b64urlDecode } from '../src/push/webpush';
import { VAPID_PUBLIC_KEY, disablePush, enablePush, getPushState, PushError } from '../src/pwa/push';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const originalUa = navigator.userAgent;

type Env = { ua?: string; standalone?: boolean; permission?: NotificationPermission; request?: NotificationPermission; subscription?: PushSubscription | null; noWorker?: boolean; noPush?: boolean; noNotification?: boolean };
function fakeSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/abc') {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'P'.repeat(87), auth: 'a'.repeat(22) } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  } as unknown as PushSubscription & { unsubscribe: ReturnType<typeof vi.fn> };
}
function setup(env: Env = {}) {
  Object.defineProperty(navigator, 'userAgent', { value: env.ua ?? ANDROID, configurable: true });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('standalone') && Boolean(env.standalone), media: query, addEventListener() {}, removeEventListener() {} }));
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(env.subscription ?? null),
    subscribe: vi.fn().mockResolvedValue(fakeSubscription()),
  };
  const registration = { pushManager };
  if (env.noWorker) Reflect.deleteProperty(navigator, 'serviceWorker');
  else Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: vi.fn().mockResolvedValue(registration) }, configurable: true });
  if (env.noPush) Reflect.deleteProperty(window, 'PushManager'); else Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true });
  const requestPermission = vi.fn().mockResolvedValue(env.request ?? 'granted');
  if (env.noNotification) Reflect.deleteProperty(window, 'Notification');
  else Object.defineProperty(window, 'Notification', { value: Object.assign(function () {}, { permission: env.permission ?? 'default', requestPermission }), configurable: true });
  return { pushManager, requestPermission };
}
function fakeClient(result: { error: unknown } = { error: null }, deleteResult: { error: unknown } = { error: null }) {
  const eq = vi.fn().mockResolvedValue(deleteResult);
  const del = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ delete: del }));
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc, from } as unknown as SupabaseClient, rpc, from, del, eq };
}

afterEach(() => {
  Object.defineProperty(navigator, 'userAgent', { value: originalUa, configurable: true });
  vi.unstubAllGlobals();
});

describe('avisos push en el navegador: estado', () => {
  it('declara la clave pública VAPID de la app', () => {
    expect(b64urlDecode(VAPID_PUBLIC_KEY)).toHaveLength(65);
  });
  it('sin Service Worker, PushManager o Notification, no hay avisos', async () => {
    for (const env of [{ noWorker: true }, { noPush: true }, { noNotification: true }]) {
      setup(env);
      expect(await getPushState()).toBe('unsupported');
    }
  });
  it('en iPhone sin instalar pide añadir la app a la pantalla de inicio, aunque falte PushManager', async () => {
    setup({ ua: IPHONE, noPush: true });
    expect(await getPushState()).toBe('needs-install');
  });
  it('en iPhone con la app instalada, los avisos funcionan', async () => {
    setup({ ua: IPHONE, standalone: true });
    expect(await getPushState()).toBe('off');
  });
  it('permiso denegado: no se puede activar desde la app', async () => {
    setup({ permission: 'denied' });
    expect(await getPushState()).toBe('denied');
  });
  it('activo solo con permiso concedido y suscripción en el navegador', async () => {
    setup({ permission: 'granted', subscription: fakeSubscription() });
    expect(await getPushState()).toBe('on');
    setup({ permission: 'granted', subscription: null });
    expect(await getPushState()).toBe('off');
  });
  it('consultar el estado nunca pide el permiso', async () => {
    const { requestPermission } = setup();
    await getPushState();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe('avisos push en el navegador: activar y desactivar', () => {
  it('pide el permiso, suscribe con la clave pública y guarda el dispositivo', async () => {
    const { pushManager, requestPermission } = setup();
    const { client, rpc } = fakeClient();
    await enablePush(client);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    const options = pushManager.subscribe.mock.calls[0][0];
    expect(options.userVisibleOnly).toBe(true);
    expect(Array.from(options.applicationServerKey as Uint8Array)).toEqual(Array.from(b64urlDecode(VAPID_PUBLIC_KEY)));
    expect(rpc).toHaveBeenCalledWith('register_push_subscription', {
      push_endpoint: 'https://fcm.googleapis.com/fcm/send/abc', push_p256dh: 'P'.repeat(87), push_auth: 'a'.repeat(22), push_agent: ANDROID.slice(0, 120),
    });
  });
  it('si ya hay una suscripción, la reutiliza y solo la vuelve a registrar', async () => {
    const { pushManager } = setup({ subscription: fakeSubscription('https://updates.push.services.mozilla.com/wpush/v2/z') });
    const { client, rpc } = fakeClient();
    await enablePush(client);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(rpc.mock.calls[0][1]).toMatchObject({ push_endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/z' });
  });
  it('si el usuario deniega el permiso, no suscribe ni guarda nada', async () => {
    const { pushManager } = setup({ request: 'denied' });
    const { client, rpc } = fakeClient();
    await expect(enablePush(client)).rejects.toMatchObject({ code: 'denied' });
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('si se cierra la petición sin decidir (default), tampoco activa', async () => {
    setup({ request: 'default' });
    await expect(enablePush(fakeClient().client)).rejects.toBeInstanceOf(PushError);
  });
  it('si falla el guardado, cancela la suscripción del navegador para no dejarla huérfana', async () => {
    const created = fakeSubscription();
    const { pushManager } = setup();
    pushManager.subscribe.mockResolvedValue(created);
    const { client } = fakeClient({ error: { code: 'XX000', message: 'boom' } });
    await expect(enablePush(client)).rejects.toMatchObject({ code: 'save' });
    expect((created as unknown as { unsubscribe: ReturnType<typeof vi.fn> }).unsubscribe).toHaveBeenCalled();
  });
  it('avisa del límite de dispositivos', async () => {
    setup();
    await expect(enablePush(fakeClient({ error: { code: '53400', message: 'limit' } }).client)).rejects.toMatchObject({ code: 'limit' });
  });
  it('sin Service Worker registrado (desarrollo), explica que no está disponible', async () => {
    setup({ noWorker: true });
    await expect(enablePush(fakeClient().client)).rejects.toMatchObject({ code: 'unsupported' });
  });
  it('desactivar borra el dispositivo guardado y cancela la suscripción', async () => {
    const existing = fakeSubscription();
    setup({ subscription: existing, permission: 'granted' });
    const { client, from, del, eq } = fakeClient();
    await disablePush(client);
    expect(from).toHaveBeenCalledWith('push_subscriptions');
    expect(del).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith('endpoint', 'https://fcm.googleapis.com/fcm/send/abc');
    expect((existing as unknown as { unsubscribe: ReturnType<typeof vi.fn> }).unsubscribe).toHaveBeenCalled();
  });
  it('desactivar cancela la suscripción del navegador aunque falle el borrado remoto', async () => {
    const existing = fakeSubscription();
    setup({ subscription: existing, permission: 'granted' });
    const { client } = fakeClient({ error: null }, { error: { message: 'sin red' } });
    await expect(disablePush(client)).resolves.toBeUndefined();
    expect((existing as unknown as { unsubscribe: ReturnType<typeof vi.fn> }).unsubscribe).toHaveBeenCalled();
  });
});
