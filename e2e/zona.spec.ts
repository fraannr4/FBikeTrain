import { test, expect, type Page } from './accountFixture';

// Tu zona: Nominatim y Supabase simulados. Datos sintéticos; ninguna llamada real.
test.setTimeout(90_000);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const PLACE = 'Villa Prueba, Comarca Sintética, Provincia Ficticia, España';
const SHOTS = 'test-results/amigos';

async function fakeServices(page: Page, locality: string | null = null) {
  const patches: unknown[] = [];
  await page.route('https://nominatim.openstreetmap.org/search**', (r) =>
    r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([
      { display_name: PLACE, lat: '41.6077', lon: '2.2876' },
      { display_name: 'Villa Prueba de Abajo, Otra Provincia Ficticia, España', lat: '40.1', lon: '-3.5' },
    ]) }));
  await page.route('https://*.supabase.co/rest/v1/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().includes('/rpc/my_area')) return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([{ locality, show_area: true }]) });
    if (req.method() === 'PATCH' && req.url().includes('/profiles')) {
      patches.push(req.postDataJSON());
      return r.fulfill({ status: 204, headers: CORS });
    }
    return r.abort();
  });
  return patches;
}

test('tras entrar sin pueblo pide la zona, guarda solo la celda y deja Casa en el móvil', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const patches = await fakeServices(page);
  await page.goto('./');
  await expect(page).toHaveURL(/#\/zona$/);
  await expect(page.getByRole('heading', { name: 'Tu zona', level: 1 })).toBeVisible();
  await page.getByLabel('¿Desde qué pueblo sales a rodar?').fill('Villa');
  await page.getByRole('radio', { name: PLACE }).check();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page).toHaveURL(/#\/$/);
  expect(patches).toEqual([{ locality: PLACE, area_lat: 41.61, area_lng: 2.29 }]);
  expect(JSON.stringify(patches)).not.toContain('41.6077');
  // Casa queda fijada en este dispositivo: Ajustes ya no la pide.
  await page.goto('./#/ajustes?abrir=casa');
  await expect(page.getByText('Punto de salida guardado.')).toBeVisible();
});

test('«Ahora no» vuelve a Inicio y no vuelve a preguntar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeServices(page);
  await page.goto('./');
  await expect(page).toHaveURL(/#\/zona$/);
  await page.getByRole('button', { name: 'Ahora no' }).click();
  await expect(page).toHaveURL(/#\/$/);
  const asked: string[] = [];
  page.on('request', (req) => { if (req.url().includes('/rpc/my_area')) asked.push(req.method()); });
  await page.reload();
  await expect(page.locator('main')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page).toHaveURL(/#\/$/);
  expect(asked).toEqual([]);
});

for (const width of [360, 430]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`capturas de Tu zona y de Ajustes a ${width} px en ${theme === 'light' ? 'claro' : 'oscuro'}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((t) => localStorage.setItem('fbt-theme', t), theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await fakeServices(page, null);
      await page.goto('./#/zona');
      await page.getByLabel('¿Desde qué pueblo sales a rodar?').fill('Villa');
      await page.getByRole('radio', { name: PLACE }).check();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
      await page.screenshot({ path: `${SHOTS}/zona-${width}-${theme}.png`, fullPage: true });
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.route('https://*.supabase.co/**', (r) => r.abort());
      await fakeServices(page, PLACE);
      await page.goto('./#/ajustes?abrir=zona');
      await expect(page.getByText(`Sales a rodar desde ${PLACE}.`)).toBeVisible();
      await page.locator('#zona').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/ajustes-zona-${width}-${theme}.png` });
    });
  }
}
