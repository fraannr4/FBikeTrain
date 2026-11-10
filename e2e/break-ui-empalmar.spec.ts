import { readFileSync } from 'node:fs';
import { expect as baseExpect, test as baseTest } from '@playwright/test';
import { expect, test, type Page, TEST_SESSION, TEST_USER_ID } from './accountFixture';
import { NOW, RIDES, seed, settings } from './seed';

// Peor caso realista (skill break-ui) para Empalmar y la bienvenida. Los datos entran por la misma
// frontera que los reales: IndexedDB «ciclismo-user-…», ORS simulado y la sesión de Supabase simulada.

const LAT = 40.4168;
const M_LNG = 111_320 * Math.cos((LAT * Math.PI) / 180);
const lng = (x: number) => -3.75 + x / M_LNG;
const line = (x0: number, x1: number, step = 10) =>
  Array.from({ length: Math.round(Math.abs(x1 - x0) / step) + 1 }, (_, i) => ({ lat: LAT, lng: lng(x0 + Math.sign(x1 - x0) * i * step), ele: 650 + (i % 50) }));

function stored(id: string, name: string, points: { lat: number; lng: number; ele: number }[]) {
  let distanceM = 0;
  for (let i = 1; i < points.length; i++) distanceM += Math.abs(points[i].lng - points[i - 1].lng) * M_LNG;
  return {
    id, name, format: 'gpx', sourceFileName: `${id}.gpx`, originalXml: '<gpx/>', originalPoints: points, points,
    summary: { distanceM, elevGainM: 500, elevLossM: 500, closed: false, pointCount: points.length }, createdAt: 1, updatedAt: 1,
  };
}

function orsPath(body: { coordinates: [number, number][] }) {
  const [[aLng, aLat], [bLng, bLat]] = body.coordinates;
  const n = Math.max(1, Math.round((Math.abs(bLng - aLng) * M_LNG + Math.abs(bLat - aLat) * 111_320) / 40));
  const coordinates = Array.from({ length: n + 1 }, (_, i) => [aLng + ((bLng - aLng) * i) / n, aLat + ((bLat - aLat) * i) / n, 650]);
  const d = n * 40;
  const one = (value: number) => ({ values: [[0, n, value]], summary: [{ value, distance: d, amount: 100 }] });
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { summary: { distance: d, duration: d / 6 }, extras: { surface: one(3), waytypes: one(2), steepness: one(0), waycategory: one(0) } } }] };
}

async function putRoutes(page: Page, routes: unknown[]) {
  await page.evaluate(async (rows) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ciclismo-user-00000000-0000-0000-0000-000000000011');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['referenceRoutes'], 'readwrite');
    for (const r of rows) tx.objectStore('referenceRoutes').put(r);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  }, routes);
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

// 120 caracteres: el máximo que acepta la biblioteca (library.ts:177).
const LONG_NAME = 'Vuelta a Mallorca 312 — Port d’Andratx · Sóller · Puig Major · Lluc · Formentor 🚴‍♀️🏔️ con Aleksandra Wiśniewska-K';
const ARABIC = 'رحلة الدراجة الصباحية على طريق الساحل';
const UNBROKEN = 'bartholomew.fitzgerald@northwind-industries-holdings.example.com';

test.describe('Empalmar, peor caso', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });
  test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(NOW); await page.route(/tile-cyclosm/, r => r.abort()); });

  test('nombres de 120 caracteres y sin espacios a 360 px', async ({ page }) => {
    test.setTimeout(120_000);
    await page.route('https://api.heigit.org/openrouteservice/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(orsPath(JSON.parse(route.request().postData() ?? '{}'))) }));
    await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
    await putRoutes(page, [stored('a', LONG_NAME, line(0, 40_000)), stored('b', ARABIC, line(45_000, 48_000)), stored('c', UNBROKEN, line(50_000, 53_000))]);
    await page.goto('#/rutas/empalmar');
    await page.getByRole('combobox', { name: 'Primera ruta' }).selectOption('a');
    await page.getByRole('combobox', { name: 'Segunda ruta' }).selectOption('c');
    expect(await noHorizontalScroll(page)).toBe(true);
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Calcular empalme' }).click();
    const list = page.getByRole('list', { name: 'Opciones de empalme' });
    await expect(list).toBeVisible({ timeout: 60_000 });
    console.log(`empalme calculado en ${Date.now() - t0} ms`);
    expect(await noHorizontalScroll(page)).toBe(true);
    const card = list.getByRole('listitem').first();
    const box = await card.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    await page.screenshot({ path: 'test-results/break-ui/empalmar-nombres-360.png', fullPage: true });

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar GPX' }).click()]);
    const gpx = readFileSync((await download.path())!, 'utf8');
    const trkpts = (gpx.match(/<trkpt /g) ?? []).length;
    console.log(`GPX exportado: ${trkpts} trkpt, ${(gpx.length / 1e6).toFixed(1)} MB, fichero ${download.suggestedFilename()}`);
    expect(gpx).toContain('<name>');
  });

  // Antes fallaba (QA 2026-11-09): el empalme pasaba del límite de 50.000 puntos. Ahora se aclara el track.
  test('dos salidas largas (2 × 30.000 puntos, como dos GPX de 8 h a 1 punto/s) se empalman y exportan', async ({ page }) => {
    test.setTimeout(120_000);
    await page.route('https://api.heigit.org/openrouteservice/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(orsPath(JSON.parse(route.request().postData() ?? '{}'))) }));
    await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
    // Cada una está dentro del límite de 50.000 puntos de la biblioteca; juntas, no.
    await putRoutes(page, [stored('a', 'Larga uno', line(0, 300_000)), stored('b', 'Larga dos', line(305_000, 605_000))]);
    await page.goto('#/rutas/empalmar');
    await page.getByRole('combobox', { name: 'Primera ruta' }).selectOption('a');
    await page.getByRole('combobox', { name: 'Segunda ruta' }).selectOption('b');
    await page.getByRole('button', { name: 'Calcular empalme' }).click();
    await expect(page.getByRole('list', { name: 'Opciones de empalme' })).toBeVisible({ timeout: 60_000 });
    const downloaded = page.waitForEvent('download', { timeout: 5_000 }).then(() => true, () => false);
    await page.getByRole('button', { name: 'Exportar GPX' }).click();
    const alert = await page.getByRole('alert').textContent({ timeout: 2_000 }).catch(() => null);
    console.log(`exportar 60.000 puntos: descarga=${await downloaded} alerta=${JSON.stringify(alert)}`);
    expect(alert).toBeNull();
    expect(await downloaded).toBe(true);
  });

  // Antes fallaba (QA 2026-11-09): una combinación que no cabía tumbaba también las válidas.
  test('una combinación demasiado grande no tumba las opciones válidas', async ({ page }) => {
    test.setTimeout(120_000);
    await page.route('https://api.heigit.org/openrouteservice/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(orsPath(JSON.parse(route.request().postData() ?? '{}'))) }));
    await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
    await putRoutes(page, [stored('a', 'Cuatrocientos', line(0, 400_000)), stored('c', 'Corta', line(410_000, 413_000))]);
    await page.goto('#/rutas/empalmar');
    await page.getByRole('combobox', { name: 'Primera ruta' }).selectOption('a');
    await page.getByRole('combobox', { name: 'Segunda ruta' }).selectOption('c');
    await page.getByRole('button', { name: 'Calcular empalme' }).click();
    await expect(page.getByRole('list', { name: 'Opciones de empalme' })).toBeVisible({ timeout: 30_000 });
  });

  test('árabe como primera ruta a 360 px', async ({ page }) => {
    await page.route('https://api.heigit.org/openrouteservice/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(orsPath(JSON.parse(route.request().postData() ?? '{}'))) }));
    await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
    await putRoutes(page, [stored('b', ARABIC, line(405_000, 408_000)), stored('c', UNBROKEN, line(410_000, 413_000))]);
    await page.goto('#/rutas/empalmar');
    await page.getByRole('combobox', { name: 'Primera ruta' }).selectOption('b');
    await page.getByRole('combobox', { name: 'Segunda ruta' }).selectOption('c');
    await page.getByRole('button', { name: 'Calcular empalme' }).click();
    await expect(page.getByRole('list', { name: 'Opciones de empalme' })).toBeVisible({ timeout: 30_000 });
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({ path: 'test-results/break-ui/empalmar-arabe-360.png', fullPage: true });
  });

  for (const n of [0, 1] as const) {
    test(`con ${n} rutas explica qué hacer y no deja calcular`, async ({ page }) => {
      await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
      if (n === 1) await putRoutes(page, [stored('a', LONG_NAME, line(0, 3000))]);
      await page.goto('#/rutas/empalmar');
      await expect(page.getByText('Necesitas al menos dos rutas')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Calcular empalme' })).toBeDisabled();
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  }

  test('300 rutas en la biblioteca: los selectores cargan', async ({ page }) => {
    await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
    await putRoutes(page, Array.from({ length: 300 }, (_, i) => stored(`r${i}`, `${i % 3 ? LONG_NAME.slice(0, 60) : ARABIC} ${i}`, line(i * 10, i * 10 + 500, 50))));
    const t0 = Date.now();
    await page.goto('#/rutas/empalmar');
    await expect(page.getByRole('combobox', { name: 'Primera ruta' }).locator('option')).toHaveCount(301);
    console.log(`300 rutas listas en ${Date.now() - t0} ms`);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

// La bienvenida necesita un inicio de sesión real: sin la sesión precargada del fixture.
const signInWith = async (page: import('@playwright/test').Page, fullName: string) => {
  const session = { ...TEST_SESSION, user: { ...TEST_SESSION.user, user_metadata: { full_name: fullName } } };
  await page.route('https://*.supabase.co/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/token')) return route.fulfill({ json: session });
    if (url.pathname === '/rest/v1/profiles') return route.fulfill({ json: { id: TEST_USER_ID, display_name: 'Ciclista' } });
    return route.abort();
  });
  await page.goto('#/');
  await page.getByLabel('Correo electrónico').fill('synthetic@example.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
};

for (const [label, name, w, h] of [
  ['árabe 360', ARABIC, 360, 740],
  ['sin espacios 360', UNBROKEN, 360, 740],
  ['nombre largo apaisado 740x360', LONG_NAME, 740, 360],
] as const) {
  baseTest(`bienvenida: ${label}`, async ({ page }) => {
    // La auditoría mide la escena de 1,8 s incluso con la máquina cargada.
    await page.clock.install({ time: new Date('2026-11-10T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-11-10T13:00:00Z'));
    await page.setViewportSize({ width: w, height: h });
    await signInWith(page, name);
    const heading = page.getByRole('heading', { name: /Hola/ });
    await baseExpect(heading).toBeAttached();
    await page.evaluate(() => document.getAnimations().forEach(a => { a.pause(); a.currentTime = 1400; }));
    const hb = (await heading.boundingBox())!;
    const bb = (await page.getByRole('button', { name: 'Continuar' }).boundingBox())!;
    await page.screenshot({ path: `test-results/break-ui/welcome-${w}x${h}-${label.split(' ')[0]}.png` });
    baseExpect(hb.x).toBeGreaterThanOrEqual(0);
    baseExpect(hb.x + hb.width).toBeLessThanOrEqual(w);
    baseExpect(hb.y).toBeGreaterThanOrEqual(0);
    // El saludo no queda debajo del botón Continuar.
    baseExpect(hb.y + hb.height).toBeLessThanOrEqual(bb.y);
    baseExpect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
  });
}
