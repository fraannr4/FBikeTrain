import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from './accountFixture';
import { HOME, NOW, RIDES, seed, settings } from './seed';

// Todo es sintético: la API de Ride with GPS está interceptada; no se sale a ridewithgps.com.
test.setTimeout(90_000);

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'x-rwgps-api-key,x-rwgps-auth-token,content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((HOME.lat * Math.PI) / 180);

/** Circuito de `km` que pasa por Casa, en formato `track_points` de la API v1. */
function trackPoints(km: number, angle: number) {
  const r = (km * 1000) / (2 * Math.PI);
  return Array.from({ length: 361 }, (_, i) => {
    const t = angle + Math.PI + (i / 360) * 2 * Math.PI;
    return { y: HOME.lat + (Math.sin(angle) * r + r * Math.sin(t)) / M_LAT, x: HOME.lng + (Math.cos(angle) * r + r * Math.cos(t)) / M_LNG, e: 650 + 20 * Math.sin(i / 10) };
  });
}

const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function setup(page: Page) {
  const context = page.context();
  const bodies: string[] = [];
  await context.clock.setFixedTime(NOW);
  await context.route('https://*.supabase.co/**', (r) => r.abort());
  await context.route('https://api.heigit.org/**', (r) => r.abort());
  await context.route('https://ridewithgps.com/api/v1/**', (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 200, headers: CORS });
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
    if (url.pathname === '/api/v1/auth_tokens.json') {
      bodies.push(req.postData() ?? '');
      return json({ auth_token: { auth_token: 'token-sintetico-123' } }, 201);
    }
    if (url.pathname === '/api/v1/collections/55.json') return json({ collection: { name: 'Cerca de casa', routes: [{ id: 2 }, { id: 3 }] } });
    const id = Number(/routes\/(\d+)\.json/.exec(url.pathname)?.[1]);
    if (!id) return json({ error: 'no' }, 404);
    return json({ route: { name: `Ruta sintética de Ride with GPS con nombre largo ${id}`, user: { name: 'Autora sintética' }, track_points: trackPoints(28 + id, id) } });
  });
  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
  return bodies;
}

for (const width of [360, 430]) {
  test(`Ride with GPS: conectar, pegar enlaces y proponer (${width} px)`, async ({ page }) => {
    const dir = 'test-results/rwgps';
    mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width, height: 860 });
    const bodies = await setup(page);
    await page.goto('#/rutas/catalogo');

    await page.getByLabel('Clave de API').fill('clave-sintetica');
    await page.getByLabel('Correo de Ride with GPS').fill('ciclista@example.com');
    await page.getByLabel('Contraseña de Ride with GPS').fill('secreta');
    await page.getByRole('button', { name: 'Conectar Ride with GPS' }).click();
    await expect(page.getByLabel('Enlaces de rutas o colecciones')).toBeVisible();
    expect(JSON.parse(bodies[0])).toEqual({ user: { email: 'ciclista@example.com', password: 'secreta' } });
    // La contraseña no queda en ningún almacenamiento del navegador.
    const stored = await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      return JSON.stringify(dbs) + JSON.stringify(localStorage);
    });
    expect(stored).not.toContain('secreta');

    await page.getByLabel('Enlaces de rutas o colecciones').fill('https://ridewithgps.com/routes/1-sintetica\nhttps://ridewithgps.com/collections/55');
    await page.getByRole('button', { name: 'Añadir al catálogo' }).click();
    await expect(page.getByText('3 rutas: 0 de OpenStreetMap, 0 a puertos, 3 de Ride with GPS y 0 tuyas.')).toBeVisible({ timeout: 20_000 });
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: `${dir}/conectado-${width}.png`, fullPage: true });

    await page.getByLabel('Distancia').fill('30');
    await page.getByRole('button', { name: 'Proponer 3 rutas' }).click();
    const cards = page.getByRole('article');
    await expect(cards).toHaveCount(3, { timeout: 30_000 });
    await expect(cards.first()).toContainText('Autora sintética en Ride with GPS');
    await expect(cards.first().getByRole('link', { name: /Ver en Ride with GPS/ })).toHaveAttribute('href', /^https:\/\/ridewithgps\.com\/routes\/\d+$/);
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: `${dir}/propuestas-${width}.png`, fullPage: true });
  });
}
