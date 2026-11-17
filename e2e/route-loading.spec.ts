import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from './accountFixture';
import { seed, settings } from './seed';

const SHOTS = 'docs/design/2026-11-17-loading-cartografia';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
test.setTimeout(60_000);
test.use({ serviceWorkers: 'block' });

/** La biblioteca queda pendiente para observar la carga, sin consultar servicios reales. */
async function startLoading(page: Page) {
  await page.context().route('https://**', route => route.abort());
  let release = () => {};
  const response = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://*.supabase.co/functions/v1/route-sources', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    await response;
    await route.fulfill({
      status: 200, contentType: 'application/json', headers: CORS,
      body: JSON.stringify({ data: { routeCount: 0, cells: [], routes: [], zoneFactor: 1.75, factorSamples: 0, climbMPerKm: null, fill: 'nothing-found' } }),
    }).catch(() => {}); // El usuario puede cancelar mientras la biblioteca aún no responde.
  });
  await seed(page, { settings: settings({ orsKey: 'synthetic-ors-key' }) });
  await page.goto('#/rutas');
  await page.getByLabel('Distancia').fill('60');
  await page.getByRole('button', { name: 'Proponer rutas' }).click();
  const card = page.getByRole('region', { name: 'Progreso de la búsqueda' });
  await expect(card).toBeVisible();
  return { card, release };
}

const sizes = [
  { width: 360, height: 780 }, { width: 390, height: 844 },
  { width: 412, height: 915 }, { width: 430, height: 932 },
  { width: 844, height: 390 }, { width: 1280, height: 900 },
];

for (const theme of ['light', 'dark'] as const) {
  for (const size of sizes) {
    test(`Cartografía viva ${size.width}×${size.height} ${theme}`, async ({ page }) => {
      mkdirSync(SHOTS, { recursive: true });
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      const { card, release } = await startLoading(page);
      try {
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await expect(card.getByRole('status')).toHaveText('Cargando las rutas de la zona…');
        await expect(card.getByRole('status')).not.toContainText('transcurridos');
        await expect(card.getByRole('heading', { level: 3 })).toHaveText('Explorandotu zona.');
        await expect(card.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
        await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Sin consultas al motor de rutas todavía');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const button = card.getByRole('button', { name: 'Cancelar' });
        const box = await button.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        await card.screenshot({ path: `${SHOTS}/carga-${size.width}-${theme}.png` });
        await button.click();
        await expect(card).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Proponer rutas' })).toBeEnabled();
      } finally { release(); }
    });
  }
}

test('pedaleo continuo, movimiento reducido y fin de carga sin esperar al ciclo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const { card, release } = await startLoading(page);
  try {
    const shin = card.locator('[data-leg="front"] [data-shin]');
    const pose = await shin.getAttribute('d');
    await expect.poll(() => shin.getAttribute('d')).not.toBe(pose);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    const frozen = await shin.getAttribute('d');
    await page.waitForTimeout(120);
    await expect(shin).toHaveAttribute('d', frozen!);
    release();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Proponer rutas' })).toBeEnabled();
  } finally { release(); }
});
