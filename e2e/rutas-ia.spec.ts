import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from './accountFixture';
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
  await page.route('https://api.heigit.org/openrouteservice/**', (r) =>
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

for (const theme of ['light', 'dark']) {
  for (const width of [360, 430]) {
    test(`IA usa referencias importadas sin filtrar datos privados ${theme} ${width}`, async ({ page }) => {
      test.setTimeout(90_000);
      mkdirSync('test-results/fuentes-externas', { recursive: true });
      await page.setViewportSize({ width, height: width === 360 ? 780 : 932 });
      await page.addInitScript(theme => localStorage.setItem('fbt-theme', theme), theme);
      const withLink = width === 430;
      const routeName = 'Recorrido sintético con nombre largo por montañas y pueblos para comprobar la referencia';
      const sourceUrl = 'https://es.wikiloc.com/rutas-ciclismo/sintetica-privada-123';
      const xml = `<gpx><metadata><author><name>Autor privado sintético</name></author>${withLink ? `<link href="${sourceUrl}"/>` : ''}</metadata><trk><name>${routeName}</name><trkseg><trkpt lat="${HOME.lat}" lon="${HOME.lng}"><ele>1</ele></trkpt><trkpt lat="40.42" lon="-3.70"><ele>30</ele></trkpt></trkseg></trk></gpx>`;
      const refPlan = JSON.parse(PLAN_OK);
      const content = JSON.parse(refPlan.choices[0].message.content);
      content.opciones.forEach((option: { referenciaId?: string }) => { option.referenciaId = 'ref1'; });
      refPlan.choices[0].message.content = JSON.stringify(content);
      const bodies = await setup(page, n => n === 1 ? JSON.stringify(refPlan) : EXPLAIN_OK);
      await page.goto('#/rutas/biblioteca');
      const input = page.getByLabel('Elegir GPX o TCX', { exact: true });
      await expect(input).toBeEnabled();
      await input.setInputFiles({ name: 'referencia.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(xml) });
      await expect(page.getByRole('status')).toContainText('Ruta analizada.');
      await page.goto('#/rutas/ia');
      await answerAndAsk(page);
      await expect(page.getByRole('button', { name: /Exportar GPX de/ }).first()).toBeVisible({ timeout: 50_000 });
      // El ORS simulado no recorre el esqueleto importado: la tarjeta no debe atribuirle la ruta.
      // El enlace y el autor de «Basada en» se prueban en tests/rutasIa.test.tsx y tests/routeCard.test.tsx.
      await expect(page.getByText(/Basada en:/)).toHaveCount(0);
      expect(bodies.length).toBeGreaterThan(0);
      const user = JSON.parse(bodies[0]).messages.find((m: { role: string }) => m.role === 'user');
      const refs = JSON.parse(user.content).referencias;
      expect(refs[0].fuente).toBe(withLink ? 'wikiloc' : 'biblioteca');
      expect(Object.keys(refs[0]).sort()).toEqual(['desnivelM', 'distanciaKm', 'fuente', 'id', 'nombre']);
      for (const body of bodies) {
        expect(body).not.toContain(sourceUrl);
        expect(body).not.toContain('Autor privado sintético');
        expect(body).not.toContain(String(HOME.lat));
        expect(body).not.toContain(String(HOME.lng));
        expect(body).not.toMatch(/\b(lat|lng|lon|coordinates|trkpt|geometry|originalXml)\b/i);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/fuentes-externas/ia-referencia-${theme}-${width}.png`, fullPage: true });
    });
  }
}
