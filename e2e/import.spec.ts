import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { expect, test, type Page } from '@playwright/test';

const RIDE_GPX = fileURLToPath(new URL('../tests/fixtures/ride.gpx', import.meta.url));

// El fixture es del domingo 2026-01-04 a las 09:00 en Madrid. Se fija la hora de la
// página a ese mismo domingo para que la salida caiga en «Esta semana».
const FIXTURE_SUNDAY_NOON = new Date('2026-01-04T12:00:00+01:00');

test('import gpx then inicio shows totals', async ({ page }) => {
  await page.clock.setFixedTime(FIXTURE_SUNDAY_NOON);

  await page.goto('#/importar');
  await expect(page.getByRole('heading', { name: 'Importar salidas' })).toBeVisible();
  await page.getByLabel('Elegir el ZIP o ficheros').setInputFiles(RIDE_GPX);
  await expect(page.getByText('1 salida nueva')).toBeVisible();

  await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Inicio', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);

  const week = page.getByRole('region', { name: 'Esta semana' });
  const distance = week.locator('.kpi').filter({ hasText: 'Distancia' }).locator('.kpi-value');
  await expect(distance).toHaveText(/^\d[\d.]* km$/);
  await expect(distance).not.toHaveText('0 km');
});

// Archivo de Strava sintético: una salida en bici (el fixture, en el mar) y dos que no lo son.
const CSV = [
  'ID de actividad,Nombre de la actividad,Tipo de actividad,Nombre del archivo',
  '1,"Cabo, faro y ""vuelta""",Bicicleta,activities/1.gpx',
  '2,Trote,Carrera,activities/2.gpx',
  '3,Paseo,Caminata,activities/3.gpx',
].join('\n');
const ARCHIVE: Record<string, string | Buffer> = {
  'activities.csv': CSV,
  'activities/1.gpx': readFileSync(RIDE_GPX),
  'activities/2.gpx': '<gpx/>',
  'activities/3.gpx': '<gpx/>',
};

async function expectArchiveReport(page: Page) {
  await expect(page.getByText('1 salida nueva')).toBeVisible();
  await expect(page.getByText('0 ya estaban')).toBeVisible();
  await expect(page.getByText('2 no son de bici, descartadas')).toBeVisible();
  await expect(page.getByText('0 con error')).toBeVisible();
}

test('whole strava zip imports at once, with the windows mime type', async ({ page }) => {
  const zip = new JSZip();
  for (const [path, data] of Object.entries(ARCHIVE)) zip.file(`export_123/${path}`, data);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });

  await page.goto('#/importar');
  await page
    .getByLabel('Elegir el ZIP o ficheros')
    .setInputFiles({ name: 'export_123.zip', mimeType: 'application/x-zip-compressed', buffer });
  await expectArchiveReport(page);
});

test('unzipped strava folder imports at once', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'strava-'));
  const folder = join(root, 'export_123');
  for (const [path, data] of Object.entries(ARCHIVE)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), data);
  }
  try {
    await page.goto('#/importar');
    await page.getByLabel('Elegir carpeta').setInputFiles(folder);
    await expectArchiveReport(page);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
