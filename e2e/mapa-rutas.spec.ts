import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, TEST_DATABASE, type Page } from './accountFixture';
import { NOW, RIDES, seed, settings } from './seed';

// Geometría inventada trasladada a una zona pública; nunca un track de una persona.
const original = JSON.parse(readFileSync('tests/fixtures/ors/round-trip-ok.json', 'utf8'));
const phase = process.env.MAPA_FASE ?? 'despues';
const root = `mapa-rutas.local/${phase}`;
const realTiles = process.env.MAPA_CAPTURAS === '1';
const coords = (variant = 0): number[][] => original.features[0].geometry.coordinates.map(([lng, lat, ele]: number[]) =>
  [2.163 + (lat - 40.4168) * 1.3 * (variant ? -1 : 1), 41.634 - (lng + 3.7038) / 1.3, 600 + (ele - 600) * (variant + 1)]);

async function prepare(page: Page) {
  let calls = 0;
  await page.clock.setFixedTime(NOW);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (!realTiles) await page.route(/tile-cyclosm/, r => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path d="M0 0L256 256M0 120H256" stroke="#6574ab" stroke-width="4"/></svg>' }));
  await page.route('https://api.heigit.org/openrouteservice/**', r => {
    const body = structuredClone(original);
    const variant = calls++ % 2;
    body.features[0].geometry.coordinates = coords(variant);
    return r.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
  });
  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'synthetic-key', llmKey: 'synthetic-key', home: { lat: 41.634, lng: 2.163 } }) });
  await page.goto('#/rutas');
  const dist = page.getByRole('group', { name: 'Distancia', exact: true });
  await dist.getByRole('button', { name: 'Menos distancia' }).focus();
  for (let i = 0; i < 40 && !/^30\s?km/.test((await dist.locator('output').innerText()).trim()); i++) await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Generar 5 rutas' }).click();
  await expect(page.locator('.rutas-res .rcard').first()).toBeVisible({ timeout: 30000 });
}

async function fitReport(page: Page) {
  return page.locator('.rmap:visible').first().evaluate(node => {
    const box = node.getBoundingClientRect();
    const path = node.querySelector<SVGPathElement>('.rmap-core')!;
    const line = path.getBoundingClientRect();
    return { map: { x: box.x, y: box.y, w: box.width, h: box.height },
      line: { x: line.x, y: line.y, w: line.width, h: line.height },
      contained: line.left >= box.left + 12 && line.right <= box.right - 12 && line.top >= box.top + 12 && line.bottom <= box.bottom - 12,
      inWindow: box.top >= 0 && box.bottom <= innerHeight,
      overflow: getComputedStyle(node).overflow };
  });
}

test('mapa: capturas primero 390 y después 1440, cambio de ruta y tamaño', async ({ page }) => {
  test.setTimeout(150000);
  mkdirSync(root, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.getByRole('button', { name: /Ver.*mapa|Abrir.*mapa/i }).first().click();
  await expect(page.locator('.rmap:visible .rmap-core')).toBeVisible();
  const reports: Record<string, unknown> = {};
  for (const width of [390, 1440]) {
    if (width === 1440) {
      await page.getByRole('button', { name: 'Cerrar el mapa' }).click();
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('.route-map-panel .rmap-core')).toBeVisible();
    }
    for (const theme of ['light', 'dark']) {
      await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
      if (phase === 'antes' && theme === 'light') {
        await expect(page.locator('.rmap:visible .rmap-core')).toHaveCSS('stroke', 'rgb(36, 101, 213)');
      }
      await expect.poll(() => page.locator('.rmap:visible .leaflet-tile-loaded').count(), { timeout: 45000 }).toBeGreaterThan(0);
      await page.waitForTimeout(600);
      reports[`${width}-${theme}`] = await fitReport(page);
      await page.screenshot({ path: `${root}/${width}-${theme}.png` });
    }
  }
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.waitForTimeout(400);
  reports.change = await fitReport(page);
  await expect.poll(() => page.locator('.rmap:visible .leaflet-tile-loaded').count(), { timeout: 45000 }).toBeGreaterThan(0);
  await page.screenshot({ path: `${root}/1440-cambio-dark.png` });
  await page.setViewportSize({ width: 1100, height: 740 });
  await page.waitForTimeout(400);
  reports.resize = await fitReport(page);
  if (phase !== 'antes') {
    await page.getByRole('button', { name: 'Acercar', exact: true }).click();
    await page.getByRole('button', { name: 'Encuadrar ruta' }).click();
    await expect.poll(() => fitReport(page)).toMatchObject({ contained: true });
    const style = await page.locator('.rmap:visible .rmap-thread').evaluate(n => ({ stroke: getComputedStyle(n).stroke, opacity: getComputedStyle(n).strokeOpacity }));
    expect(style).toMatchObject({ stroke: 'rgb(255, 135, 86)', opacity: '1' });
  }
  await page.emulateMedia({ forcedColors: 'active' });
  if (phase !== 'antes') {
    const style = await page.locator('.rmap:visible .rmap-halo').evaluate(n => ({ adjust: getComputedStyle(n).forcedColorAdjust, opacity: getComputedStyle(n).strokeOpacity }));
    expect(style).toEqual({ adjust: 'none', opacity: '1' });
  }
  await page.screenshot({ path: `${root}/forced-colors.png` });
  writeFileSync(`${root}/encuadre.json`, JSON.stringify(reports, null, 2));
  for (const report of Object.values(reports)) expect(report).toMatchObject({ contained: true });
  if (phase !== 'antes') for (const report of Object.values(reports)) expect(report).toMatchObject({ inWindow: true });
});

test('mapa compartido: IA, Empalmar, Salida e Inicio, primero móvil', async ({ page }) => {
  test.setTimeout(180000);
  mkdirSync(root, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  const plan = JSON.parse(readFileSync('tests/fixtures/llm/plan-ok.json', 'utf8'));
  const content = JSON.parse(plan.choices[0].message.content);
  for (const p of content.opciones) p.distanciaKm = 30;
  plan.choices[0].message.content = JSON.stringify(content);
  let chat = 0;
  await page.route('**/chat/completions', r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    return r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: chat++ === 0 ? JSON.stringify(plan) : readFileSync('tests/fixtures/llm/explain-ok.json', 'utf8') });
  });
  await page.evaluate(async ({ database, coords, ride }) => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open(database); req.onsuccess = () => resolve(req.result); });
    const tx = db.transaction(['activities', 'tracks', 'referenceRoutes'], 'readwrite');
    tx.objectStore('activities').put({ ...ride, hasTrack: true });
    const points = coords.map(([lng, lat, ele], i) => ({ lng, lat, ele, t: ride.startTime + i * 60000 }));
    tx.objectStore('tracks').put({ activityId: ride.id, points });
    for (const [id, part] of [['a', points.slice(0, 30)], ['b', points.slice(31)]] as const) {
      tx.objectStore('referenceRoutes').put({ id, name: `Arco sintético ${id}`, format: 'gpx', sourceFileName: `${id}.gpx`, originalXml: '<gpx/>', originalPoints: part, points: part, summary: { distanceM: 14000, elevGainM: 100, elevLossM: 100, closed: false, pointCount: part.length }, createdAt: 1, updatedAt: 1 });
    }
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  }, { database: TEST_DATABASE, coords: coords(), ride: RIDES[0] });
  const capture = async (name: string, width: number) => {
    await expect(page.locator('.rmap:visible .rmap-core').first()).toBeVisible();
    await expect.poll(() => page.locator('.rmap:visible .leaflet-tile-loaded').count(), { timeout: 45000 }).toBeGreaterThan(0);
    await page.evaluate(() => document.fonts.ready);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
      await page.screenshot({ path: `${root}/${width}-${name}-${theme}.png`, fullPage: name === 'inicio' });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  };
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('#/rutas/ia');
    chat = 0;
    for (const radio of [/^Fondo/, /^2 h/, /^Casa/, /^Repetir zona/]) await page.getByRole('radio', { name: radio }).click();
    await page.getByRole('button', { name: 'Pedir rutas a la IA' }).click();
    await expect(page.getByRole('button', { name: /^Exportar GPX/ }).first()).toBeVisible({ timeout: 40000 });
    if (width === 390) await page.getByRole('button', { name: /Ver.*mapa|Abrir.*mapa/i }).first().click();
    await capture('ia', width);
    if (width === 390) await page.getByRole('button', { name: 'Cerrar el mapa' }).click();
    await page.goto('#/historial/s0');
    await capture('salida', width);
    await page.goto('#/');
    await page.locator('.lastride').scrollIntoViewIfNeeded();
    await capture('inicio', width);
    await page.route('https://api.heigit.org/openrouteservice/**', r => {
      const { coordinates: [a, b] } = r.request().postDataJSON();
      const coordinates = Array.from({ length: 100 }, (_, i) => [a[0] + (b[0] - a[0]) * i / 99, a[1] + (b[1] - a[1]) * i / 99, 650]);
      const one = (value: number) => ({ values: [[0, 99, value]], summary: [{ value, distance: 1000, amount: 100 }] });
      return r.fulfill({ json: { features: [{ geometry: { type: 'LineString', coordinates }, properties: { summary: { distance: 1000, duration: 200 }, extras: { surface: one(3), waytypes: one(2), steepness: one(0), waycategory: one(0) } } }] }, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto('#/rutas/empalmar');
    await page.getByRole('combobox', { name: 'Primera ruta' }).selectOption('lib:a');
    await page.getByRole('combobox', { name: 'Segunda ruta' }).selectOption('lib:b');
    await page.getByRole('button', { name: 'Calcular empalme' }).click();
    await expect(page.getByRole('list', { name: 'Opciones de empalme' })).toBeVisible();
    await page.getByRole('region', { name: 'Mapa del empalme', exact: true }).scrollIntoViewIfNeeded();
    await capture('empalmar', width);
    // La siguiente vuelta vuelve al mock de circulares de prepare.
    await page.unroute('https://api.heigit.org/openrouteservice/**');
    await page.route('https://api.heigit.org/openrouteservice/**', r => { const body = structuredClone(original); body.features[0].geometry.coordinates = coords(); return r.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } }); });
  }
});
