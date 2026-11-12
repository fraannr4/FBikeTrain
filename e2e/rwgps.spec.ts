import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from './accountFixture';
import { HOME, NOW, RIDES, seed, settings } from './seed';

// Todo es sintético: la API de Ride with GPS está interceptada; no se sale a ridewithgps.com.
test.setTimeout(90_000);

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
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
  const direct: string[] = [];
  await context.clock.setFixedTime(NOW);
  await context.route('https://*.supabase.co/**', (r) => r.abort());
  await context.route('https://api.heigit.org/**', (r) => r.abort());
  // Ride with GPS directo nunca: si la app lo intentara, la prueba falla por la cuenta de llamadas.
  await context.route('https://ridewithgps.com/**', (r) => { direct.push(r.request().url()); return r.abort(); });
  // Función `rwgps` compartida, simulada. En la página y después del bloqueo de supabase.co, así que gana.
  await page.route('https://*.supabase.co/functions/v1/rwgps', (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    bodies.push(req.postData() ?? '');
    const json = (body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
    const ask = JSON.parse(req.postData() ?? '{}') as { kind?: string; id?: string };
    if (ask.kind === 'collection' && ask.id === '55') return json({ data: { collection: { name: 'Cerca de casa', routes: [{ id: 2 }, { id: 3 }] } } });
    const id = Number(ask.id);
    if (ask.kind !== 'route' || !id) return json({ error: { code: 'not_found', message: 'x' } }, 404);
    return json({ data: { route: { name: `Ruta sintética de Ride with GPS con nombre largo ${id}`, user: { name: 'Autora sintética' }, track_points: trackPoints(28 + id, id) } } });
  });
  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
  return { bodies, direct };
}

for (const width of [360, 430]) {
  test(`Ride with GPS compartido: pegar enlaces y proponer (${width} px)`, async ({ page }) => {
    const dir = 'test-results/rwgps';
    mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width, height: 860 });
    const { bodies, direct } = await setup(page);
    await page.goto('#/rutas/catalogo');

    // Sin formulario de conexión: la cuenta común está en el servidor.
    await expect(page.getByLabel('Clave de API')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /colección fijada/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Buscar en Ride with GPS/ })).toBeVisible();
    await page.getByLabel('Enlaces de rutas o colecciones').fill('https://ridewithgps.com/routes/1-sintetica\nhttps://ridewithgps.com/collections/55');
    await page.getByRole('button', { name: 'Añadir al catálogo' }).click();
    await expect(page.getByText('3 rutas: 0 de OpenStreetMap, 0 a puertos, 3 de Ride with GPS y 0 tuyas.')).toBeVisible({ timeout: 20_000 });
    expect(bodies.map((b) => JSON.parse(b))).toEqual([{ kind: 'collection', id: '55' }, { kind: 'route', id: '1' }, { kind: 'route', id: '2' }, { kind: 'route', id: '3' }]);
    expect(direct).toEqual([]);
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: `${dir}/compartido-${width}.png`, fullPage: true });

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
