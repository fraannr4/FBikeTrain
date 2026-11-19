import { test, expect, type Page, TEST_USER_ID } from './accountFixture';

test.use({ serviceWorkers: 'block' });
test.setTimeout(60_000);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

async function mockCommunity(page: Page) {
  await page.route('https://**', r => r.abort());
  await page.route('https://*.supabase.co/rest/v1/**', r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const profile = new URL(r.request().url()).pathname.endsWith('/profiles');
    return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(profile ? {
      id: TEST_USER_ID, username: 'ciclista', display_name: 'Ciclista', stats_visibility: 'friends',
      bio: 'Una historia en cada salida.', riding_style: 'fondo', avatar_version: 0,
    } : []) });
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [360, 430]) {
    test(`carga sin esperas añadidas ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.addInitScript(t => localStorage.setItem('fbt-theme', t), theme);
      await mockCommunity(page);
      let release = () => {};
      const pending = new Promise<void>(resolve => { release = resolve; });
      await page.route('**/assets/Inicio-*.js', async route => { await pending; await route.continue(); });
      try {
        await page.goto('#/');
        const loader = page.locator('.cycling-loader');
        await expect(loader.getByRole('status')).toHaveText('Cargando pantalla');
        expect(await loader.locator('.cycling-road').evaluate(el => getComputedStyle(el).animationName)).toBe('cycling-trace');
        expect(await loader.locator('.cycling-wheel').first().evaluate(el => getComputedStyle(el).animationName)).toBe('cycling-turn');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await loader.screenshot({ path: `test-results/transiciones/carga-${width}-${theme}.png` });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await expect(loader.getByRole('status')).toBeVisible();
        expect(await loader.locator('.cycling-wheel').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
        release();
        await expect(page.getByRole('region', { name: 'Resumen de la semana' })).toBeVisible();
        await expect(loader).toHaveCount(0);
      } finally { release(); }
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const [width, height] of [[360, 780], [390, 844], [412, 915], [430, 932], [844, 390], [1440, 900]]) {
    test(`navegación fluida ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.addInitScript(t => localStorage.setItem('fbt-theme', t), theme);
      await mockCommunity(page);
      await page.goto('#/historial');
      await expect(page.getByRole('heading', { level: 1, name: 'Salidas' })).toBeVisible();
      const menu = page.getByRole('navigation', { name: 'Menú principal' });
      for (const name of ['Rutas', 'Plan', 'Salidas']) {
        await menu.getByRole('link', { name, exact: true }).click();
        await expect(page).toHaveTitle(`${name === 'Plan' ? 'Calendario' : name} · FBikeTrain`);
        expect(await page.locator('main').evaluate(el => getComputedStyle(el).transform)).toBe('none');
      }
      const views = page.getByRole('navigation', { name: 'Vistas de Salidas' });
      await views.getByRole('link', { name: 'Subidas' }).click();
      await expect(views.getByRole('link', { name: 'Subidas' })).toHaveAttribute('aria-current', 'page');
      await views.getByRole('link', { name: 'Repetidas' }).click();
      await expect(page).toHaveTitle('Repetidas · FBikeTrain');
      await page.goto('#/retos');
      await page.getByRole('button', { name: 'Historial', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Historial de retos' })).toBeVisible();
      await page.getByRole('button', { name: 'Avisos', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Notificaciones de retos' })).toBeVisible();
      await page.screenshot({ path: `test-results/transiciones/retos-${width}-${theme}.png` });
      await page.goto('#/perfil');
      await expect(page.getByRole('region', { name: 'Cuaderno de ruta' })).toBeVisible();
      await page.getByRole('button', { name: 'Mi grupeta', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Feed de amigos' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Mi grupeta', exact: true })).toBeFocused();
      await expect(page.getByText('Aquí aparecerán las publicaciones que compartáis tú y tus amigos.')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/transiciones/perfil-${width}-${theme}.png` });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('button', { name: 'Mi cuaderno', exact: true }).click();
      const journal = page.getByRole('region', { name: 'Cuaderno de ruta' });
      await expect(journal).toBeVisible();
      expect(await journal.evaluate(el => el.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
    });
  }
}
