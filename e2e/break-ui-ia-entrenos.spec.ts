import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from './accountFixture';
import { NOW, ride, RIDES, seed, settings } from './seed';

// Peor caso realista (skill break-ui) para «Proponer semana con IA»: la respuesta del proveedor
// simulado entra por la misma frontera que la real (/chat/completions) y los entrenos ocupados, por
// el almacén «calendar» de IndexedDB.

const SHOTS = process.env.BREAK_UI_SHOTS ?? 'test-results/break-ui-ia-entrenos';
const CORS = { 'access-control-allow-origin': '*' };
const DB = 'ciclismo-user-00000000-0000-0000-0000-000000000011';

// Títulos de 60 (máximo del esquema), con emojis y otros alfabetos; notas de 200 y motivo de 300.
const T60 = 'Vuelta a Mallorca: Sóller, Puig Major, Lluc, Formentor 🚴‍♀️'; // 60 unidades UTF-16
const NOTES200 = 'Come cada 45 minutos y bebe aunque no tengas sed; en el Puig Major sube a ritmo y no te cebes en las rampas del 9 %. Al bajar, abrígate: arriba hace frío y el viento del norte no perdona nunca.';
// El esquema mide en unidades UTF-16: 300 justas.
const MOTIVO300 =
  'Tu media es de 45 km y 600 m. Reparto la carga en siete días: rodajes suaves entre medias, un día de subidas y una salida larga el fin de semana para preparar la marcha. Si notas cansancio acumulado, cambia cualquier rodaje por descanso; lo importante es llegar fresco al objetivo dentro de dos semanas y no antes.'.slice(0, 300);
const TITLES = [
  T60,
  'Утренний заезд по побережью — интервалы 4×8 мин',
  '東京サイクリング 早朝ライド',
  'رحلة الدراجة الصباحية الطويلة',
  'Ζέστη ανάβαση στον Υμηττό',
  'Jo',
  'Bartholomew-Fitzgerald-Northwind-Industries-Holdings-Climb',
];

function completion(content: unknown) {
  return JSON.stringify({ object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: 'stop' }] });
}

async function mockAi(page: Page, content: unknown) {
  await page.route('**/chat/completions', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: completion(content) });
  });
}

async function seedCalendar(page: Page, rows: unknown[]) {
  await page.evaluate(
    async ({ db: name, rows }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction(['calendar'], 'readwrite');
      for (const w of rows) tx.objectStore('calendar').put(w);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { db: DB, rows },
  );
  await page.reload();
}

const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.beforeEach(async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true });
  await page.clock.setFixedTime(NOW);
});

for (const width of [320, 360, 430]) {
  test(`worst-case week at ${width}px stays usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await mockAi(page, {
      entrenos: TITLES.map((titulo, dia) => ({ dia, titulo, distanciaKm: dia === 6 ? 300 : 40 + dia, desnivelM: dia === 3 ? null : 5000, notas: NOTES200 })),
      motivo: MOTIVO300,
    });
    // Incluye una salida de 400 km en la ventana de referencia.
    await seed(page, { activities: [...RIDES, ride('ultra', 3, 'Madrid-Gijón-Madrid 🌙', 400)], settings: settings({ llmKey: 'k' }) });
    await page.goto('#/plan');

    await page.getByRole('button', { name: 'Proponer semana con IA' }).click();
    const sheet = page.getByRole('dialog', { name: 'Proponer semana con IA' });
    await expect(sheet).toBeVisible();

    // Siete pastillas de día en una fila: ninguna desborda su caja.
    const chips = await sheet.locator('.aiw-chip').evaluateAll((els) =>
      els.map((e) => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, over: e.scrollWidth > e.clientWidth + 1 })),
    );
    expect(chips).toHaveLength(7);
    for (const c of chips) expect(c.over).toBe(false);
    await page.screenshot({ path: `${SHOTS}/form-${width}.png` });

    await sheet.getByRole('button', { name: 'Proponer' }).click();
    const boxes = sheet.getByRole('checkbox');
    await expect(boxes.first()).toBeChecked({ timeout: 20_000 });
    const n = await boxes.count();
    expect(n).toBeGreaterThan(0);
    expect(await noHScroll(page)).toBe(true);

    // Cada entreno se ve entero dentro de la hoja y se puede desmarcar.
    for (let i = 0; i < n; i++) {
      const item = sheet.locator('.aiw-item').nth(i);
      await item.scrollIntoViewIfNeeded();
      const over = await item.evaluate((e) => e.scrollWidth > e.clientWidth + 1);
      expect(over).toBe(false);
    }
    await page.screenshot({ path: `${SHOTS}/result-${width}.png`, fullPage: false });

    // El botón del pie sigue a la vista y alcanzable.
    const add = sheet.getByRole('button', { name: /^Añadir al calendario \(\d\)$/ });
    await expect(add).toBeInViewport();
    await add.click();
    await expect(sheet).toBeHidden();
    expect(await noHScroll(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/calendar-${width}.png`, fullPage: true });
  });
}

test('all seven days busy: the sheet explains it and nothing is sent', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  let calls = 0;
  await page.route('**/chat/completions', (r) => {
    calls++;
    return r.abort();
  });
  await seed(page, { activities: RIDES, settings: settings({ llmKey: 'k' }) });
  const days = Array.from({ length: 7 }, (_, i) => new Date(NOW.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  await seedCalendar(
    page,
    days.map((date, i) => ({ id: `busy${i}`, date, title: `Ocupado ${i}`, done: false, manual: true, createdAt: NOW.getTime() })),
  );
  await page.goto('#/plan');
  await page.getByRole('button', { name: 'Proponer semana con IA' }).click();
  const sheet = page.getByRole('dialog', { name: 'Proponer semana con IA' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.aiw-chip:disabled')).toHaveCount(7);
  await page.screenshot({ path: `${SHOTS}/all-busy-360.png` });
  // Sin días libres no hay nada que proponer: se explica y «Proponer» queda desactivado.
  await expect(sheet.getByText(/Ya tienes entreno los 7 próximos días/)).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Proponer' })).toBeDisabled();
  expect(calls).toBe(0);
});
