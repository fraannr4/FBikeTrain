import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, TEST_DATABASE, AUTH_KEY, type Page } from './accountFixture';
import { auditContrast } from './contrast';
import { NOW, RIDES, seed, settings } from './seed';

const matrix = process.env.ESCRITORIO_CAPTURAS;
const phase = process.env.ESCRITORIO_FASE ?? 'despues';
const root = process.env.ESCRITORIO_DIRECTORIO ?? 'escritorio.local';
const routesOnly = process.env.ESCRITORIO_REPETIR_RUTAS === '1';
const only = process.env.ESCRITORIO_VISTAS?.split(',');
const widths = matrix === 'movil' ? [360, 390, 430] : matrix === 'pc' ? [1024, 1280, 1440, 1920] : [1280];
const ors = JSON.parse(readFileSync('tests/fixtures/ors/round-trip-ok.json', 'utf8'));
const plan = JSON.parse(readFileSync('tests/fixtures/llm/plan-ok.json', 'utf8'));
const options = JSON.parse(plan.choices[0].message.content);
for (const option of options.opciones) option.distanciaKm = 30;
plan.choices[0].message.content = JSON.stringify(options);

async function prepare(page: Page) {
  await page.clock.setFixedTime(NOW);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Sin red externa: sesión, carreteras, IA y teselas son sintéticos.
  await page.route(/tile-cyclosm/, r => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>' }));
  await page.route('https://api.heigit.org/openrouteservice/**', r => r.fulfill({ json: ors, headers: { 'access-control-allow-origin': '*' } }));
  let requests = 0;
  await page.route('**/chat/completions', r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    requests++;
    return r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: requests === 1 ? JSON.stringify(plan) : readFileSync('tests/fixtures/llm/explain-ok.json', 'utf8') });
  });
  await seed(page, { activities: [{ ...RIDES[0], hasTrack: true }, ...RIDES.slice(1)], settings: settings({ orsKey: 'synthetic-key', llmKey: 'synthetic-key' }) });
  await page.evaluate(async ({ database, coords, now }) => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open(database); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction(['tracks', 'goals', 'calendar'], 'readwrite');
    tx.objectStore('tracks').put({ activityId: 's0', points: coords.map((p: number[], i: number) => ({ lat: p[1], lng: p[0], ele: p[2] ?? 600, dist: i * 100, t: now + i * 15000 })) });
    tx.objectStore('goals').put({ id: 'desktop-goal', kind: 'volume', title: 'Fondo de noviembre', period: 'month', start: '2026-11-01', distanceM: 300000, createdAt: now });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  }, { database: TEST_DATABASE, coords: ors.features[0].geometry.coordinates, now: NOW.getTime() });
}

for (const width of widths) for (const theme of ['dark', 'light'] as const) {
  test(`escritorio ${width} ${theme}`, async ({ page, context }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: width < 1024 ? ({ 360: 780, 390: 844, 430: 932 }[width] ?? 844) : 800 });
    await prepare(page);
    await page.addInitScript(t => { localStorage.setItem('fbt-theme', t); document.documentElement.dataset.theme = t; }, theme);
    const folder = `${root}/${phase}/${width}-${theme}`;
    mkdirSync(folder, { recursive: true });
    const reports: Record<string, unknown> = existsSync(`${folder}/contraste.json`) ? JSON.parse(readFileSync(`${folder}/contraste.json`, 'utf8')) : {};
    const capture = async (name: string) => {
      await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
      await page.evaluate(() => document.fonts.ready);
      if (['inicio', 'salida'].includes(name) || (width >= 1024 && ['rutas-resultados', 'rutas-ia-resultados'].includes(name))) {
        await expect(page.locator('.rmap .leaflet-overlay-pane svg').first()).toBeVisible({ timeout: 30000 });
      }
      await expect(page.locator('.toasts .toast')).toHaveCount(0, { timeout: 10000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `${name}: sin desbordamiento horizontal` }).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${folder}/${name}.png`, fullPage: true, animations: 'disabled' });
      if (width >= 1024) {
        const report = await auditContrast(page, 4.5);
        reports[name] = report;
        writeFileSync(`${folder}/contraste.json`, JSON.stringify(reports, null, 2));
        expect(report.contrast, `${name}: texto con contraste 4,5:1`).toEqual([]);
      }
    };
    for (const [name, route, ready] of [
      ['inicio', '/', '.week'], ['historial', '/historial', '.months .row'], ['salida', '/historial/s0', '.ride-figs-wrap'],
      ['rutas', '/rutas', '.gen-inline'], ['rutas-ia', '/rutas/ia', '.opts'], ['plan', '/plan', '.desktop-month, .cal:visible'],
      ['ajustes', '/ajustes', '.settings'], ['mas', '/mas', '.page'], ['importar', '/importar', '.page'],
      ['objetivos', '/plan/objetivos', '.page'], ['subidas', '/historial/subidas', '.page'],
      ['repetidas', '/historial/repetidas', '.page'], ['biblioteca', '/rutas/biblioteca', '.page'], ['empalmar', '/rutas/empalmar', '.page'],
    ]) {
      if (only && !only.includes(name)) continue;
      if (matrix === 'pc' && !['inicio', 'historial', 'salida', 'rutas', 'rutas-ia', 'plan', 'ajustes'].includes(name)) continue;
      if (routesOnly && !['inicio', 'historial', 'salida', 'rutas', 'rutas-ia'].includes(name)) continue;
      await page.goto(`#${route}`);
      await expect(page.locator(ready).first()).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20000 });
      await capture(name);
      if (width >= 1280 && name === 'salida') {
        await expect(page.locator('.history-list .hist')).toBeVisible();
        await expect(page.locator('.history-workspace .ride-screen')).toBeVisible();
      }
    }
    if (!only) {
    if (!routesOnly) {
    await page.goto('#/historial');
    await page.getByRole('button', { name: 'Filtrar y ordenar' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture('hoja-filtros');
    if (width >= 1024 && phase !== 'antes') {
      const rect = await page.getByRole('dialog').boundingBox();
      expect(rect!.width).toBeLessThanOrEqual(560);
      expect(Math.abs(rect!.y + rect!.height / 2 - 400)).toBeLessThan(2);
    }
    await page.keyboard.press('Escape');
    }
    await page.goto('#/rutas');
    // El fixture ORS mide 30 km: la petición debe permitir aceptarlo.
    const distance = page.getByRole('group', { name: 'Distancia', exact: true });
    await distance.getByRole('button', { name: 'Menos distancia' }).focus();
    for (let i = 0; i < 40 && !/^30\s?km/.test((await distance.locator('output').innerText()).trim()); i++) await page.keyboard.press('Enter');
    await expect(distance.locator('output')).toContainText('30');
    await page.getByRole('button', { name: 'Generar 5 rutas' }).click();
    await expect(page.locator('.rutas-res .rcard').first()).toBeVisible({ timeout: 45000 });
    await expect(page.locator('.page--rutas[aria-busy="true"]')).toHaveCount(0);
    await capture('rutas-resultados');
    if (width >= 1024) {
      await expect(page.locator('.route-map-panel .rmap')).toBeVisible();
      expect((await page.locator('.route-map-panel .rmap').boundingBox())!.height).toBeGreaterThanOrEqual(480);
    }
    await page.goto('#/rutas/ia');
    for (const radio of [/^Fondo/, /^2 h/, /^Casa/, /^Repetir zona/]) await page.getByRole('radio', { name: radio }).click();
    await page.getByRole('button', { name: 'Pedir rutas a la IA' }).click();
    await expect(page.getByRole('region', { name: 'Propuestas', exact: true }).locator('.rcard').first()).toBeVisible({ timeout: 45000 });
    await expect(page.locator('.page--ia[aria-busy="true"]')).toHaveCount(0);
    await capture('rutas-ia-resultados');
    if (routesOnly) return;
    }
    if (only && !only.includes('login')) return;
    // Otra página sin el fixture de sesión: acceso real a la guardia, sin tocar auth/.
    const login = await context.newPage();
    await login.setViewportSize(page.viewportSize()!);
    await login.emulateMedia({ reducedMotion: 'reduce' });
    await login.route('https://*.supabase.co/**', route => route.abort());
    await login.goto('/');
    await login.evaluate(key => localStorage.removeItem(key), AUTH_KEY);
    await login.reload();
    await expect(login.locator('.account-card')).toBeVisible();
    await login.evaluate(t => document.documentElement.dataset.theme = t, theme);
    await login.evaluate(() => document.fonts.ready);
    expect(await login.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await login.screenshot({ path: `${folder}/login.png`, fullPage: true, animations: 'disabled' });
    if (width >= 1024) {
      const report = await auditContrast(login, 4.5);
      reports.login = report;
      expect(report.contrast).toEqual([]);
    }
    await login.close();
    writeFileSync(`${folder}/contraste.json`, JSON.stringify(reports, null, 2));
  });
}

if (!matrix) test('escritorio conserva la salida al pasar de paneles a móvil', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await prepare(page);
  await page.goto('#/historial/s0');
  await expect(page.locator('.history-list .hist')).toBeVisible();
  const map = page.getByRole('region', { name: 'Mapa de la salida', exact: true });
  await expect(map.locator('.leaflet-overlay-pane svg')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.history-list')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/historial\/s0$/);
  await expect(map).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('.history-list .hist')).toBeVisible();
  await expect.poll(async () => {
    const container = await map.boundingBox();
    const svgWidth = Number(await map.locator('.leaflet-overlay-pane svg').getAttribute('width'));
    return svgWidth >= (container?.width ?? Infinity);
  }).toBe(true);
  const home = page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Inicio', exact: true });
  await home.focus();
  await expect(home).toBeFocused();
  expect(await home.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
});

if (!matrix) for (const width of [1024, 1440, 1920]) for (const theme of ['light', 'dark'] as const) {
  test(`inicio a todo el ancho ${width} ${theme}: planificación, tabla y vacío`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 900 });
    await prepare(page);
    await page.addInitScript(t => { localStorage.setItem('fbt-theme', t); document.documentElement.dataset.theme = t; }, theme);
    const folder = `${root}/${phase}/inicio-estados`;
    mkdirSync(folder, { recursive: true });
    const noOverflow = async () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    const balanced = async () => {
      await expect.poll(async () => {
        const map = await page.locator('.lastride').boundingBox();
        const chart = await page.locator('.trend').boundingBox();
        return Math.abs(map!.y - chart!.y) + Math.abs(map!.height - chart!.height);
      }).toBeLessThan(2);
    };
    await page.goto('#/');
    await expect(page.locator('.lastride .leaflet-overlay-pane svg')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(async () => {
      const hero = await page.locator('.hero').boundingBox();
      const home = await page.locator('.home').boundingBox();
      return Math.abs(hero!.x - home!.x) + Math.abs(hero!.width - home!.width);
    }).toBeLessThan(2);
    const kpis = await page.locator('.kpis > li').evaluateAll(items => items.map(item => item.getBoundingClientRect().top));
    expect(new Set(kpis).size).toBe(1);
    await expect(page.locator('.duo > .week-cap')).toBeVisible();
    await expect(page.locator('.hero .week-cap')).toHaveCount(0);
    await expect(page.locator('.summit-lbl.on')).toBeVisible();
    await balanced();
    await noOverflow();
    await page.screenshot({ path: `${folder}/${width}-${theme}-con-datos.png`, fullPage: true, animations: 'disabled' });

    // La tabla debe aumentar la tarjeta y seguir siendo accesible sin recortarse.
    await page.getByRole('button', { name: 'Ver tabla' }).click();
    await expect(page.locator('.trend-table tbody tr')).toHaveCount(12);
    await expect(page.locator('.trend-table tbody tr').last()).toBeVisible();
    await balanced();
    await noOverflow();
    await page.getByRole('button', { name: 'Ocultar tabla' }).click();

    await page.evaluate(async ({ database, now }) => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open(database); r.onsuccess = () => resolve(r.result); });
      const tx = db.transaction(['calendar', 'goals'], 'readwrite');
      tx.objectStore('calendar').put({ id: 'desktop-next', date: '2026-11-07', title: 'Entreno sintético con un nombre largo para comprobar el reparto del escritorio', distanceM: 80000, elevGainM: 1200, notes: 'Sesión de ejemplo para comprobar que las acciones y las notas no se recortan.', done: false, manual: true, createdAt: now });
      tx.objectStore('calendar').put({ id: 'desktop-after', date: '2026-11-08', title: 'Segundo entreno de ejemplo', done: false, manual: true, createdAt: now });
      tx.objectStore('goals').put({ id: 'desktop-event', kind: 'event', title: 'Evento sintético', date: '2026-12-01', distanceM: 100000, createdAt: now });
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close();
    }, { database: TEST_DATABASE, now: NOW.getTime() });
    await page.reload();
    await expect(page.locator('.next-title')).toContainText('Entreno sintético');
    await expect(page.locator('.goal-event')).toBeVisible();
    await expect(page.locator('.summit-lbl.on')).toBeVisible();
    await expect(page.locator('.next-actions').getByRole('link', { name: 'Ruta y GPX' })).toBeVisible();
    await balanced();
    await noOverflow();
    await page.screenshot({ path: `${folder}/${width}-${theme}-planificado.png`, fullPage: true, animations: 'disabled' });

    await page.evaluate(async database => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open(database); r.onsuccess = () => resolve(r.result); });
      const stores = ['activities', 'tracks', 'calendar', 'goals'];
      const tx = db.transaction(stores, 'readwrite');
      for (const store of stores) tx.objectStore(store).clear();
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close();
    }, TEST_DATABASE);
    await page.reload();
    await expect(page.locator('.hero-empty')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver con datos de ejemplo' })).toBeVisible();
    await expect(page.locator('.kpis, .duo, .lastride, .trend')).toHaveCount(0);
    await noOverflow();
    const empty = await page.locator('.hero-empty').boundingBox();
    const home = await page.locator('.home').boundingBox();
    expect(Math.abs(empty!.width - home!.width)).toBeLessThan(2);
    const contrast = await auditContrast(page, 4.5);
    expect(contrast.contrast).toEqual([]);
    await page.screenshot({ path: `${folder}/${width}-${theme}-vacio.png`, fullPage: true, animations: 'disabled' });
  });
}
