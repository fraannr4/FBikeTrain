import { expect, test, type Page } from '@playwright/test';

// Historial y detalle de una salida en el móvil, con salidas sintéticas metidas en la base IndexedDB «ciclismo».
// jsdom no calcula el diseño: estas pruebas miden lo que el navegador pinta de verdad.

const NOW = new Date('2026-11-06T12:00:00+01:00');
const DAY = 86_400_000;
const SHOTS = 'test-results/movil/historial';

const NAMES = ['Vuelta al pantano', 'Collsuspina y Moià', 'Rodaje por la costa', 'Subida a Bracons', 'Rupit por Sant Hilari'];

function ride(id: string, daysAgo: number, name: string, km = 40, movingTimeS = 6_000) {
  const distanceM = km * 1000;
  return {
    id,
    startTime: NOW.getTime() - daysAgo * DAY,
    sport: 'cycling',
    name,
    totals: { distanceM, movingTimeS, elapsedTimeS: movingTimeS + 300, elevGainM: 650, avgSpeedMs: distanceM / movingTimeS, maxSpeedMs: 15 },
    hasTrack: false,
    source: 'gpx',
    importedAt: NOW.getTime(),
  };
}

const RIDES = [
  ...Array.from({ length: 20 }, (_, i) => ride(`h${i}`, 1 + i * 3, NAMES[i % NAMES.length], 35 + i * 4)),
  // 400 km en 14 h 25: 27,7 km/h.
  ride('larga', 70, 'Brevet de 400', 400, 51_900),
];

/** Abre la app para que Dexie cree la base, escribe las salidas y recarga. */
async function seed(page: Page, activities: unknown[]) {
  await page.goto('#/historial/subidas');
  await expect(page.getByText('Aún no hay subidas detectadas')).toBeVisible();
  await page.evaluate(async (acts) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ciclismo');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['activities'], 'readwrite');
    for (const a of acts) tx.objectStore('activities').put(a);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, activities);
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

test.describe('Historial en el móvil', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize({ width: 360, height: 780 });
    await seed(page, RIDES);
  });

  for (const width of [360, 390, 412, 430]) {
    test(`a ${width} px cada fila enseña el nombre de la salida`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('#/historial');
      const titles = page.locator('.rides .row-title');
      await expect(titles.first()).toBeVisible({ timeout: 15_000 });
      const widths = await titles.evaluateAll((els) => els.slice(0, 8).map((el) => el.getBoundingClientRect().width));
      for (const w of widths) expect(w).toBeGreaterThan(100);
      // Las cifras de la derecha no llevan las líneas de la ficha de la salida.
      const border = await page.locator('.rides .row-trail > *').first().evaluate((el) => getComputedStyle(el).borderTopWidth);
      expect(border).toBe('0px');
      for (const t of ['dark', 'light'] as const) {
        await setTheme(page, t);
        await page.screenshot({ path: `${SHOTS}/lista-${width}-${t === 'dark' ? 'oscuro' : 'claro'}.png` });
      }
    });
  }

  test('a 360 px las cuatro cifras de una salida de 400 km no se juntan', async ({ page }) => {
    await page.goto('#/historial/larga');
    const figs = page.getByRole('group', { name: 'Cifras de la salida' });
    await expect(figs).toContainText('14 h 25', { timeout: 15_000 });
    const gaps = await figs.locator('dd').evaluateAll((dds) => {
      const boxes = dds.map((dd) => {
        const r = document.createRange();
        r.selectNodeContents(dd);
        const b = r.getBoundingClientRect();
        return { left: b.left, right: b.right };
      });
      return boxes.slice(1).map((b, i) => b.left - boxes[i].right);
    });
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(10);
    // La unidad va en la línea de la cifra, como en el prototipo: «400,0 km», no «400,0» y debajo «km».
    const lines = await figs.locator('dd').evaluateAll((dds) =>
      dds.map((dd) => ({ text: dd.textContent, h: dd.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(dd).fontSize) })),
    );
    for (const l of lines) expect(l.h, l.text ?? '').toBeLessThan(l.fs * 1.5);
    for (const t of ['dark', 'light'] as const) {
      await setTheme(page, t);
      await page.screenshot({ path: `${SHOTS}/detalle-400km-360-${t === 'dark' ? 'oscuro' : 'claro'}.png` });
    }
  });

  // Auditoría móvil: al volver de una salida la lista debe quedar como se dejó.
  test('al volver de una salida se conservan los filtros de la hoja', async ({ page }) => {
    await page.goto('#/historial');
    await page.getByRole('button', { name: /^Filtrar y ordenar/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Menos de 50 km' }).click();
    await page.getByRole('dialog').locator('.btn--primary').click();
    const count = page.locator('.results-count');
    await expect(count).toContainText('de 21 salidas');
    const before = await count.innerText();
    await page.locator('main a.row').first().click();
    await expect(page).toHaveURL(/#\/historial\/[^/]+$/);
    await page.goBack();
    await expect(page.locator('main a.row').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('group', { name: 'Filtros aplicados' })).toContainText('Menos de 50 km');
    await expect(count).toHaveText(before);
  });

  test('al volver de una salida la lista vuelve a la misma altura', async ({ page }) => {
    await page.goto('#/historial');
    const rows = page.locator('main a.row');
    await expect(rows.nth(15)).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => window.scrollTo(0, 1200));
    const y0 = await page.evaluate(() => window.scrollY);
    expect(y0).toBeGreaterThan(1000);
    const idx = await page.evaluate(() => [...document.querySelectorAll('main a.row')].findIndex((r) => r.getBoundingClientRect().top > 150));
    // Los nombres se repiten: la fila abierta se reconoce por su enlace.
    const href = (await rows.nth(idx).getAttribute('href')) ?? '';
    await rows.nth(idx).click();
    await expect(page).toHaveURL(/#\/historial\/[^/]+$/);
    await page.getByRole('link', { name: /^Volver/ }).click();
    await expect(page).toHaveURL(/#\/historial$/);
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y0 - 200);
    const opened = page.locator(`main a.row[href="${href}"]`);
    await expect(opened).toBeInViewport();
    await expect(opened).toBeFocused();
  });
});
