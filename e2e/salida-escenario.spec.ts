import { mkdirSync } from 'node:fs';
import { expect, test, TEST_DATABASE, type Page } from './accountFixture';
import { NOW, RIDES, seed, settings } from './seed';

// Detalle de salida: el mapa y el perfil completo caben juntos en la primera pantalla, y recorrer el
// perfil mueve el punto del mapa. Datos sintéticos: un trazado inventado con dos subidas.

const SHOTS = 'docs/design/2026-11-17-salida-escenario';

/** Trazado de 36 km que sube dos veces: lat/lng inventados cerca de la Puerta del Sol. */
function syntheticTrack() {
  const pts = [] as { lat: number; lng: number; ele: number; dist: number; t: number }[];
  const n = 360;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const ele = 620 + 180 * Math.max(0, Math.sin(f * Math.PI * 2 - 0.4)) + 90 * Math.max(0, Math.sin(f * Math.PI * 4 + 1)) + 20 * Math.sin(f * 40);
    pts.push({
      lat: 40.4168 + 0.05 * Math.sin(f * Math.PI * 2) + 0.01 * f,
      lng: -3.7038 + 0.09 * Math.sin(f * Math.PI) * Math.cos(f * 3) + 0.08 * f,
      ele,
      dist: f * 36000,
      t: NOW.getTime() + i * 24000,
    });
  }
  return pts;
}

async function prepare(page: Page, theme: 'light' | 'dark', name?: string) {
  await page.clock.setFixedTime(NOW);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/tile-cyclosm/, (r) =>
    r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#d8d4c8"/></svg>' }),
  );
  await seed(page, { activities: [{ ...RIDES[0], hasTrack: true, ...(name ? { name } : {}) }, ...RIDES.slice(1)], settings: settings() });
  await page.evaluate(
    async ({ database, points }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open(database);
        r.onsuccess = () => resolve(r.result);
      });
      const tx = db.transaction(['tracks'], 'readwrite');
      tx.objectStore('tracks').put({ activityId: 's0', points });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { database: TEST_DATABASE, points: syntheticTrack() },
  );
  await page.addInitScript((t) => {
    localStorage.setItem('fbt-theme', t);
    document.documentElement.dataset.theme = t;
  }, theme);
}

const SIZES = [
  { w: 360, h: 780 },
  { w: 390, h: 844 },
  { w: 430, h: 932 },
  { w: 1440, h: 900 },
];

for (const { w, h } of SIZES) {
  for (const theme of w === 360 || w === 430 ? (['dark'] as const) : (['light', 'dark'] as const)) {
    test(`salida: mapa y perfil juntos a ${w}x${h} (${theme})`, async ({ page }) => {
      test.setTimeout(90000);
      await page.setViewportSize({ width: w, height: h });
      await prepare(page, theme);
      await page.goto('#/historial/s0');
      const hero = page.locator('.ride-hero');
      const prof = page.locator('.ride-prof');
      await expect(hero).toBeVisible();
      await expect(page.locator('.ride-stage .rmap .leaflet-overlay-pane svg').first()).toBeVisible({ timeout: 30000 });
      await expect(page.locator('.ride-prof .scrub-hit')).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20000 });
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('.toasts .toast')).toHaveCount(0, { timeout: 10000 });
      await page.waitForTimeout(300);

      // Sin desplazarse: el mapa y la franja entera del perfil (hasta la lectura) están en la pantalla.
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const vh = h;
      const mapBox = (await hero.boundingBox())!;
      const profBox = (await prof.boundingBox())!;
      expect(mapBox.y).toBeGreaterThanOrEqual(-1);
      expect(mapBox.height).toBeGreaterThan(200);
      expect(profBox.y + profBox.height, 'el perfil entero queda dentro de la pantalla').toBeLessThanOrEqual(vh - 1);
      for (const sel of ['.ride-prof .scrub', '.ride-prof .scrub-axis', '.ride-prof .scrub-bar']) {
        const b = (await page.locator(sel).boundingBox())!;
        expect(b.y, sel).toBeGreaterThanOrEqual(0);
        expect(b.y + b.height, sel).toBeLessThanOrEqual(vh);
      }
      if (w < 600) {
        const share = mapBox.height / vh;
        expect(share, 'el mapa ocupa entre el 40 y el 55 % del alto').toBeGreaterThan(0.4);
        expect(share).toBeLessThan(0.55);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

      // Recorrer el perfil mueve el punto del mapa.
      const hit = page.locator('.ride-prof .scrub-hit');
      const box = (await hit.boundingBox())!;
      const cursor = page.locator('.ride-stage .rmap-cur');
      await expect(cursor).toHaveCount(0);
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.7);
      await expect(cursor).toHaveCount(1);
      const a = (await cursor.boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7, { steps: 6 });
      await expect.poll(async () => {
        const b = (await cursor.boundingBox())!;
        return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      }).toBeGreaterThan(4);
      await expect(page.locator('.ride-prof .scrub-read')).toContainText('km');

      if ((w === 390 || w === 1440) && true) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: `${SHOTS}/${w}-${theme}-escenario.png` });
        await page.mouse.move(0, 0);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      // Hoja a pantalla completa: mapa y franja del perfil juntos, con el mismo cursor.
      await page.getByRole('button', { name: 'Ver el mapa a pantalla completa' }).click();
      const sheet = page.getByRole('dialog');
      await expect(sheet.locator('.rmap')).toBeVisible();
      const sheetHit = sheet.locator('.scrub-hit');
      await expect(sheetHit).toBeVisible();
      const sb = (await sheetHit.boundingBox())!;
      expect(sb.y + sb.height).toBeLessThanOrEqual(vh);
      await page.mouse.move(sb.x + sb.width * 0.5, sb.y + sb.height * 0.6);
      await expect(sheet.locator('.rmap-cur')).toHaveCount(1);
      if (w === 390 && theme === 'dark') await page.screenshot({ path: `${SHOTS}/${w}-${theme}-pantalla-completa.png` });
    });
  }
}

test('salida: sin GPS, sin perfil y estado de carga no dejan huecos', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 360, height: 780 });
  await prepare(page, 'light');
  // s1 no tiene GPS: sin escenario ni franja vacía.
  await page.goto('#/historial/s1');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.ride-stage')).toHaveCount(0);
  await expect(page.locator('.ride-prof')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/360-light-sin-gps.png` });
});

const LONG = 'Vuelta larguísima por el Montseny con Turó de l’Home, Santa Fe, Collformic y vuelta a casa por Collsuspina y Sant Celoni sin parar';

for (const { w, h, tag } of [
  { w: 360, h: 780, tag: 'movil' },
  { w: 844, h: 390, tag: 'apaisado' },
  { w: 1440, h: 900, tag: 'pc' },
]) {
  test(`salida: nombre larguísimo a ${w}x${h} no rompe el escenario`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: w, height: h });
    await prepare(page, 'dark', LONG);
    await page.goto('#/historial/s0');
    await expect(page.locator('.ride-stage .rmap .leaflet-overlay-pane svg').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator('.toasts .toast')).toHaveCount(0, { timeout: 10000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const prof = (await page.locator('.ride-prof').boundingBox())!;
    if (tag !== 'apaisado') expect(prof.y + prof.height).toBeLessThanOrEqual(h);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${w}-nombre-largo-${tag}.png` });
  });
}
