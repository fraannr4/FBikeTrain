import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { HOME, MOBILE, NOW, RIDES, seed, settings } from './seed';

const fx = (p: string) => readFileSync(fileURLToPath(new URL(`../tests/fixtures/${p}`, import.meta.url)), 'utf8');
const ORS_OK = fx('ors/round-trip-ok.json');
// El plan sintético pide ~50 km y el fixture de ORS es un círculo de ~30 km: se ajusta el plan a 30 km.
const PLAN_OK = (() => {
  const body = JSON.parse(fx('llm/plan-ok.json'));
  const plan = JSON.parse(body.choices[0].message.content);
  for (const o of plan.opciones) o.distanciaKm = 30;
  body.choices[0].message.content = JSON.stringify(plan);
  return JSON.stringify(body);
})();
const EXPLAIN_OK = fx('llm/explain-ok.json');
const CORS = { 'access-control-allow-origin': '*' };

test.use({ viewport: MOBILE, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

async function setup(page: Page, llm: (n: number) => string) {
  const bodies: string[] = [];
  await page.route('https://api.openrouteservice.org/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: ORS_OK }),
  );
  await page.route('**/chat/completions', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    bodies.push(r.request().postData() ?? '');
    return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: llm(bodies.length) });
  });
  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key', llmKey: 'test-key' }) });
  await page.goto('#/rutas/ia');
  return bodies;
}

/** Contesta las cuatro preguntas (Fondo, 2 h, Casa, Repetir zona; cada respuesta avanza sola) y pide las rutas. */
async function answerAndAsk(page: Page) {
  const step = async (radio: RegExp, nextTitle: string) => {
    await page.getByRole('radio', { name: radio }).click();
    await expect(page.getByRole('heading', { name: nextTitle })).toBeVisible();
  };
  await step(/^Fondo/, '¿Cuánto tiempo tienes?');
  await step(/^2 h/, '¿Desde dónde sales?');
  await step(/^Casa/, '¿Repetir zona o descubrir?');
  await step(/^Repetir zona/, 'Tu petición');
  await page.getByRole('button', { name: 'Pedir rutas a la IA' }).click();
}

test('ai routes happy path', async ({ page }) => {
  const bodies = await setup(page, (n) => (n === 1 ? PLAN_OK : EXPLAIN_OK));
  await answerAndAsk(page);
  await expect(page.getByRole('button', { name: /Exportar GPX de/ })).toBeVisible({ timeout: 40_000 });
  const cards = page.getByRole('region', { name: 'Propuestas' }).getByRole('listitem');
  expect(await cards.count()).toBeGreaterThanOrEqual(1);
  expect(bodies.length).toBeGreaterThanOrEqual(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test('ai invalid twice shows manual form', async ({ page }) => {
  const bad = JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'no es json' } }] });
  const bodies = await setup(page, () => bad);
  await answerAndAsk(page);
  await expect(page.getByRole('region', { name: 'Elige tu ruta' })).toBeVisible({ timeout: 40_000 });
  await expect(page.getByRole('group', { name: 'Distancia' })).toBeVisible();
  expect(bodies.length).toBe(2);
});

test('ai request body has no coordinates nor home', async ({ page }) => {
  const bodies = await setup(page, (n) => (n === 1 ? PLAN_OK : EXPLAIN_OK));
  await answerAndAsk(page);
  await expect(page.getByRole('button', { name: /Exportar GPX de/ })).toBeVisible({ timeout: 40_000 });
  expect(bodies.length).toBeGreaterThanOrEqual(2); // plan y explicación
  for (const body of bodies) {
    expect(body).not.toMatch(/\b(lat|lng|lon|latitude|longitude|coordinates|trkpt|geometry|polyline)\b/i);
    expect(body).not.toContain(String(HOME.lat));
    expect(body).not.toContain(String(HOME.lng));
    expect(body).not.toMatch(/40\.41|3\.70|Puerta del Sol/);
    // Ningún par de números con forma de coordenada [x, y] ni un array largo de puntos.
    expect(body).not.toMatch(/\[\s*-?\d+\.\d{4,}\s*,\s*-?\d+\.\d{4,}/);
  }
});
