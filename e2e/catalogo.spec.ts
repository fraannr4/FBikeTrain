import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from './accountFixture';
import { HOME, NOW, RIDES, seed, settings } from './seed';

// Todo es sintético: Wikiloc y la nube están interceptados; la app nunca lee wikiloc.com.
test.setTimeout(90_000);

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

/** GPX sintético de Wikiloc: un circuito de `km` que pasa por Casa. */
const gpx = (km: number) => `<gpx version="1.1"><metadata><link href="https://es.wikiloc.com/rutas-ciclismo/sintetica-1"/></metadata><trk><name>Vuelta sintética de Wikiloc con un nombre muy largo para el móvil</name><trkseg>${circuit(km, Math.PI / 3)
  .map((p, i) => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${650 + 20 * Math.sin(i / 10)}</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;

const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function setup(page: Page) {
  const context = page.context();
  await context.clock.setFixedTime(NOW);
  await context.route('https://*.supabase.co/**', (r) => r.abort());
  await context.route('https://api.heigit.org/**', (r) => r.abort());
  await context.route('https://*.wikiloc.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Wikiloc sintético</p>' }));
  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [360, 430]) {
    test(`Rutas de Ride with GPS: sección de Wikiloc (${theme}, ${width} px)`, async ({ page }) => {
      const dir = 'test-results/catalogo';
      mkdirSync(dir, { recursive: true });
      await page.setViewportSize({ width, height: 860 });
      await page.context().addInitScript((t) => localStorage.setItem('fbt-theme', t), theme);
      await setup(page);

      await page.goto('#/rutas');
      await page.getByRole('link', { name: /Rutas de Ride with GPS/ }).click();
      await expect(page.getByRole('button', { name: 'Proponer rutas' })).toBeVisible();
      await expect(page.getByRole('button', { name: /OpenStreetMap/ })).toHaveCount(0);
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${dir}/inicio-${theme}-${width}.png`, fullPage: true });

      // Wikiloc: el botón abre una pestaña del usuario con los filtros; la app no lee nada de ella.
      const popup = page.waitForEvent('popup');
      await page.getByRole('button', { name: /Buscar en Wikiloc/ }).click();
      const tab = await popup;
      await tab.waitForURL(/wikiloc\.com\/wikiloc\/map\.do\?.*act=29/);
      await tab.close();

      // El GPX descargado se adapta a la distancia pedida y sale de Casa.
      await page.getByLabel('Distancia').fill('30');
      await page.getByLabel('Subir el GPX descargado').setInputFiles({ name: 'vuelta.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx(30)) });
      const card = page.getByRole('article');
      await expect(card).toHaveCount(1, { timeout: 30_000 });
      await expect(card.getByRole('link', { name: /Ver en Wikiloc/ })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Enviar al iGPSPORT' })).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${dir}/wikiloc-${theme}-${width}.png`, fullPage: true });
    });
  }
}
