import { expect, test, type Page } from '@playwright/test';

// Inicio en el móvil (auditoría, ronda 2): volver atrás sin perder el sitio, foco tras los datos de
// ejemplo, vacío en apaisado, cifras de la semana a la misma altura, texto bidireccional y la
// atribución del mapa. Datos sintéticos metidos en la base IndexedDB «ciclismo».

const NOW = new Date('2026-11-06T12:00:00+01:00'); // viernes
const DAY = 86_400_000;
const SHOTS = 'test-results/movil/inicio';

type Seed = { activities?: unknown[]; calendar?: unknown[] };

/** Abre la app para que Dexie cree la base, escribe los datos y recarga. */
async function seed(page: Page, data: Seed) {
  await page.goto('#/');
  await expect(page.getByText('Aún no hay salidas')).toBeVisible();
  await page.evaluate(async ({ activities = [], calendar = [] }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ciclismo');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['activities', 'calendar'], 'readwrite');
    for (const a of activities) tx.objectStore('activities').put(a);
    for (const w of calendar) tx.objectStore('calendar').put(w);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, data);
  await page.reload();
}

function ride(id: string, startTime: number, over: { distanceM?: number; elevGainM?: number; avgSpeedMs?: number } = {}) {
  const distanceM = over.distanceM ?? 60_000;
  const avgSpeedMs = over.avgSpeedMs ?? 7;
  const movingTimeS = Math.round(distanceM / avgSpeedMs);
  return {
    id,
    startTime,
    sport: 'cycling',
    name: `Salida ${id}`,
    totals: { distanceM, movingTimeS, elapsedTimeS: movingTimeS + 300, elevGainM: over.elevGainM ?? 800, avgSpeedMs, maxSpeedMs: 16 },
    hasTrack: false,
    source: 'gpx',
    importedAt: NOW.getTime(),
  };
}

/** Cuatro semanas anteriores con dos salidas cada una: hay referencia y diferencias en las cifras. */
const history = (elevGainM = 800) =>
  Array.from({ length: 8 }, (_, i) => ride(`h${i}`, NOW.getTime() - (8 + i * 3.5) * DAY, { elevGainM }));
const HISTORY = history();

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

test.describe('Inicio en el móvil', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await page.route(/tile-cyclosm/, (r) => r.abort());
  });

  test('datos de ejemplo con el teclado, volver de «Ver salida» a la misma altura y atribución del mapa', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('#/');

    await test.step('el foco va al título y se anuncia la carga', async () => {
      const demo = page.getByRole('button', { name: 'Ver con datos de ejemplo' });
      await demo.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('region', { name: 'Esta semana' })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeFocused();
      await expect(page.getByText('Datos de ejemplo cargados')).toBeAttached();
    });

    await test.step('la cifra de partida no lleva el borde de elegida', async () => {
      const dist = page.locator('.kpi').first();
      await expect(dist).toHaveAttribute('aria-pressed', 'true');
      await expect(dist).toHaveAttribute('data-quiet', '');
      await page.locator('.kpi').nth(1).click();
      await expect(page.locator('.kpi[aria-pressed="true"]')).not.toHaveAttribute('data-quiet', '');
    });

    await test.step('atribución con enlaces de 24 px y trazado oculto a los lectores', async () => {
      const attribution = page.locator('.lastride-map .leaflet-control-attribution');
      await expect(attribution).toBeVisible({ timeout: 15_000 });
      for (const link of await attribution.locator('a').all()) {
        const box = await link.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
      }
      await expect(page.locator('.lastride-map .leaflet-overlay-pane svg')).toHaveAttribute('aria-hidden', 'true');
      await page.locator('.lastride').scrollIntoViewIfNeeded();
      await page.locator('.lastride-map').screenshot({ path: `${SHOTS}/r2-atribucion-360-oscuro.png` });
    });

    await test.step('vuelve a la misma altura', async () => {
      await page.evaluate(() => document.querySelector('.lastride')?.scrollIntoView());
      const y0 = await page.evaluate(() => window.scrollY);
      expect(y0).toBeGreaterThan(600);
      await page.locator('.lastride').getByRole('link', { name: 'Ver salida' }).click();
      await expect(page).toHaveURL(/#\/historial\/[^/]+$/);
      await page.goBack();
      await expect(page.locator('.lastride')).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y0 - 40);
      expect(await page.evaluate(() => window.scrollY)).toBeLessThan(y0 + 40);
      await page.screenshot({ path: `${SHOTS}/r2-vuelta-360-oscuro.png` });
    });
  });

  test('vacío en apaisado: la frase y la nota del ejemplo se quedan', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('#/');
    await expect(page.getByText(/Aún no hay salidas\. Importa el archivo de Strava/)).toBeVisible();
    await expect(page.getByText(/Salidas inventadas para ver la app llena/)).toBeVisible();
    for (const t of ['light', 'dark'] as const) {
      await setTheme(page, t);
      await page.screenshot({ path: `${SHOTS}/vacio-844x390-${t === 'dark' ? 'oscuro' : 'claro'}.png` });
    }
  });

  for (const c of [
    // 11.810 m de desnivel en dos salidas (con «+64 %»): la cifra más ancha en 360 px.
    { width: 360, height: 780, elev: 3_000, week: [{ elevGainM: 5_905 }, { elevGainM: 5_905 }], name: 'desnivel-11810-360' },
    // 23,7 km/h: la que bajaba de línea a 1280 px.
    { width: 1280, height: 800, elev: 800, week: [{ avgSpeedMs: 23.7 / 3.6 }, { avgSpeedMs: 23.7 / 3.6 }], name: 'velocidad-1280' },
  ])
    test(`cifras de la semana en una línea y a la misma altura: ${c.name}`, async ({ page }) => {
      await page.setViewportSize({ width: c.width, height: c.height });
      await seed(page, {
        activities: [...history(c.elev), ...c.week.map((o, i) => ride(`w${i}`, NOW.getTime() - (i + 1) * DAY, o))],
      });
      await expect(page.locator('.kpi .delta')).toHaveCount(4);
      // La cifra encoge al medir: se espera a que no quede ninguna diferencia en una segunda línea.
      await expect
        .poll(() =>
          page.evaluate(() =>
            [...document.querySelectorAll('.kpi-row')].every((r) => {
              const [v, d] = [...r.children].map((e) => e.getBoundingClientRect());
              return d.top < v.bottom - 4;
            }),
          ),
        )
        .toBe(true);
      // La cifra encogida es un poco más baja, pero ninguna fila gana una línea.
      const rows = await page.evaluate(() => [...document.querySelectorAll('.kpi-row')].map((r) => r.getBoundingClientRect().height));
      expect(Math.max(...rows) - Math.min(...rows)).toBeLessThan(3);
      for (const t of ['dark', 'light'] as const) {
        await setTheme(page, t);
        await page.locator('.week').screenshot({ path: `${SHOTS}/r2-kpi-${c.name}-${t === 'dark' ? 'oscuro' : 'claro'}.png` });
      }
    });

  test('un nombre en árabe no arrastra la distancia al otro lado', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    const wo = (id: string, date: string, title: string, distanceM: number) => ({ id, date, title, distanceM, done: false, manual: true, createdAt: 1 });
    await seed(page, {
      activities: HISTORY,
      calendar: [
        wo('sab', '2026-11-07', 'Lluçanès por Prats', 86_000),
        wo('dom', '2026-11-08', '東京サイクリング 早朝ライド — رحلة الدراجة الصباحية', 55_000),
      ],
    });
    const foot = page.locator('.next .card-foot');
    await expect(foot).toHaveText('Y el domingo 8: 東京サイクリング 早朝ライド — رحلة الدراجة الصباحية, 55 km.');
    // La distancia se pinta a la derecha del nombre, no en medio.
    const order = await foot.evaluate((p) => {
      const range = document.createRange();
      const km = [...p.childNodes].find((n) => n.textContent?.includes('55 km'))!;
      range.selectNodeContents(km);
      const kmRect = range.getBoundingClientRect();
      // Lo que ocupa el nombre en la misma línea que la distancia.
      const sameLine = [...p.querySelector('bdi')!.getClientRects()].filter((r) => Math.abs(r.bottom - kmRect.bottom) < 4);
      return { kmLeft: kmRect.left, bdiRight: Math.max(...sameLine.map((r) => r.right), -Infinity) };
    });
    expect(order.kmLeft).toBeGreaterThanOrEqual(order.bdiRight - 1);
    await expect(page.locator('.next-title')).toHaveAttribute('dir', 'auto');
    await foot.scrollIntoViewIfNeeded();
    for (const t of ['dark', 'light'] as const) {
      await setTheme(page, t);
      await page.locator('.next').screenshot({ path: `${SHOTS}/r2-bidi-360-${t === 'dark' ? 'oscuro' : 'claro'}.png` });
    }
  });
});
