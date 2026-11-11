import { expect, test } from './accountFixture';
import { seed, settings } from './seed';

for (const width of [360, 430]) {
  test(`biblioteca: origen y autor largos a ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await seed(page, { settings: settings() });
    await page.goto('#/rutas/biblioteca');
    const name = `Vuelta sintética ${'por carreteras conocidas '.repeat(5)}`.slice(0, 120).trim();
    const author = `Autora${'sintética'.repeat(15)}`.slice(0, 120);
    const xml = `<gpx><metadata><link href="https://es.wikiloc.com/rutas-ciclismo/sintetica-1234"/><author><name>${author}</name></author></metadata><trk><name>${name}</name><trkseg><trkpt lat="41" lon="2.5"><ele>10</ele></trkpt><trkpt lat="41.001" lon="2.5"><ele>30</ele></trkpt><trkpt lat="41.001" lon="2.501"><ele>20</ele></trkpt><trkpt lat="41" lon="2.5"><ele>10</ele></trkpt></trkseg></trk></gpx>`;
    const upload = page.getByLabel('Elegir GPX o TCX');
    await expect(upload).toBeEnabled();
    await upload.setInputFiles({ name: 'sintetica.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(xml) });
    const source = page.getByRole('link', { name: `Origen: Wikiloc · ${author}` });
    await expect(source).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(page.getByLabel('Nombre de la ruta')).toHaveValue(name);
    await source.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const bounds = await source.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath(`biblioteca-${width}.png`) });
  });
}
