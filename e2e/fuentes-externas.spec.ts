import { mkdirSync } from 'node:fs';
import { test, expect, TEST_DATABASE } from './accountFixture';

test.setTimeout(60_000);
const name = 'Ruta sintética de Wikiloc con nombre largo para comprobar la biblioteca desde el móvil';
const xml = `<gpx version="1.1"><metadata><author><name>Autor sintético</name></author><link href="https://es.wikiloc.com/rutas-ciclismo/sintetica-123"/></metadata><trk><name>${name}</name><trkseg><trkpt lat="0" lon="0"><ele>10</ele><time>2026-01-01T10:00:00Z</time></trkpt><trkpt lat="0" lon="0.01"><ele>30</ele><time>2026-01-01T10:02:00Z</time></trkpt></trkseg></trk></gpx>`;

for (const theme of ['light', 'dark']) {
  for (const viewport of [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 430, height: 932 }, { width: 844, height: 390 }]) {
    test(`GPX manual en biblioteca ${theme} ${viewport.width}x${viewport.height}`, async ({ page }) => {
      mkdirSync('test-results/fuentes-externas', { recursive: true });
      await page.setViewportSize(viewport);
      await page.addInitScript(theme => localStorage.setItem('fbt-theme', theme), theme);
      await page.goto('#/rutas/biblioteca');
      const input = page.getByLabel('Elegir GPX o TCX', { exact: true });
      await expect(input).toBeEnabled();
      await page.screenshot({ path: `test-results/fuentes-externas/biblioteca-vacia-${theme}-${viewport.width}.png`, fullPage: true });
      await input.setInputFiles({ name: 'wikiloc-sintetico.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(xml) });
      await expect(page.getByRole('status')).toContainText('Ruta analizada.');
      await expect(page.getByText('Origen: Wikiloc · Autor sintético')).toBeVisible();
      await expect(page.getByRole('link', { name: /Origen: Wikiloc/ })).toHaveAttribute('href', 'https://es.wikiloc.com/rutas-ciclismo/sintetica-123');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // Una ruta de terceros con tiempos sigue siendo referencia, sin salidas ficticias.
      const counts = await page.evaluate(async database => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(database);
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        const tx = db.transaction(['referenceRoutes', 'activities']);
        const count = (store: string) => new Promise<number>(resolve => { const request = tx.objectStore(store).count(); request.onsuccess = () => resolve(request.result); });
        const result = await Promise.all([count('referenceRoutes'), count('activities')]);
        db.close(); return result;
      }, TEST_DATABASE);
      expect(counts).toEqual([1, 0]);
      await page.screenshot({ path: `test-results/fuentes-externas/biblioteca-importada-${theme}-${viewport.width}.png`, fullPage: true });
      await page.reload();
      await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
    });
  }
}

test('un GPX inválido muestra el error y permite elegir otro sin crear una ruta', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('#/rutas/biblioteca');
  const input = page.getByLabel('Elegir GPX o TCX', { exact: true });
  await expect(input).toBeEnabled();
  await input.setInputFiles({ name: 'sin-track.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from('<gpx/>') });
  await expect(page.getByRole('alert')).toContainText('Selecciona un GPX con un solo track.');
  await input.setInputFiles({ name: 'valido.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(xml) });
  await expect(page.getByRole('status')).toContainText('Ruta analizada.');
});
