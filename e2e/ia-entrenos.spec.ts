import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from './accountFixture';
import { MOBILE, NOW, RIDES, seed, settings } from './seed';

// Semana propuesta por la IA en el móvil, con el proveedor simulado y la clave propia de Ajustes.

const WORKOUTS_OK = readFileSync(fileURLToPath(new URL('../tests/fixtures/llm/workouts-ok.json', import.meta.url)), 'utf8');
const CORS = { 'access-control-allow-origin': '*' };

test.use({ viewport: MOBILE, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test('ai week proposal ends up in the calendar', async ({ page }) => {
  const bodies: string[] = [];
  await page.route('**/chat/completions', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    bodies.push(r.request().postData() ?? '');
    return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: WORKOUTS_OK });
  });
  await seed(page, { activities: RIDES, settings: settings({ llmKey: 'test-key' }) });
  await page.goto('#/plan');

  await page.getByRole('button', { name: 'Proponer semana con IA' }).click();
  const sheet = page.getByRole('dialog', { name: 'Proponer semana con IA' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Proponer' }).click();

  // La propuesta: el rodaje de hoy y la salida larga, recortada a la referencia.
  await expect(sheet.getByRole('checkbox', { name: /Rodaje suave/ })).toBeChecked({ timeout: 20_000 });
  await expect(sheet.getByRole('checkbox', { name: /Salida larga/ })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await sheet.getByRole('button', { name: /^Añadir al calendario \(\d\)$/ }).click();

  await expect(sheet).toBeHidden();
  await expect(page.getByRole('article', { name: 'Rodaje suave' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Próximos' }).getByText('Salida larga')).toBeVisible();

  // A la IA solo le llegan cifras: ni coordenadas ni «Casa».
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).not.toMatch(/\b(lat|lng|lon|coordinates|trkpt|geometry)\b/i);
  expect(bodies[0]).not.toContain('40.4168');
});
