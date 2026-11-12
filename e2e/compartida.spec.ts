import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from './accountFixture';
import { HOME, NOW, RIDES, seed, settings } from './seed';

// Todo es sintético: la función `rwgps` está simulada y el navegador nunca llama a ridewithgps.com.
test.setTimeout(120_000);

const DIR = 'test-results/compartida';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((HOME.lat * Math.PI) / 180);

/** Circuito de `km` que sale y vuelve a Casa, con su punto más lejano hacia `deg`. */
function circuit(km: number, deg: number, n: number) {
  const r = (km * 1000) / (2 * Math.PI);
  const a = (deg * Math.PI) / 180;
  const cx = Math.sin(a) * r;
  const cy = Math.cos(a) * r;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = Math.atan2(-cy, -cx) + (i / n) * 2 * Math.PI;
    return { lat: HOME.lat + (cy + r * Math.sin(t)) / M_LAT, lng: HOME.lng + (cx + r * Math.cos(t)) / M_LNG };
  });
}
/** Tramo recto de 20 km que empieza a 5 km al norte de Casa: obliga a pedir carreteras a ORS. */
const farLine = Array.from({ length: 200 }, (_, i) => ({ lat: HOME.lat + 5000 / M_LAT, lng: HOME.lng + (i * 100) / M_LNG }));

const ROUTES: Record<string, { lat: number; lng: number }[]> = {
  '501': circuit(60, 0, 720), '502': circuit(61, 120, 720), '503': circuit(59, 240, 720), '777': farLine,
};
const NAME = (id: string) => `Ruta sintética compartida con un nombre bastante largo ${id}`;

const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** Alto mínimo de los botones y enlaces-botón visibles del contenido. */
const minTarget = (p: Page) => p.evaluate(() => Math.min(...[...document.querySelectorAll('main button, main a.btn, main .row')]
  .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0).map((r) => r.height)));

async function setup(page: Page, opts: { orsLimited?: boolean } = {}) {
  const context = page.context();
  const bodies: { kind?: string; id?: string }[] = [];
  const direct: string[] = [];
  await context.clock.setFixedTime(NOW);
  await context.route('https://*.supabase.co/**', (r) => r.abort());
  await context.route('https://api.heigit.org/**', (r) => (opts.orsLimited ? r.fulfill({ status: 429, contentType: 'application/json', headers: CORS, body: '{"error":"Rate limit"}' }) : r.abort()));
  await context.route('https://ridewithgps.com/**', (r) => { direct.push(r.request().url()); return r.abort(); });
  await page.route('https://*.supabase.co/functions/v1/rwgps', (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const ask = JSON.parse(req.postData() ?? '{}');
    bodies.push(ask);
    const json = (body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
    if (ask.kind === 'collection' && ask.id === '90') {
      return json({ data: { collection: { name: 'Vueltas sintéticas del club ciclista con nombre largo', routes: [{ id: 501 }, { id: 502 }, { id: 503 }] } } });
    }
    if (ask.id === '666') return json({ error: { code: 'not_visible', message: 'x' } }, 403);
    const points = ROUTES[ask.id];
    if (ask.kind !== 'route' || !points) return json({ error: { code: 'not_found', message: 'x' } }, 404);
    const track_points = points.map((p, i) => ({ x: p.lng, y: p.lat, e: 650 + 20 * Math.sin(i / 10) }));
    return json({ data: { route: { name: NAME(ask.id), user: { name: 'Autora sintética' }, track_points } } });
  });
  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
  return { bodies, direct };
}

test.beforeAll(() => mkdirSync(DIR, { recursive: true }));

for (const width of [360, 430]) {
  test.describe(`${width} px`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width, height: 860 }); });

    test('una ruta compartida se lee por id y se adapta al inicio', async ({ page }) => {
      const { bodies, direct } = await setup(page);
      await page.goto('#/rutas');
      await page.getByRole('link', { name: /Ruta de Ride with GPS Explore/ }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Una ruta de Explore' })).toBeVisible();
      await page.goto(`#/rutas/compartida?enlaces=${encodeURIComponent('https://ridewithgps.com/routes/501')}`);
      await expect(page.getByText('Recibido desde Compartir')).toBeVisible();
      await expect(page.getByLabel('Enlaces de Ride with GPS')).toHaveValue('https://ridewithgps.com/routes/501');
      // Nada se lee hasta que el usuario lo pide.
      expect(bodies).toEqual([]);
      expect(await noOverflow(page)).toBe(true);
      expect(await minTarget(page)).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: `${DIR}/recibida-${width}.png`, fullPage: true });

      await page.getByLabel('Distancia').fill('60');
      await page.getByRole('button', { name: 'Adaptar', exact: true }).click();
      const card = page.getByRole('article');
      await expect(card).toHaveCount(1, { timeout: 60_000 });
      await expect(card).toContainText(NAME('501'));
      await expect(card.getByRole('link', { name: /Ver en Ride with GPS/ })).toHaveAttribute('href', 'https://ridewithgps.com/routes/501');
      expect(bodies).toEqual([{ kind: 'route', id: '501' }]);
      expect(direct).toEqual([]);
      expect(await noOverflow(page)).toBe(true);
      expect(await minTarget(page)).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: `${DIR}/adaptada-${width}.png`, fullPage: true });
      await card.getByRole('button', { name: 'Guardar en la biblioteca' }).click();
      await expect(card.getByRole('button', { name: 'Guardada en la biblioteca' })).toBeDisabled();
    });

    test('una colección se lista y se adapta la ruta elegida; una privada se explica', async ({ page }) => {
      const { bodies, direct } = await setup(page);
      await page.goto('#/rutas/compartida');
      await page.getByLabel('Distancia').fill('60');
      await page.getByLabel('Enlaces de Ride with GPS').fill('https://ridewithgps.com/collections/90 https://ridewithgps.com/routes/666');
      await page.getByRole('button', { name: 'Adaptar', exact: true }).click();
      const list = page.getByRole('list', { name: 'Rutas para elegir' });
      await expect(list.getByRole('listitem')).toHaveCount(4);
      expect(bodies).toEqual([{ kind: 'collection', id: '90' }]);
      expect(await noOverflow(page)).toBe(true);
      expect(await minTarget(page)).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: `${DIR}/coleccion-${width}.png`, fullPage: true });

      await list.getByRole('button', { name: 'Adaptar Ruta 666' }).click();
      await expect(page.getByRole('alert')).toContainText('No es pública en Ride with GPS');
      await list.getByRole('button', { name: /Adaptar Vueltas sintéticas .* 2 de 3/ }).click();
      await expect(page.getByRole('article')).toContainText(NAME('502'), { timeout: 60_000 });
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(direct).toEqual([]);
      await page.screenshot({ path: `${DIR}/coleccion-adaptada-${width}.png`, fullPage: true });
    });

    test('con el límite por minuto de ORS cuenta atrás y se puede cancelar', async ({ page }) => {
      await setup(page, { orsLimited: true });
      await page.goto(`#/rutas/compartida?enlaces=${encodeURIComponent('https://ridewithgps.com/routes/777')}`);
      await page.getByLabel('Distancia').fill('60');
      await page.getByRole('button', { name: 'Adaptar', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: /Sigo en \d+ s/ })).toBeVisible({ timeout: 30_000 });
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${DIR}/espera-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Cancelar' }).click();
      await expect(page.getByText(/Sigo en/)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Adaptar', exact: true })).toBeEnabled();
    });

    test('«Buscar en Ride with GPS Explore» abre Explore con los filtros, sin que la app lo consulte', async ({ page }) => {
      // Antes de cargar la app: un cambio de hash no vuelve a ejecutar los scripts de inicio.
      await page.addInitScript(() => {
        window.open = ((url: string) => { (window as unknown as { opened: string }).opened = url; return null; }) as typeof window.open;
      });
      const { direct } = await setup(page);
      await page.goto('#/rutas/compartida');
      await page.getByLabel('Distancia').fill('60');
      await page.getByLabel('Desnivel (opcional)').fill('800');
      await page.getByRole('button', { name: /Buscar en Ride with GPS Explore/ }).click();
      const opened = await page.evaluate(() => (window as unknown as { opened?: string }).opened);
      const lat = (Math.round(HOME.lat * 100) / 100).toString();
      const lng = (Math.round(HOME.lng * 100) / 100).toString();
      expect(opened).toBe(`https://ridewithgps.com/explore?b=p!${lng}!${lat}~15km&length=54*66km&ele=600*1000m&s=paved&m=routes&a=cycling%3Aroad`);
      expect(direct).toEqual([]);
    });
  });
}

test('Compartir un enlace de Ride with GPS abre la pantalla nueva; un texto sin enlace sigue como antes', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 860 });
  await page.context().route('https://ridewithgps.com/**', (r) => r.abort());
  await page.goto('/');
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready) && !!navigator.serviceWorker.controller, null, { timeout: 30_000 })
    .catch(async () => { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller); });
  const share = (fields: Record<string, string>) => page.evaluate((f) => {
    const form = document.createElement('form');
    form.method = 'post';
    form.enctype = 'multipart/form-data';
    form.action = new URL('share-target', location.href.split('#')[0]).href;
    for (const [name, value] of Object.entries(f)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.append(input);
    }
    document.body.append(form);
    form.submit();
  }, fields);

  await share({ title: 'Ruta', text: 'Mira esta ruta https://ridewithgps.com/routes/501?privacy_code=x en Ride with GPS', url: '' });
  await page.waitForURL(/#\/rutas\/compartida\?enlaces=/);
  await expect(page.getByLabel('Enlaces de Ride with GPS')).toHaveValue('https://ridewithgps.com/routes/501?privacy_code=x');
  await expect(page.getByText('Recibido desde Compartir')).toBeVisible();
  await page.screenshot({ path: `${DIR}/compartir-360.png`, fullPage: true });

  await share({ title: 'Hola', text: 'Un texto sin enlaces', url: '' });
  await page.waitForURL(/#\/compartido\?error=empty/);
});
