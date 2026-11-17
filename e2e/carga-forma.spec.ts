import { expect, test, type Page } from './accountFixture';

// «Carga y forma» en Inicio y «Tu forma» en Ajustes, con salidas sintéticas en la base IndexedDB de la cuenta de prueba.

const NOW = new Date('2026-11-06T12:00:00+01:00'); // viernes
const DAY = 86_400_000;
const SHOTS = 'docs/design/2026-11-17-carga-forma';

type Sensors = { power?: boolean; hr?: boolean };

/** Salida con o sin sensores. El track (si lo hay) son 330 puntos cada 4 s: 22 min con potencia y pulso variables. */
function ride(i: number, daysAgo: number, sensors: Sensors) {
  const id = `c${i}`;
  const startTime = NOW.getTime() - daysAgo * DAY - 3 * 3_600_000;
  const movingTimeS = 4_800 + (i % 4) * 900;
  const totals: Record<string, number> = {
    distanceM: 40_000 + (i % 5) * 6_000,
    movingTimeS,
    elapsedTimeS: movingTimeS + 300,
    elevGainM: 300 + (i % 4) * 250,
    avgSpeedMs: 7.5,
    maxSpeedMs: 15,
  };
  if (sensors.power) totals.avgPower = 170 + (i % 5) * 12;
  if (sensors.hr) totals.avgHr = 128 + (i % 5) * 6;
  const points = Array.from({ length: 330 }, (_, k) => ({
    t: startTime + k * 4000,
    lat: 40.4 + k * 0.0001,
    lng: -3.7,
    ...(sensors.power ? { power: Math.round(205 + 35 * Math.sin(k / 9) + (i % 3) * 8) } : {}),
    ...(sensors.hr ? { hr: Math.round(140 + 20 * Math.sin(k / 30) + (i % 4) * 3) } : {}),
  }));
  const activity = { id, startTime, sport: 'cycling', name: `Salida ${i}`, totals, hasTrack: true, source: 'fit', importedAt: NOW.getTime() };
  return { activity, track: { activityId: id, points } };
}

/** Los avisos de la cuenta de prueba (red de la nube cortada a propósito) no pertenecen a las capturas. */
const hideToasts = (page: Page) => page.addStyleTag({ content: '.toasts { display: none !important; }' });

/** 12 semanas, tres salidas por semana (la última, esta semana). */
function history(sensors: Sensors) {
  const days = Array.from({ length: 12 }, (_, w) => [w * 7 + 1, w * 7 + 3, w * 7 + 5]).flat();
  return days.map((d, i) => ride(i, d, sensors));
}

async function seed(page: Page, rides: ReturnType<typeof history>, thresholds?: unknown) {
  await page.goto('#/ajustes');
  await expect(page.getByRole('heading', { name: 'Ajustes' }).first()).toBeVisible();
  await page.evaluate(
    async ({ rows, thresholds }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('ciclismo-user-00000000-0000-0000-0000-000000000011');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction(['activities', 'tracks', 'settings'], 'readwrite');
      for (const r of rows) {
        tx.objectStore('activities').put(r.activity);
        tx.objectStore('tracks').put(r.track);
      }
      tx.objectStore('settings').put({
        key: 'app',
        value: {
          displayName: 'Test',
          home: null,
          ors: { apiKey: '' },
          llm: { baseUrl: 'https://api.groq.com/openai/v1', apiKey: '', model: '' },
          ...(thresholds ? { thresholds } : {}),
        },
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { rows: rides, thresholds },
  );
  await page.goto('#/');
  await page.reload();
}

const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe('Carga y forma', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await page.route(/tile-cyclosm/, (r) => r.abort());
  });

  for (const [width, height] of [[360, 780], [1440, 900]] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`con potencia y FTP, a ${width} px en ${theme === 'light' ? 'claro' : 'oscuro'}`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.addInitScript((t) => localStorage.setItem('fbt-theme', t), theme);
        await page.setViewportSize({ width, height });
        await seed(page, history({ power: true, hr: true }), { ftpW: 220, maxHr: 188, thresholdHr: null });

        const card = page.getByTestId('load-card');
        await expect(card.getByRole('heading', { name: 'Carga y forma' })).toBeVisible({ timeout: 30_000 });
        await expect(card.locator('.load-week-fig .fig')).toBeVisible();
        await expect(card.getByText(/Llevas el \d+ % de tu carga semanal habitual/)).toBeVisible();
        await expect(card.locator('svg.load-chart')).toBeVisible();
        for (const name of ['Fitness', 'Fatiga', 'Forma']) await expect(card.locator('dt', { hasText: name })).toBeVisible();
        await card.scrollIntoViewIfNeeded();

        // Elegir un día cambia la frase.
        const read = card.locator('.load-read');
        await expect(read).toContainText('Hoy');
        await card.getByRole('button', { name: 'Día anterior' }).click();
        await expect(read).not.toContainText('Hoy');

        // Tabla equivalente.
        await card.getByRole('button', { name: 'Ver tabla' }).click();
        await expect(card.locator('table.trend-table tbody tr')).toHaveCount(12);
        await card.getByRole('button', { name: 'Ocultar tabla' }).click();

        expect(await overflowX(page)).toBeLessThanOrEqual(0);
        await hideToasts(page);
        await card.screenshot({ path: `${SHOTS}/carga-${width}-${theme === 'light' ? 'claro' : 'oscuro'}.png` });
      });
    }
  }

  test('sin pulso ni potencia: estado vacío honesto', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await seed(page, history({}), { ftpW: 220, maxHr: 188, thresholdHr: null });
    const card = page.getByTestId('load-card');
    await expect(card.getByText('Tus salidas no traen pulso ni potencia')).toBeVisible({ timeout: 30_000 });
    await expect(card.locator('svg.load-chart')).toHaveCount(0);
    await card.scrollIntoViewIfNeeded();
    await hideToasts(page);
    await card.screenshot({ path: `${SHOTS}/vacio-360-oscuro.png` });
  });

  test('con sensores pero sin umbrales: pide el dato y lleva a Ajustes', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await seed(page, history({ power: true }));
    const card = page.getByTestId('load-card');
    await expect(card.getByText('Indica tu FTP en Ajustes')).toBeVisible({ timeout: 30_000 });
    await card.getByRole('link', { name: 'Indicar mis umbrales' }).click();
    await expect(page.locator('#umbrales')).toHaveAttribute('open', '');
  });
});

test.describe('Ajustes: tu forma', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
  });

  test('estimar con las salidas rotula la cifra como estimada, se puede editar y se guarda', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 360, height: 780 });
    await seed(page, history({ power: true, hr: true }));
    await page.goto('#/ajustes?abrir=umbrales');
    const section = page.locator('#umbrales');
    await expect(section).toHaveAttribute('open', '');
    await section.getByRole('button', { name: 'Estimar con mis salidas' }).click();
    await expect(section.getByText(/FTP estimado: \d+ W/)).toBeVisible({ timeout: 20_000 });
    await expect(section.getByLabel('FTP')).toHaveValue(/^\d+$/);
    await expect(section.getByLabel('Pulso máximo')).toHaveValue(/^\d+$/);
    await expect(section.getByText('Estimado desde tus salidas').first()).toBeVisible();

    // Editar a mano quita la marca de estimado.
    await section.getByLabel('FTP').fill('250');
    await section.getByLabel('FTP').blur();
    await expect(section.getByText('Estimado desde tus salidas')).toHaveCount(1);

    // Valor fuera de rango: error en el campo y nada guardado.
    await section.getByLabel('Pulso máximo').fill('400');
    await section.getByLabel('Pulso máximo').blur();
    await expect(section.getByText(/Debe estar entre/)).toBeVisible();

    await section.scrollIntoViewIfNeeded();
    await hideToasts(page);
    await section.screenshot({ path: `${SHOTS}/ajustes-360-oscuro.png` });

    await page.reload();
    await expect(page.locator('#umbrales').getByLabel('FTP')).toHaveValue('250');
  });
});
