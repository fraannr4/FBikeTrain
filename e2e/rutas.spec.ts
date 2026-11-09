import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { MOBILE, NOW, RIDES, seed, settings } from './seed';

const ORS_OK = readFileSync(fileURLToPath(new URL('../tests/fixtures/ors/round-trip-ok.json', import.meta.url)), 'utf8');

test.use({ viewport: MOBILE, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test('rutas generates and downloads gpx', async ({ page }) => {
  let calls = 0;
  await page.route('https://api.openrouteservice.org/**', (route) => {
    calls++;
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: ORS_OK });
  });
  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
  await page.goto('#/rutas');

  // El fixture es un círculo de unos 30 km: se pide esa distancia.
  // El stepper se maneja con el teclado (un paso por pulsación).
  const dist = page.getByRole('group', { name: 'Distancia' });
  const less = dist.getByRole('button', { name: 'Menos distancia' });
  await less.focus();
  for (let i = 0; i < 40 && !/^30\s?km/.test((await dist.locator('output').innerText()).trim()); i++) await page.keyboard.press('Enter');
  await expect(dist.locator('output')).toContainText('30');
  await page.getByRole('button', { name: /Generar 5 rutas/ }).click();
  await expect(page.getByRole('list', { name: 'Rutas generadas' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('list', { name: 'Rutas generadas' }).getByRole('listitem').first()).toBeVisible();
  expect(calls).toBeGreaterThan(0);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Exportar GPX de/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.gpx$/);
  const gpx = readFileSync((await download.path())!, 'utf8');
  expect(gpx).toContain('<gpx');
  expect(gpx).toContain('version="1.1"');
  expect(gpx).toContain('http://www.topografix.com/GPX/1/1');
  expect(gpx).toContain('<trkseg>');
  expect(gpx).toMatch(/<trkpt lat="[-\d.]+" lon="[-\d.]+">/);
  expect(gpx).toContain('<ele>');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test('rutas without a key shows the no-key state', async ({ page }) => {
  await page.route('https://api.openrouteservice.org/**', (route) => route.abort('failed'));
  await seed(page, { activities: RIDES, settings: settings({ orsKey: '' }) });
  await page.goto('#/rutas');
  await expect(page.getByRole('heading', { name: 'Falta tu clave de rutas' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ir a Ajustes' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Generar 5 rutas/ })).toHaveCount(0);
});

test('rutas shows an error when ORS does not answer', async ({ page }) => {
  await page.route('https://api.openrouteservice.org/**', (route) => route.abort('failed'));
  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
  await page.goto('#/rutas');
  await page.getByRole('button', { name: /Generar 5 rutas/ }).click();
  await expect(page.getByRole('heading', { name: 'No se han podido generar las rutas' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/ORS no responde/)).toBeVisible();
});
