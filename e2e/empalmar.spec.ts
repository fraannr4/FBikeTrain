import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './accountFixture';
import { MOBILE, NOW, RIDES, seed, settings } from './seed';

test.use({ viewport: MOBILE, hasTouch: true });

// Rutas sintéticas junto a la Puerta del Sol (punto público): dos tramos abiertos de 3 km separados 2 km.
const LAT = 40.4168;
const M_LNG = 111_320 * Math.cos((LAT * Math.PI) / 180);
const lng = (x: number) => -3.75 + x / M_LNG;
const line = (x0: number, x1: number) => Array.from({ length: Math.round(Math.abs(x1 - x0) / 10) + 1 }, (_, i) => ({ lat: LAT, lng: lng(x0 + Math.sign(x1 - x0) * i * 10), ele: 650 + i * 0.05 }));
function stored(id: string, name: string, points: { lat: number; lng: number; ele: number }[]) {
  let distanceM = 0;
  for (let i = 1; i < points.length; i++) distanceM += Math.abs(points[i].lng - points[i - 1].lng) * M_LNG;
  return {
    id, name, format: 'gpx', sourceFileName: `${id}.gpx`, originalXml: '<gpx/>', originalPoints: points, points,
    summary: { distanceM, elevGainM: points[points.length - 1].ele - points[0].ele, elevLossM: 0, closed: false, pointCount: points.length }, createdAt: 1, updatedAt: 1,
  };
}

/** ORS simulado: una recta entre los dos puntos pedidos, con los extras que pide el empalme. */
function orsPath(body: { coordinates: [number, number][] }) {
  const [[aLng, aLat], [bLng, bLat]] = body.coordinates;
  const n = Math.max(1, Math.round((Math.abs(bLng - aLng) * M_LNG + Math.abs(bLat - aLat) * 111_320) / 40));
  const coordinates = Array.from({ length: n + 1 }, (_, i) => [aLng + ((bLng - aLng) * i) / n, aLat + ((bLat - aLat) * i) / n, 650]);
  const d = n * 40;
  const one = (value: number) => ({ values: [[0, n, value]], summary: [{ value, distance: d, amount: 100 }] });
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { summary: { distance: d, duration: d / 6 }, extras: { surface: one(3), waytypes: one(2), steepness: one(0), waycategory: one(0) } } }] };
}

async function seedRoutes(page: Page) {
  await page.evaluate(async (routes) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ciclismo-user-00000000-0000-0000-0000-000000000011');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['referenceRoutes'], 'readwrite');
    for (const r of routes) tx.objectStore('referenceRoutes').put(r);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  }, [stored('a', 'Costa sintética', line(0, 3000)), stored('b', 'Interior sintético', line(5000, 8000))]);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test('empalma dos rutas a 390 px y exporta un GPX continuo', async ({ page }) => {
  let calls = 0;
  await page.route('https://api.heigit.org/openrouteservice/**', (route) => {
    calls++;
    const body = JSON.parse(route.request().postData() ?? '{}');
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(orsPath(body)) });
  });
  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
  await seedRoutes(page);
  await page.goto('#/rutas/empalmar');

  await expect(page.getByRole('heading', { name: 'Empalmar dos rutas', level: 1 })).toBeVisible();
  await page.getByRole('combobox', { name: 'Primera ruta' }).selectOption('a');
  await page.getByRole('combobox', { name: 'Segunda ruta' }).selectOption('b');
  await page.getByText('Volver al inicio al terminar').click();
  await page.getByRole('button', { name: 'Calcular empalme' }).click();

  const list = page.getByRole('list', { name: 'Opciones de empalme' });
  await expect(list).toBeVisible({ timeout: 30_000 });
  await expect(list.getByRole('listitem').first().getByText('Recomendada')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Leyenda del mapa' })).toContainText('Regreso al inicio');
  expect(calls).toBeGreaterThan(0);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar GPX' }).click()]);
  const gpx = readFileSync((await download.path())!, 'utf8');
  expect(gpx).toContain('version="1.1"');
  expect(gpx).toMatch(/<trk>[\s\S]*<trkseg>/);
  expect(gpx).toContain('<ele>');
  const pts = [...gpx.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)">/g)].map(m => ({ lat: Number(m[1]), lng: Number(m[2]) }));
  for (let i = 1; i < pts.length; i++) {
    const dx = (pts[i].lng - pts[i - 1].lng) * M_LNG; const dy = (pts[i].lat - pts[i - 1].lat) * 111_320;
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(50);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: 'test-results/empalmar-390.png', fullPage: true });
});

test('con la cuota diaria de ORS agotada lo explica', async ({ page }) => {
  await page.route('https://api.heigit.org/openrouteservice/**', (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { code: 403, message: 'Quota exceeded' } }) }));
  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
  await seedRoutes(page);
  await page.goto('#/rutas/empalmar');
  await page.getByRole('combobox', { name: 'Primera ruta' }).selectOption('a');
  await page.getByRole('combobox', { name: 'Segunda ruta' }).selectOption('b');
  await page.getByRole('button', { name: 'Calcular empalme' }).click();
  await expect(page.getByRole('alert')).toContainText('2.000 consultas diarias', { timeout: 30_000 });
});
