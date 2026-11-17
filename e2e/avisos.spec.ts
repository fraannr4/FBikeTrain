import { test, expect, type Page } from './accountFixture';

// Sección «Avisos» de Ajustes con soporte y permisos simulados: sin push real ni llamadas a la nube.
test.setTimeout(90_000);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const SHOTS = 'docs/design/2026-11-17-avisos';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/e2e';

type Env = { permission?: NotificationPermission; request?: NotificationPermission; subscribed?: boolean; noPush?: boolean; ua?: string };

async function fake(page: Page) {
  const calls: { method: string; fn: string; url: string; body: unknown }[] = [];
  const control = { registerStatus: 204 };
  await page.route('https://*.supabase.co/rest/v1/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const fn = url.pathname.split('/').pop() ?? '';
    if (fn === 'my_area') return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([{ locality: 'Villa Prueba', show_area: true }]) });
    if (fn === 'register_push_subscription' || fn === 'push_subscriptions') {
      calls.push({ method: req.method(), fn, url: url.search, body: req.postDataJSON() });
      return route.fulfill({ status: fn === 'register_push_subscription' ? control.registerStatus : 204, headers: CORS, contentType: 'application/json', body: control.registerStatus === 204 || fn === 'push_subscriptions' ? '' : JSON.stringify({ code: 'XX000', message: 'boom' }) });
    }
    return route.fulfill({ status: 204, headers: CORS });
  });
  return { calls, control };
}

/** Simula el navegador: lee el entorno de sessionStorage para poder cambiarlo y recargar. */
async function stubPush(page: Page) {
  await page.addInitScript((endpoint) => {
    const env = JSON.parse(sessionStorage.getItem('e2e-push') ?? '{}') as Env;
    const w = window as unknown as Record<string, unknown>;
    w.__asked = 0;
    let current: unknown = env.subscribed ? {} : null;
    const subscription = {
      endpoint, toJSON: () => ({ endpoint, keys: { p256dh: 'P'.repeat(87), auth: 'a'.repeat(22) } }),
      unsubscribe: async () => { current = null; return true; },
    };
    if (env.subscribed) current = subscription;
    const registration = { pushManager: { getSubscription: async () => current, subscribe: async () => (current = subscription) } };
    Object.defineProperty(navigator.serviceWorker, 'getRegistration', { value: async () => registration, configurable: true });
    const notification = Object.assign(function () {}, {
      permission: env.permission ?? 'default',
      requestPermission: async () => { (w.__asked as number)++; const result = env.request ?? 'granted'; (notification as { permission: string }).permission = result; return result; },
    });
    Object.defineProperty(window, 'Notification', { value: notification, configurable: true });
    if (env.noPush) delete (window as unknown as Record<string, unknown>).PushManager;
    if (env.ua) Object.defineProperty(navigator, 'userAgent', { get: () => env.ua });
  }, ENDPOINT);
}
async function setEnv(page: Page, env: Env) {
  await page.evaluate((value) => sessionStorage.setItem('e2e-push', JSON.stringify(value)), env);
  await page.reload();
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const asked = (page: Page) => page.evaluate(() => (window as unknown as { __asked: number }).__asked);
const avisos = (page: Page) => page.locator('details#avisos');

for (const width of [360, 390]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`avisos en Ajustes a ${width} px (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((t) => localStorage.setItem('fbt-theme', t), theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const { calls, control } = await fake(page);
      await stubPush(page);
      const shot = async (name: string) => {
        expect(await overflow(page)).toBe(0);
        await avisos(page).scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/${name}-${width}-${theme}.png` });
      };
      const switchLine = () => avisos(page).locator('label.switch-line');
      const toggle = () => avisos(page).getByRole('checkbox', { name: 'Recibir avisos en este dispositivo' });

      // Cargar la pantalla nunca pide el permiso; el interruptor empieza apagado.
      await page.goto('./#/ajustes?abrir=avisos');
      await expect(toggle()).not.toBeChecked();
      expect(await asked(page)).toBe(0);
      const box = await switchLine().boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await shot('desactivados');

      // Al activarlo se pide el permiso y se guarda el dispositivo (solo claves de cifrado y un agente corto).
      await switchLine().click();
      await expect(toggle()).toBeChecked();
      expect(await asked(page)).toBe(1);
      expect(calls.at(-1)).toMatchObject({ method: 'POST', fn: 'register_push_subscription', body: { push_endpoint: ENDPOINT, push_p256dh: 'P'.repeat(87), push_auth: 'a'.repeat(22) } });
      await shot('activados');

      // Al apagarlo se borra el dispositivo guardado.
      await switchLine().click();
      await expect(toggle()).not.toBeChecked();
      await expect.poll(() => calls.at(-1)).toMatchObject({ method: 'DELETE', fn: 'push_subscriptions' });
      expect(calls.at(-1)!.url).toContain('endpoint=eq.');

      // Fallo al guardar: mensaje, interruptor apagado y sin quedarse a medias.
      control.registerStatus = 500;
      await switchLine().click();
      await expect(avisos(page).getByRole('alert')).toHaveText('No se han podido activar los avisos. Inténtalo de nuevo.');
      await expect(toggle()).not.toBeChecked();
      await shot('error');
      control.registerStatus = 204;

      // Permiso ya denegado: sin interruptor y con la forma de reactivarlo.
      await setEnv(page, { permission: 'denied' });
      await expect(avisos(page).getByText(/Has bloqueado los avisos de este sitio/)).toBeVisible();
      await expect(toggle()).toHaveCount(0);
      await shot('denegado');

      // Al denegar en la petición del navegador, pasa a bloqueado.
      await setEnv(page, { request: 'denied' });
      await switchLine().click();
      await expect(avisos(page).getByText(/Has bloqueado los avisos de este sitio/)).toBeVisible();

      // Navegador sin soporte.
      await setEnv(page, { noPush: true });
      await expect(avisos(page).getByText(/no admite avisos/)).toBeVisible();
      await shot('sin-soporte');

      // iPhone sin instalar.
      await setEnv(page, { noPush: true, ua: IPHONE });
      await expect(avisos(page).getByText('Añade la app a la pantalla de inicio para recibir avisos')).toBeVisible();
      await shot('iphone-sin-instalar');
    });
  }
}
