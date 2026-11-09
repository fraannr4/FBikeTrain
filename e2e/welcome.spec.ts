import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { TEST_SESSION, TEST_USER_ID } from './accountFixture';

const SHOTS = 'test-results/welcome';
const session = { ...TEST_SESSION, user: { ...TEST_SESSION.user, user_metadata: { full_name: 'Ana' } } };

test.beforeEach(async ({ page }) => {
  await page.route('https://*.supabase.co/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/token')) return route.fulfill({ json: session });
    if (url.pathname === '/rest/v1/profiles') return route.fulfill({ json: { id: TEST_USER_ID, display_name: 'Ciclista' } });
    return route.abort();
  });
});

async function signIn(page: Page) {
  await page.goto('#/');
  await page.getByLabel('Correo electrónico').fill('synthetic@example.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test('la bienvenida sale tras entrar, termina sola y no vuelve al recargar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Hola, Ana.' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menú principal' })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('heading', { name: 'Hola, Ana.' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Menú principal' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Hola/ })).toHaveCount(0);
});

test('se salta con Continuar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: /Hola/ })).toHaveCount(0, { timeout: 1000 });
});

const sizes = [[360, 740], [390, 844], [430, 932], [844, 390]] as const;
for (const theme of ['dark', 'light'] as const) {
  for (const [width, height] of sizes) {
    test(`captura ${theme} ${width}x${height}`, async ({ page }) => {
      mkdirSync(SHOTS, { recursive: true });
      // Reloj y animaciones congelados: capturas deterministas aunque la máquina vaya cargada.
      await page.clock.install();
      await page.addInitScript(t => localStorage.setItem('fbt-theme', t), theme);
      await page.setViewportSize({ width, height });
      await signIn(page);
      await expect(page.getByRole('heading', { name: 'Hola, Ana.' })).toBeAttached();
      for (const [at, label] of [[350, 'subida'], [1400, 'saludo']] as const) {
        await page.evaluate(ms => document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; }), at);
        await page.screenshot({ path: `${SHOTS}/${theme}-${width}x${height}-${label}.png` });
      }
      await page.clock.runFor(2000);
      await expect(page.getByRole('heading', { name: /Hola/ })).toHaveCount(0);
    });
  }
}

test('con movimiento reducido dura 900 ms como máximo', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('fbt-theme', 'light'));
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Hola, Ana.' })).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/light-390x844-reducido.png` });
  await expect(page.getByRole('heading', { name: /Hola/ })).toHaveCount(0, { timeout: 1500 });
});

test('un nombre de 60 caracteres con emoji no desborda a 360 px', async ({ page }) => {
  const long = 'Maximiliano Alejandro de la Santísima Trinidad Fernández 🚴‍♀️';
  await page.route('https://*.supabase.co/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/token')) return route.fulfill({ json: { ...session, user: { ...session.user, user_metadata: { full_name: long } } } });
    return route.abort();
  });
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page);
  const heading = page.getByRole('heading', { name: /Hola/ });
  await expect(heading).toBeVisible();
  const box = await heading.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  expect(box!.height).toBeLessThan(44 * 1.1 * 2 + 4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/dark-360x740-nombre-largo.png` });
});
