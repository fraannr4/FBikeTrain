import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from './accountFixture';
import { auditContrast, type ContrastReport } from './contrast';

// Datos del peor caso realista para Inicio e Importar (skill break-ui). Se meten por la
// misma frontera que los datos reales: la base IndexedDB «ciclismo» y el selector de ficheros.

const NOW = new Date('2026-11-06T12:00:00+01:00'); // viernes
const DAY = 86_400_000;

const LONG_RIDE_NAME =
  'Vuelta a Mallorca 312 — Port d’Andratx · Sóller · Puig Major · Lluc · Formentor y vuelta 🚴‍♀️🏔️ (con Aleksandra Wiśniewska-Kowalczyk)';
const OTHER_SCRIPTS = ['Утренний заезд по побережью', '東京サイクリング 早朝ライド', 'رحلة الدراجة الصباحية', 'Ζέστη ανάβαση στον Υμηττό'];
const LONG_DISPLAY_NAME = 'Maria-Antonieta de las Mercedes Fernández-Villaverde y Castellanos 🚲';

type Seed = {
  activities: unknown[];
  displayName?: string;
  lastImportAt?: number;
  tracks?: { activityId: string; points: unknown[] }[];
  settings?: Record<string, unknown>;
};

async function blockTiles(page: Page) {
  await page.route(/tile-cyclosm/, (r) => r.abort());
}

/** Abre la app para que Dexie cree la base, escribe los datos y recarga. */
async function seed(page: Page, data: Seed) {
  await page.goto('#/');
  await expect(page.getByText('Aún no hay salidas')).toBeVisible();
  await page.evaluate(async ({ activities, displayName, lastImportAt, tracks, settings }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ciclismo-user-00000000-0000-0000-0000-000000000011');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['activities', 'tracks', 'settings', 'meta'], 'readwrite');
    for (const a of activities) tx.objectStore('activities').put(a);
    for (const t of tracks ?? []) tx.objectStore('tracks').put(t);
    if (settings) tx.objectStore('settings').put({ key: 'app', value: settings });
    if (displayName !== undefined)
      tx.objectStore('settings').put({
        key: 'app',
        value: { displayName, home: null, ors: { apiKey: '' }, llm: { baseUrl: '', apiKey: '', model: '' } },
      });
    if (lastImportAt !== undefined) tx.objectStore('meta').put({ key: 'lastImportAt', value: lastImportAt });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, data);
  await page.reload();
}

function ride(i: number, startTime: number, over: Record<string, unknown> = {}) {
  const distanceM = 30_000 + (i % 7) * 10_000;
  const movingTimeS = distanceM / 7.5;
  return {
    id: `seed-${i}`,
    startTime,
    sport: 'cycling',
    name: i % 5 === 0 ? OTHER_SCRIPTS[i % OTHER_SCRIPTS.length] : `Salida ${i}`,
    totals: {
      distanceM,
      movingTimeS,
      elapsedTimeS: movingTimeS * 1.1,
      elevGainM: 300 + (i % 11) * 90,
      avgSpeedMs: 7.5,
      maxSpeedMs: 16,
    },
    hasTrack: false,
    source: 'strava-archive',
    importedAt: NOW.getTime(),
    ...over,
  };
}

/** 5.000 salidas repartidas en unos 4 años; la última es una de 400 km sin GPS. */
function fiveThousandRides() {
  const acts = Array.from({ length: 4999 }, (_, i) => ride(i, NOW.getTime() - 2 * DAY - i * 7 * 3_600_000));
  acts.push(
    ride(4999, NOW.getTime() - DAY, {
      name: LONG_RIDE_NAME,
      totals: {
        distanceM: 400_000,
        movingTimeS: 14 * 3600 + 25 * 60,
        elapsedTimeS: 17 * 3600,
        elevGainM: 5_870,
        avgSpeedMs: 400_000 / (14 * 3600 + 25 * 60),
        maxSpeedMs: 22,
        avgHr: 131.6,
        avgPower: 187.4,
      },
    }),
  );
  return acts;
}

async function expectNoHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, 'la página no debe tener scroll horizontal').toBeLessThanOrEqual(client);
}

const WIDTHS = [320, 1280];

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

test.describe('break-ui: Inicio', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await blockTiles(page);
  });

  test('0 salidas: invita a importar', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('#/');
    await expect(page.getByText('Aún no hay salidas')).toBeVisible();
    await page.getByRole('link', { name: 'Importar salidas' }).click();
    await expect(page).toHaveURL(/#\/importar$/);
    await expectNoHorizontalScroll(page);
  });

  test('5.000 salidas, la última de 400 km sin GPS y con nombre larguísimo', async ({ page }) => {
    await seed(page, { activities: fiveThousandRides(), displayName: LONG_DISPLAY_NAME, lastImportAt: NOW.getTime() - 9 * DAY });

    const week = page.getByRole('region', { name: 'Esta semana' });
    await expect(week).toBeVisible({ timeout: 10_000 });
    const kpi = (label: string) => week.locator('.kpi').filter({ hasText: label }).locator('.kpi-value');
    // La semana: 400 km + salidas sembradas desde el lunes. Cifras con separador de miles desde 10.000 y sin NaN.
    await expect(kpi('Distancia')).toHaveText(/^(\d{1,4}|\d{1,3}(\.\d{3})+) km$/);
    await expect(kpi('Desnivel')).toHaveText(/^(\d{1,4}|\d{1,3}(\.\d{3})+) m$/);
    await expect(kpi('En movimiento')).toHaveText(/^\d+ h \d{2}$/);
    await expect(week).not.toContainText('NaN');

    await expect(page.getByText(`Hola, ${LONG_DISPLAY_NAME}.`)).toBeVisible();
    await expect(page.getByText(/Importaste hace 9 días: toca traer las nuevas/)).toBeVisible();

    const last = page.getByRole('region', { name: 'Tu última salida' });
    await expect(last.getByText(LONG_RIDE_NAME)).toBeVisible();
    await expect(last).toContainText('400,0 km');
    await expect(last).toContainText('5870 m');
    await expect(last).toContainText('14 h 25');
    await expect(last).toContainText('Esta salida no tiene GPS, así que no tiene mapa.');
    await expect(last.getByRole('region', { name: 'Mapa de la última salida' })).toHaveCount(0);

    const trend = page.getByRole('region', { name: 'Tus últimas 12 semanas' });
    await expect(trend.getByRole('img', { name: /^Distancia por semana en las últimas 12 semanas/ })).toBeVisible();
    await trend.getByRole('button', { name: 'Ver tabla' }).click();
    await expect(trend.locator('.trend-table tbody tr')).toHaveCount(12);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `test-results/break-ui/inicio-5000-${width}.png`, fullPage: true });
    }

    await trend.getByRole('button', { name: 'Velocidad' }).click();
    await expect(trend.getByRole('img', { name: /^Velocidad media por semana/ })).toBeVisible();
  });

  // La tabla de la tendencia en «Tiempo» («15 h 26 min» y la nota «a estas alturas») es la más
  // ancha: a 320 px se desplaza dentro de `.trend-table-wrap`, no la página entera.
  test('tabla de la tendencia cabe en 320 px', async ({ page }) => {
    await seed(page, { activities: fiveThousandRides() });
    const trend = page.getByRole('region', { name: 'Tus últimas 12 semanas' });
    await trend.getByRole('button', { name: 'Tiempo' }).click();
    await trend.getByRole('button', { name: 'Ver tabla' }).click();
    await page.setViewportSize({ width: 320, height: 900 });
    await page.screenshot({ path: 'test-results/break-ui/inicio-tendencia-tabla-320.png', fullPage: true });
    await expectNoHorizontalScroll(page);
  });

  // Ejes y cifras de la tendencia en es-ES: nunca «2,000» ni NaN.
  test('ejes de la tendencia con formato es-ES', async ({ page }) => {
    await seed(page, { activities: fiveThousandRides() });
    const trend = page.getByRole('region', { name: 'Tus últimas 12 semanas' });
    await trend.getByRole('button', { name: 'Desnivel' }).click();
    const chart = trend.locator('.trend-chart');
    await expect(chart).toContainText('En curso');
    await expect(chart).not.toContainText(/\d,\d{3}/);
    await expect(chart).not.toContainText(/NaN|undefined|Infinity/);
  });

  test('nombre de usuario sin espacios (un correo) no desborda', async ({ page }) => {
    await seed(page, {
      activities: [ride(1, NOW.getTime() - DAY)],
      displayName: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
    });
    await expect(page.getByRole('region', { name: 'Esta semana' })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 640 });
    await expectNoHorizontalScroll(page);
  });

  test('5.000 salidas: Inicio se pinta en menos de 3 s', async ({ page }) => {
    await seed(page, { activities: fiveThousandRides() });
    const t0 = Date.now();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Esta semana' })).toBeVisible();
    expect(Date.now() - t0).toBeLessThan(3_000);
  });

  test('salida en otro alfabeto y sin nombre', async ({ page }) => {
    await seed(page, {
      activities: [
        ride(1, NOW.getTime() - 2 * DAY, { name: OTHER_SCRIPTS[2] }),
        ride(2, NOW.getTime() - DAY, { name: undefined }),
      ],
    });
    const last = page.getByRole('region', { name: 'Tu última salida' });
    await expect(last).toBeVisible();
    await expect(last.locator('.ride-name')).toHaveCount(0);
    await page.setViewportSize({ width: 320, height: 640 });
    await expectNoHorizontalScroll(page);
  });
});

test.describe('break-ui: Importar', () => {
  test('ficheros con nombres larguísimos, emojis y otros alfabetos en el informe', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('#/importar');
    const gpx = readFileSync(fileURLToPath(new URL('../tests/fixtures/ride.gpx', import.meta.url)));
    const junk = Buffer.from('no es un fichero de actividad');
    const longName = `${'2026-10-31_Vuelta_a_Mallorca_312_PortdAndratx_Soller_PuigMajor_Lluc_Formentor_'.repeat(3)}🚴‍♀️.fit`;
    await page.getByLabel('Elegir el ZIP o ficheros').setInputFiles([
      { name: 'ride.gpx', mimeType: 'application/gpx+xml', buffer: gpx },
      { name: longName, mimeType: 'application/octet-stream', buffer: junk },
      { name: 'Утренний заезд — 東京サイクリング.gpx', mimeType: 'application/gpx+xml', buffer: junk },
      { name: 'notas.txt', mimeType: 'text/plain', buffer: junk },
    ]);
    await expect(page.getByText('1 salida nueva')).toBeVisible();
    await expect(page.getByText('0 ya estaban')).toBeVisible();
    const skipped = page.locator('.file-name');
    await expect(skipped).toHaveCount(3);
    await expect(skipped.filter({ hasText: '東京サイクリング' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: 'test-results/break-ui/importar-320.png', fullPage: true });

    // Importar otra vez el mismo GPX: «1 ya estaba», en singular.
    await page.getByLabel('Elegir el ZIP o ficheros').setInputFiles([{ name: 'ride.gpx', mimeType: 'application/gpx+xml', buffer: gpx }]);
    await expect(page.getByText('0 salidas nuevas')).toBeVisible();
    await expect(page.getByText('1 ya estaba')).toBeVisible();
  });
});

// Casos extremos añadidos en la revisión de cierre del lote B (tarea 12, paso 4).

/** Track de 400 km a 15 m entre puntos (lo que deja `downsample`): unos 26.700 puntos. */
function track400km(start: number) {
  const n = Math.round(400_000 / 15);
  return Array.from({ length: n }, (_, i) => ({
    t: start + i * 2_000,
    lat: 39.55 + Math.sin(i / 4_000) * 0.4,
    lng: 2.6 + (i / n) * 0.9,
    ele: 50 + Math.abs(Math.sin(i / 900)) * 1_400,
    dist: i * 15,
  }));
}

test.describe('break-ui: Inicio (extremos añadidos)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await blockTiles(page);
  });

  test('última salida de 400 km con GPS (~26.700 puntos): mapa y perfil sin romper', async ({ page }) => {
    const start = NOW.getTime() - DAY;
    const big = ride(1, start, {
      name: LONG_RIDE_NAME,
      hasTrack: true,
      totals: { distanceM: 400_000, movingTimeS: 52_000, elapsedTimeS: 61_000, elevGainM: 5_870, avgSpeedMs: 7.69, maxSpeedMs: 22 },
    });
    await seed(page, { activities: [big], tracks: [{ activityId: big.id as string, points: track400km(start) }] });
    const last = page.getByRole('region', { name: 'Tu última salida' });
    await expect(last.getByRole('region', { name: 'Mapa de la última salida' })).toBeVisible({ timeout: 10_000 });
    await expect(last.getByRole('img', { name: /Perfil de altitud: mínima 50 m, máxima 1450 m/ })).toBeVisible();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `test-results/break-ui/inicio-400km-gps-${width}.png`, fullPage: true });
    }
  });

  test('contraste AA en oscuro y claro, con la atribución del mapa: el informe no tiene «contrast»', async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: 'reduce' }); // sin transiciones de color al cambiar de tema
    const start = NOW.getTime() - DAY;
    const last = ride(0, start, { name: 'Vuelta corta con GPS', hasTrack: true });
    const points = track400km(start).slice(0, 2_000);
    const others = Array.from({ length: 80 }, (_, i) => ride(i + 1, NOW.getTime() - (2 + i * 3) * DAY));
    await seed(page, { activities: [last, ...others], tracks: [{ activityId: last.id as string, points }] });
    await expect(page.getByRole('region', { name: 'Mapa de la última salida' })).toBeVisible({ timeout: 10_000 });
    const attribution = page.locator('.leaflet-control-attribution');
    await expect(attribution.getByRole('link', { name: 'CyclOSM' })).toBeVisible();
    await expect(attribution.getByRole('link', { name: 'colaboradores de OpenStreetMap' })).toBeVisible();

    const dir = 'test-results/movil/inicio';
    mkdirSync(dir, { recursive: true });
    const viewports = [[360, 780], [390, 844], [412, 915], [430, 932], [844, 390], [1280, 800]] as const;
    const report: (ContrastReport & { viewport: string; theme: string; ok: boolean })[] = [];
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme);
      for (const [width, height] of viewports) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(150);
        const r = await auditContrast(page);
        report.push({ viewport: `${width}x${height}`, theme: theme === 'dark' ? 'oscuro' : 'claro', ok: r.contrast.length === 0, ...r });
        if (width === 390) {
          await attribution.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${dir}/atribucion-390x844-${theme === 'dark' ? 'oscuro' : 'claro'}.png` });
        }
      }
    }
    writeFileSync(`${dir}/inicio-informe.json`, JSON.stringify(report, null, 2));
    for (const r of report) expect(r.contrast, `contraste en ${r.viewport} ${r.theme}`).toEqual([]);
    expect(report.every((r) => r.checked > 0)).toBe(true);
  });

  test('historial antiguo: nada en los últimos 12 meses ni esta semana', async ({ page }) => {
    const old = Array.from({ length: 50 }, (_, i) => ride(i, NOW.getTime() - 800 * DAY - i * DAY));
    await seed(page, { activities: old, lastImportAt: NOW.getTime() - 400 * DAY });
    const week = page.getByRole('region', { name: 'Esta semana' });
    await expect(week).toBeVisible();
    await expect(week).toContainText('Sin salidas');
    await expect(page.getByText(/Importaste hace 400 días: toca traer las nuevas/)).toBeVisible();
    await expect(page.getByRole('img', { name: /^Distancia por semana en las últimas 12 semanas: sin salidas\./ })).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/NaN|Infinity|undefined/);
  });

  test('salidas de rodillo sin distancia ni GPS: sin NaN ni Infinity', async ({ page }) => {
    const zero = { distanceM: 0, movingTimeS: 3_600, elapsedTimeS: 3_600, elevGainM: 0, avgSpeedMs: 0, maxSpeedMs: 0 };
    await seed(page, {
      activities: [
        ride(1, NOW.getTime() - 9 * DAY, { totals: zero }),
        ride(2, NOW.getTime() - DAY, { totals: zero, name: 'Rodillo 🔥🔥🔥' }),
      ],
    });
    // Una hora de rodillo sin distancia cuenta como salida (no cumple `isTooShort`).
    await expect(page.getByRole('region', { name: 'Esta semana' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Tu última salida' })).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/NaN|Infinity|undefined/);
  });

  test('texto al 200 % (tamaño de letra del sistema) no provoca scroll horizontal', async ({ page }) => {
    await seed(page, { activities: fiveThousandRides(), displayName: LONG_DISPLAY_NAME, lastImportAt: NOW.getTime() - 9 * DAY });
    await expect(page.getByRole('region', { name: 'Esta semana' })).toBeVisible({ timeout: 10_000 });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    for (const width of [640, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `test-results/break-ui/inicio-texto200-${width}.png`, fullPage: true });
    }
  });
});

test.describe('break-ui: Ajustes', () => {
  test('valores larguísimos sin espacios caben en 320 px y se guardan', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await seed(page, {
      activities: [],
      settings: {
        displayName: LONG_DISPLAY_NAME,
        home: null,
        ors: { apiKey: `5b3ce3597851110001cf6248${'a'.repeat(40)}` },
        llm: {
          baseUrl: 'https://my-very-long-openai-compatible-gateway.northwind-industries-holdings.example.com/api/openai/v1',
          apiKey: `gsk_${'x'.repeat(52)}`,
          model: 'meta-llama/llama-4-maverick-17b-128e-instruct-fp8-東京-🚴',
        },
      },
    });
    await page.goto('#/ajustes');
    await expect(page.getByLabel('Nombre')).toHaveValue(LONG_DISPLAY_NAME);
    await expectNoHorizontalScroll(page);
    // Cada cambio se guarda al salir del campo (prototipo-movil/ajustes.html).
    await page.getByText('Perfil', { exact: true }).click();
    await page.getByLabel('Nombre').fill(`${LONG_DISPLAY_NAME}x`);
    await page.getByLabel('Nombre').blur();
    await expect(page.getByText('Nombre guardado')).toBeVisible();
    await page.getByText('Claves de servicio', { exact: true }).click();
    await expectNoHorizontalScroll(page);
    await page.getByText('Copia de seguridad', { exact: true }).click();
    await page.getByRole('button', { name: 'Restaurar' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Restaurar' })).toBeInViewport();
    await page.screenshot({ path: 'test-results/break-ui/ajustes-320.png', fullPage: true });
  });
});

test.describe('break-ui: Importar (extremos añadidos)', () => {
  test('300 ficheros que no se pueden leer: informe completo y sin scroll horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('#/importar');
    const junk = Buffer.from('no es un fichero de actividad');
    const files = Array.from({ length: 300 }, (_, i) => ({
      name: `${String(i).padStart(4, '0')}_salida_${'muy_larga_'.repeat(6)}.gpx`,
      mimeType: 'application/gpx+xml',
      buffer: junk,
    }));
    await page.getByLabel('Elegir el ZIP o ficheros').setInputFiles(files);
    await expect(page.getByText('0 salidas nuevas')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.file-name')).toHaveCount(300);
    await expectNoHorizontalScroll(page);
    // El selector vuelve a estar disponible para otra importación.
    await expect(page.getByLabel('Elegir el ZIP o ficheros')).toBeEnabled();
  });
});
