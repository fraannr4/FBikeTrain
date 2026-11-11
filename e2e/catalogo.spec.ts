import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from './accountFixture';
import { HOME, NOW, RIDES, seed, settings } from './seed';

// Todo es sintético: OpenStreetMap (Overpass), Open-Meteo y ORS están interceptados; nunca se sale a wikiloc.com.
test.setTimeout(90_000);

const CORS = { 'access-control-allow-origin': '*' };
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((HOME.lat * Math.PI) / 180);

/** Circuito de `km` que pasa por Casa, hacia la dirección `angle` (radianes). */
function circuit(km: number, angle: number) {
  const r = (km * 1000) / (2 * Math.PI);
  const cx = Math.cos(angle) * r;
  const cy = Math.sin(angle) * r;
  return Array.from({ length: 361 }, (_, i) => {
    const t = angle + Math.PI + (i / 360) * 2 * Math.PI;
    return { lat: HOME.lat + (cy + r * Math.sin(t)) / M_LAT, lon: HOME.lng + (cx + r * Math.cos(t)) / M_LNG };
  });
}

const NAMES = [
  'Vuelta sintética al embalse con un nombre muy largo para comprobar el móvil',
  'Circuito sintético de las colinas',
  'Anillo verde sintético',
  'Ruta BTT sintética del bosque',
];
const OVERPASS = {
  elements: NAMES.map((name, i) => ({
    type: 'relation', id: 9000 + i, tags: { type: 'route', route: i === 3 ? 'mtb' : 'bicycle', name },
    members: [{ type: 'way', ref: 1, role: '', geometry: circuit(29 + i, (i * Math.PI) / 2) }],
  })),
};

const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function setup(page: Page) {
  const context = page.context();
  const sent: string[] = [];
  await context.clock.setFixedTime(NOW);
  await context.route('https://*.supabase.co/**', (r) => r.abort());
  await context.route('https://api.heigit.org/**', (r) => r.abort());
  await context.route('https://*.wikiloc.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Wikiloc sintético</p>' }));
  await context.route('https://overpass-api.de/**', (r) => {
    const body = r.request().postData() ?? '';
    sent.push(decodeURIComponent(body));
    const data = body.includes('mountain_pass') ? { elements: [] } : OVERPASS;
    return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(data) });
  });
  await context.route('https://api.open-meteo.com/**', (r) => {
    const n = new URL(r.request().url()).searchParams.get('latitude')!.split(',').length;
    const elevation = Array.from({ length: n }, (_, i) => 650 + 30 * Math.sin(i / 8));
    return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ elevation }) });
  });
  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
  return sent;
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [360, 430]) {
    test(`Catálogo: carga de OSM y 3 propuestas (${theme}, ${width} px)`, async ({ page }) => {
      const dir = 'test-results/catalogo';
      mkdirSync(dir, { recursive: true });
      await page.setViewportSize({ width, height: 860 });
      await page.context().addInitScript((t) => localStorage.setItem('fbt-theme', t), theme);
      const sent = await setup(page);

      await page.goto('#/rutas');
      await page.getByRole('link', { name: /Rutas de tu catálogo/ }).click();
      await expect(page.getByText(/Tu catálogo está vacío/)).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${dir}/vacio-${theme}-${width}.png`, fullPage: true });

      // 1. Precarga desde la app: el centro sale redondeado a 2 decimales.
      await page.getByRole('button', { name: 'Cargar rutas de OpenStreetMap' }).click();
      await expect(page.getByText('4 rutas: 4 de OpenStreetMap, 0 a puertos, 0 de Ride with GPS y 0 tuyas.')).toBeVisible({ timeout: 20_000 });
      expect(sent[0]).toContain(`around:15000,${Number(HOME.lat.toFixed(2))},${Number(HOME.lng.toFixed(2))}`);
      expect(sent.join('')).not.toContain(String(HOME.lat));

      // 2. Tres propuestas por km y desnivel, que salen y vuelven a Casa.
      await page.getByLabel('Distancia').fill('30');
      await page.getByLabel('Desnivel (opcional)').fill('300');
      await page.getByRole('button', { name: 'Proponer 3 rutas' }).click();
      const cards = page.getByRole('article');
      await expect(cards).toHaveCount(3, { timeout: 30_000 });
      await expect(cards.first().getByRole('link', { name: /Ver en OpenStreetMap/ })).toBeVisible();
      await expect(cards.first()).toContainText('Desnivel estimado');
      await expect(cards.first().getByRole('button', { name: 'Enviar al iGPSPORT' })).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${dir}/propuestas-${theme}-${width}.png`, fullPage: true });

      await cards.first().getByRole('button', { name: 'Guardar en la biblioteca' }).click();
      await expect(cards.first().getByRole('button', { name: 'Guardada en la biblioteca' })).toBeDisabled();

      // 3. Wikiloc: el botón abre una pestaña del usuario con los filtros; la app no lee nada de ella.
      const popup = page.waitForEvent('popup');
      await page.getByRole('button', { name: /Buscar en Wikiloc/ }).click();
      const tab = await popup;
      await tab.waitForURL(/wikiloc\.com\/wikiloc\/map\.do\?.*act=29/);
      await tab.close();
      expect(await noOverflow(page)).toBe(true);
    });
  }
}
