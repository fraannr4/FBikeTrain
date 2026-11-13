import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_KEY, TEST_DATABASE, TEST_SESSION, TEST_USER_ID } from './accountFixture';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

test.beforeEach(async ({ page }) => {
  await page.route('https://*.supabase.co/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/token')) return route.fulfill({ headers: CORS, json: TEST_SESSION });
    if (url.pathname.endsWith('/logout')) return route.fulfill({ headers: CORS, status: 204 });
    if (url.pathname.endsWith('/signup') || url.pathname.endsWith('/recover')) return route.fulfill({ headers: CORS, json: {} });
    if (url.pathname === '/rest/v1/profiles') {
      return route.fulfill({ headers: CORS, json: route.request().method() === 'PATCH' ? { id: TEST_USER_ID } : { username: 'ciclista_test', display_name: 'Ciclista', stats_visibility: 'everyone', bio: 'Rodar, descubrir, volver.', riding_style: 'explorar', avatar_version: 0 } });
    }
    if (url.pathname.endsWith('/list_profile_posts') || url.pathname.endsWith('/list_friends')) return route.fulfill({ headers: CORS, json: [] });
    return route.abort();
  });
});

test('las rutas protegidas no muestran datos ni pestañas sin cuenta', async ({ page }) => {
  await page.goto('#/historial');
  await expect(page.getByRole('heading', { name: 'Vuelve a tu ritmo' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menú principal' })).toHaveCount(0);
});

test('entrar, editar el perfil y salir conserva la separación de datos', async ({ page }) => {
  await page.goto('#/mas');
  await page.getByLabel('Correo electrónico').fill('synthetic@example.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Tu perfil', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu perfil' })).toBeVisible();
  await page.getByRole('button', { name: 'Editar perfil', exact: true }).click();
  await page.getByLabel('Nombre visible').fill('Ana Ciclista');
  await page.getByLabel('Quién puede ver tus estadísticas').selectOption('friends');
  await page.getByRole('button', { name: 'Guardar perfil' }).click();
  await expect(page.getByRole('status')).toHaveText('Perfil guardado.');
  const dbNames = await page.evaluate(async () => (await indexedDB.databases()).map(d => d.name));
  expect(dbNames).toContain(TEST_DATABASE);
  await page.getByRole('button', { name: 'Editar perfil', exact: true }).click();
  await page.getByText('Tu cuenta y este dispositivo', { exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar sesión en este dispositivo' }).click();
  await expect(page.getByRole('heading', { name: 'Vuelve a tu ritmo' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menú principal' })).toHaveCount(0);
});

test('registro y recuperación explican los siguientes pasos', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await page.getByLabel('Correo electrónico').fill('synthetic@example.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revisa tu correo');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: '¿Has olvidado tu contraseña?' }).click();
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(page.getByRole('status')).toContainText('Si existe una cuenta');
});

for (const theme of ['dark', 'light']) {
  for (const [width, height] of [[360, 780], [390, 844], [412, 915], [430, 932], [780, 360], [844, 390], [915, 412], [932, 430]]) {
    test(`acceso y perfil: ${theme} ${width}x${height}`, async ({ page }) => {
      test.setTimeout(60_000);
      mkdirSync('test-results/accounts', { recursive: true });
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await page.evaluate(({ theme, key }) => { localStorage.removeItem(key); localStorage.setItem('fbt-theme', theme); }, { theme, key: AUTH_KEY });
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Vuelve a tu ritmo' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/accounts/login-${theme}-${width}.png`, fullPage: true });
      await page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_KEY, session: TEST_SESSION });
      await page.goto('#/perfil');
      await page.reload();
      await page.getByRole('button', { name: 'Editar perfil', exact: true }).click();
      await expect(page.getByLabel('Nombre visible')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/accounts/profile-${theme}-${width}.png`, fullPage: true });
    });
  }
}
