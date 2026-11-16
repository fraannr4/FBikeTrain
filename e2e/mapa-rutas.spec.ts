import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test, TEST_DATABASE, type Page } from './accountFixture';
import { NOW, RIDES, seed, settings } from './seed';

// Geometría inventada trasladada a una zona pública; nunca un track de una persona.
const original = JSON.parse(readFileSync('tests/fixtures/ors/round-trip-ok.json', 'utf8'));
const phase = process.env.MAPA_FASE ?? 'despues';
const root = `mapa-rutas.local/${phase}`;
const realTiles = process.env.MAPA_CAPTURAS === '1';
const coords = (): number[][] => original.features[0].geometry.coordinates.map(([lng, lat, ele]: number[]) =>
  [2.163 + (lat - 40.4168) * 1.3, 41.634 - (lng + 3.7038) / 1.3, ele]);

async function prepare(page: Page) {
  await page.clock.setFixedTime(NOW);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (!realTiles) await page.route(/tile-cyclosm/, r => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path d="M0 0L256 256M0 120H256" stroke="#6574ab" stroke-width="4"/></svg>' }));
  await seed(page, { activities: RIDES, settings: settings({ home: { lat: 41.634, lng: 2.163 } }) });
  await page.evaluate(async ({ database, coords, ride }) => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open(database); req.onsuccess = () => resolve(req.result); });
    const tx = db.transaction(['activities', 'tracks'], 'readwrite');
    tx.objectStore('activities').put({ ...ride, hasTrack: true });
    tx.objectStore('tracks').put({ activityId: ride.id, points: coords.map(([lng, lat, ele], i) => ({ lng, lat, ele, t: ride.startTime + i * 60000 })) });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  }, { database: TEST_DATABASE, coords: coords(), ride: RIDES[0] });
}

test('mapa compartido: Salida e Inicio, primero móvil', async ({ page }) => {
  test.setTimeout(120000);
  mkdirSync(root, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
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
    await page.goto('#/historial/s0');
    await capture('salida', width);
    await page.goto('#/');
    await page.locator('.lastride').scrollIntoViewIfNeeded();
    await capture('inicio', width);
  }
});
