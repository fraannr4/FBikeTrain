import { test, expect } from './accountFixture';

// Primera carga, instalación del service worker y recarga sin red en máquinas cargadas.
test.setTimeout(60_000);

test('tras una sola visita, la app arranca sin red y abre una pantalla ya vista', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const menu = page.getByRole('navigation', { name: 'Menú principal' });
  await expect(menu).toBeVisible();
  await page.goto('#/mas');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // El worker toma el control y guarda lo que la página ya había descargado sin él.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect.poll(() => page.evaluate(async () => {
    const kept = new Set((await (await caches.open('fbiketrain-app-v1')).keys()).map(request => request.url));
    const used = performance.getEntriesByType('resource').map(entry => entry.name.split(/[?#]/)[0])
      .filter(url => url.startsWith(`${location.origin}/`) && !url.endsWith('/sw.js'));
    return kept.has(`${location.origin}/`) && used.length > 3 && used.every(url => kept.has(url));
  }), { timeout: 30_000 }).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(menu).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Las pestañas principales se descargan en segundo plano: abren sin red aunque no se hayan visitado.
  await menu.getByRole('link', { name: 'Historial' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Historial' })).toBeVisible();
  // Nada de otros orígenes ni el propio worker queda guardado.
  const kept = await page.evaluate(async () => (await (await caches.open('fbiketrain-app-v1')).keys()).map(request => request.url));
  const origin = new URL(page.url()).origin;
  expect(kept.every(url => url.startsWith(`${origin}/`) && !url.endsWith('/sw.js'))).toBe(true);
  expect(kept).toContain(`${origin}/`);
});
