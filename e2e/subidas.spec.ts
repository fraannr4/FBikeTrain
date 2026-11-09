import { expect, test, type Page } from '@playwright/test';

// Subidas y Repetidas en el móvil, con datos sintéticos metidos en la base IndexedDB «ciclismo».
// Las salidas no traen track: el análisis no las toca y se usan las subidas y firmas sembradas.

const NOW = new Date('2026-11-06T12:00:00+01:00');
const DAY = 86_400_000;
const SHOTS = 'test-results/movil/subidas';

const UNBROKEN = 'Subidaconnombreinterminablesinespaciosniguionesquenoacabanuncajamas';
const LONG =
  'Vuelta larguísima por el Montseny con Turó de l’Home, Santa Fe, Collformic, Coll de Ravell, Sant Marçal y bajada por Viladrau hasta Seva y vuelta a casa por Collsuspina y Moià';

const ARABIC = 'رحلة الدراجة إلى الجبل';

type Seed = { activities: unknown[]; climbEfforts?: unknown[]; routeSigs?: unknown[] };

function ride(id: string, daysAgo: number, name: string) {
  return {
    id,
    startTime: NOW.getTime() - daysAgo * DAY,
    sport: 'cycling',
    name,
    totals: { distanceM: 40_000, movingTimeS: 6_000, elapsedTimeS: 6_500, elevGainM: 300, avgSpeedMs: 6.7, maxSpeedMs: 15 },
    hasTrack: false,
    source: 'gpx',
    importedAt: NOW.getTime(),
  };
}

function effort(activityId: string, activityStart: number, lat: number, timeS: number) {
  return {
    id: `${activityId}_0`,
    activityId,
    activityStart,
    startIdx: 0,
    endIdx: 100,
    start: { lat, lng: 2.2 },
    end: { lat: lat + 0.018, lng: 2.2 },
    startDistM: 12_000,
    lengthM: 2000,
    gainM: 100,
    avgGradePct: 5,
    timeS,
    avgSpeedMs: 2000 / timeS,
    vamMh: 100 / (timeS / 3600),
  };
}

/** Una subida con `passes` pasadas, una cada `every` días; la primera salida le da el nombre. */
function climb(key: string, lat: number, passes: number, name: string, every = 9) {
  const acts = Array.from({ length: passes }, (_, i) => ride(`${key}${i}`, 3 + (passes - 1 - i) * every, i === 0 ? name : 'Otra vez'));
  return { acts, efforts: acts.map((a, i) => effort(a.id, a.startTime, lat, 600 + (i % 7) * 15)) };
}

function climbsData(): Seed {
  const all = [
    climb('u', 41.0, 3, UNBROKEN),
    climb('l', 41.2, 40, LONG),
    climb('r', 45.8, 3, ARABIC),
    // 625 pasadas desde noviembre de 2022.
    climb('m', 46.0, 625, 'Puerto de todos los días', 2.34),
    ...Array.from({ length: 22 }, (_, i) => climb(`c${i}-`, 41.4 + i * 0.2, 2, `Puerto número ${i + 1}`)),
  ];
  return { activities: all.flatMap((c) => c.acts), climbEfforts: all.flatMap((c) => c.efforts) };
}

/** Abre la app para que Dexie cree la base, escribe los datos y recarga. */
async function seed(page: Page, data: Seed) {
  await page.goto('#/historial/subidas');
  await expect(page.getByText('Aún no hay subidas detectadas')).toBeVisible();
  await page.evaluate(async ({ activities, climbEfforts, routeSigs }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ciclismo');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['activities', 'climbEfforts', 'routeSigs'], 'readwrite');
    for (const a of activities) tx.objectStore('activities').put(a);
    for (const e of climbEfforts ?? []) tx.objectStore('climbEfforts').put(e);
    for (const s of routeSigs ?? []) tx.objectStore('routeSigs').put(s);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, data);
  await page.reload();
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

const openSheet = (page: Page) => page.locator('dialog.sheet[open]');

test.describe('Subidas en el móvil', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize({ width: 360, height: 780 });
    await seed(page, climbsData());
    await expect(page.getByRole('region', { name: 'Las que repites' })).toBeVisible({ timeout: 15_000 });
  });

  test('la hoja enseña entero un nombre sin espacios', async ({ page }) => {
    await page.getByLabel('Buscar subida').fill('interminable');
    await page.getByRole('button', { name: new RegExp(UNBROKEN) }).click();
    const title = openSheet(page).locator('.sheet-title');
    await expect(title).toBeVisible();
    const { scroll, client } = await title.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(scroll).toBeLessThanOrEqual(client);
    await page.waitForTimeout(400);
    for (const t of ['dark', 'light'] as const) {
      await setTheme(page, t);
      await page.screenshot({ path: `${SHOTS}/hoja-sinespacios-360x780-${t === 'dark' ? 'oscuro' : 'claro'}.png` });
    }
  });

  test('con la hoja desplazada, un título larguísimo ocupa tres líneas como mucho', async ({ page }) => {
    await page.getByLabel('Buscar subida').fill('Montseny');
    await page.getByRole('button', { name: /Montseny/ }).click();
    const sheet = openSheet(page);
    const title = sheet.locator('.sheet-title');
    await expect(title).toBeVisible();
    await page.waitForTimeout(400);
    const lineH = await title.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    // Alto del texto del título, sin su relleno.
    const textH = () =>
      title.evaluate((el) => {
        const cs = getComputedStyle(el);
        return el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      });
    expect(await textH()).toBeGreaterThan(lineH * 3.5); // arriba, entero

    await sheet.locator('.sheet-body').evaluate((el) => el.scrollTo(0, 300));
    await expect.poll(textH).toBeLessThanOrEqual(lineH * 3 + 1);
    await setTheme(page, 'light');
    await page.screenshot({ path: `${SHOTS}/hoja-titulo-largo-desplazada-360x780-claro.png` });

    await sheet.locator('.sheet-body').evaluate((el) => el.scrollTo(0, 0));
    await expect.poll(textH).toBeGreaterThan(lineH * 3.5);
  });

  test('Atrás cierra la hoja y deja la lista como estaba', async ({ page }) => {
    await page.getByLabel('Buscar subida').fill('Puerto número 1');
    await page.getByRole('button', { name: /Puerto número 12/ }).click();
    await expect(openSheet(page)).toBeVisible();
    await expect(page).toHaveURL(/#\/historial\/subidas\/.+/);

    await page.goBack();
    // La búsqueda va en la dirección: al cerrar la hoja sigue ahí.
    await expect(page).toHaveURL(/#\/historial\/subidas\?q=Puerto\+n%C3%BAmero\+1$/);
    await expect(openSheet(page)).toHaveCount(0);
    await expect(page.getByLabel('Buscar subida')).toHaveValue('Puerto número 1');
  });

  test('volver de una salida deja la lista en su sitio: orden, filas, desplazamiento y foco', async ({ page }) => {
    const rows = page.locator('#lista-subidas .row');
    await page.getByRole('button', { name: 'Más duras' }).click();
    await page.getByRole('button', { name: /^Ver \d+ más/ }).click();
    await expect(rows).toHaveCount(26);
    const row = rows.nth(24);
    await row.scrollIntoViewIfNeeded();
    const name = await row.locator('.row-title').innerText();
    const y0 = await page.evaluate(() => scrollY);
    expect(y0).toBeGreaterThan(500);

    await row.click();
    await openSheet(page).locator('#hs-lista a').first().click();
    await expect(page).toHaveURL(/#\/historial\/(?!subidas)[^/?]+$/);
    await page.goBack();
    await expect(openSheet(page)).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/#\/historial\/subidas\?/);
    await expect(openSheet(page)).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Más duras' })).toHaveAttribute('aria-pressed', 'true');
    await expect(rows).toHaveCount(26);
    await expect(rows.nth(24).locator('.row-title')).toHaveText(name);
    await expect(rows.nth(24)).toBeFocused();
    expect(Math.abs((await page.evaluate(() => scrollY)) - y0)).toBeLessThan(4);
    await page.screenshot({ path: `${SHOTS}/vuelta-de-salida-360x780-oscuro.png` });
  });

  test('«Ver más» lleva el foco a la primera fila nueva', async ({ page }) => {
    await page.getByRole('button', { name: /^Ver \d+ más/ }).click();
    await expect(page.locator('#lista-subidas .row').nth(20)).toBeFocused();
  });

  test('un nombre en árabe deja las comillas en su sitio', async ({ page }) => {
    await page.getByLabel('Buscar subida').fill('الجبل');
    await page.getByRole('button', { name: /الجبل/ }).click();
    await expect(openSheet(page).locator('.sheet-title')).toHaveText(`Subida del km 12 de «⁨${ARABIC}⁩»`);
    // La comilla de cierre queda a la derecha del nombre, en su misma línea.
    const pos = await openSheet(page)
      .locator('.sheet-title')
      .evaluate((el) => {
        const text = el.firstChild as Text;
        const rect = (from: number, to: number) => {
          const r = document.createRange();
          r.setStart(text, from);
          r.setEnd(text, to);
          return Array.from(r.getClientRects());
        };
        const n = text.length;
        const close = rect(n - 1, n)[0];
        const name = rect(n - 3, n - 2)[0]; // la última letra del nombre
        return { close: [close.left, close.top], name: [name.right, name.top] };
      });
    expect(pos.close[1]).toBeCloseTo(pos.name[1], 0);
    expect(pos.close[0]).toBeGreaterThan(pos.name[0]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/hoja-arabe-360x780-oscuro.png` });
  });

  test('625 pasadas: el eje de los meses marca cada año y la lista dice cuántas faltan', async ({ page }) => {
    await page.getByLabel('Buscar subida').fill('todos los días');
    await page.getByRole('button', { name: /todos los días/ }).click();
    const sheet = openSheet(page);
    await sheet.getByRole('button', { name: 'Todas, por meses' }).click();
    await expect(sheet.locator('.passes .xl text')).toHaveText(['2023', '2024', '2025', '2026']);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/hoja-meses-625-360x780-oscuro.png` });

    await sheet.getByRole('button', { name: 'Ver las 200 últimas, de 625' }).click();
    const left = sheet.getByText('Faltan las 425 pasadas más antiguas: la gráfica «Todas, por meses» las resume.');
    await left.scrollIntoViewIfNeeded();
    await expect(left).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/hoja-625-faltan-360x780-oscuro.png` });
  });

  test('la región viva de la búsqueda sigue en el árbol de accesibilidad cuando está vacía', async ({ page }) => {
    const results = page.locator('.subidas .results');
    await expect(results).toBeEmpty();
    await expect(results).not.toHaveCSS('display', 'none');
    await page.getByLabel('Buscar subida').fill('Puerto');
    await expect(page.getByRole('status').filter({ hasText: 'subidas con «Puerto»' })).toBeVisible();
  });
});

test('Repetidas: Atrás cierra la hoja', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize({ width: 360, height: 780 });
  const acts = [ride('a1', 60, 'Vuelta al pantano'), ride('a2', 30, 'Pantano otra vez'), ride('a3', 5, 'Pantano en otoño')];
  await seed(page, {
    activities: acts,
    // Firma ya analizada: las salidas no traen track y el análisis no las vuelve a mirar.
    routeSigs: acts.map((a) => ({
      activityId: a.id,
      activityStart: a.startTime,
      distanceM: a.totals.distanceM,
      cells: ['a:1', 'a:2', 'a:3', 'a:4', 'a:5'],
      analysisVersion: Number.MAX_SAFE_INTEGER,
    })),
  });
  await page.goto('#/historial/repetidas');
  await page.getByRole('region', { name: 'Tus rutas de siempre' }).getByRole('button', { name: /Pantano en otoño/ }).click();
  await expect(openSheet(page)).toBeVisible();
  await expect(page).toHaveURL(/#\/historial\/repetidas\/a1$/);

  await page.goBack();
  await expect(page).toHaveURL(/#\/historial\/repetidas$/);
  await expect(openSheet(page)).toHaveCount(0);
});
