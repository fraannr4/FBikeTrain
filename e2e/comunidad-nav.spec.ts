import { test, expect } from './accountFixture';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const sizes = [[360, 780], [390, 844], [430, 932], [844, 390], [900, 600], [1024, 600], [1280, 640], [1440, 900]];
const YOU = 'Tú: perfil, importar y ajustes';

for (const [width, height] of sizes) for (const theme of ['light', 'dark'] as const) {
  test(`gente y tú ${width}x${height} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(t => localStorage.setItem('fbt-theme', t), theme);
    await page.route('https://*.supabase.co/rest/v1/**', r => {
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
      const profiles = new URL(r.request().url()).pathname.endsWith('/profiles');
      return r.fulfill({ headers: CORS, json: profiles
        ? { username: 'ana_ruta', display_name: 'Ana Ruta', stats_visibility: 'friends', bio: 'Historias sobre dos ruedas.', riding_style: 'grupo', avatar_version: 0 }
        : [] });
    });
    // Con cuenta registrada, «Más» ya no existe: `/mas` lleva a «Tú».
    await page.goto('./#/mas');
    await expect(page).toHaveURL(/#\/perfil$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Tú' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Tus datos y ajustes' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Tu identidad pública' })).toContainText('Ana Ruta');
    await expect(page.getByRole('link', { name: 'Más opciones' })).toHaveCount(0);
    const nav = page.getByRole('navigation', { name: 'Menú principal' });
    const parts = page.getByRole('navigation', { name: 'Partes de Gente' });
    if (width < 900) {
      // Muelle: Inicio, Salidas, Rutas, Plan y Gente; «Tú» es tu foto en la cabecera de las pantallas raíz.
      await expect(nav.getByRole('link')).toHaveText(['Inicio', 'Salidas', 'Rutas', 'Plan', 'Gente']);
      await nav.getByRole('link', { name: /^Gente/ }).click();
      await expect(page).toHaveURL(/#\/chat$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Gente' })).toBeVisible();
      await expect(nav.getByRole('link', { name: /^Gente/ })).toHaveAttribute('aria-current', 'page');
      for (const part of ['Amigos', 'Retos', 'Ciclistas', 'Chats']) {
        await parts.getByRole('link', { name: part, exact: true }).click();
        await expect(parts.getByRole('link', { name: part, exact: true })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByRole('heading', { level: 1, name: 'Gente' })).toBeVisible();
        await expect(page.getByRole('link', { name: /^Volver/ })).toHaveCount(0);
      }
      expect(await parts.getByRole('link').evaluateAll(links => links.every(link => link.getBoundingClientRect().height >= 44))).toBe(true);
      await page.getByRole('link', { name: YOU }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Tú' })).toBeVisible();
    } else {
      const group = nav.getByRole('group', { name: 'Gente' });
      await expect(group).toBeVisible();
      await expect(nav.getByRole('link', { name: YOU })).toHaveAttribute('aria-current', 'page');
      for (const part of ['Chats', 'Amigos', 'Retos', 'Ciclistas']) {
        await group.getByRole('link', { name: part, exact: true }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Gente' })).toBeVisible();
        await expect(group.getByRole('link', { name: part, exact: true })).toHaveAttribute('aria-current', 'page');
        // El carril lleva las cuatro partes: el control segmentado no se pinta.
        await expect(parts).toHaveCount(0);
      }
      await nav.getByRole('link', { name: YOU }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Tú' })).toBeVisible();
      if (width >= 1280) {
        const label = nav.getByRole('link', { name: YOU }).locator('span').last();
        expect(await label.evaluate(el => el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) * 1.5)).toBe(true);
      }
      await nav.evaluate(el => { el.scrollTop = 0; });
    }
    expect(await nav.getByRole('link').evaluateAll(links => links.filter(link => getComputedStyle(link).display !== 'none').every(link => link.getBoundingClientRect().height >= 44))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await page.screenshot({ path: `test-results/comunidad-nav/${width}-${theme}.png`, fullPage: true });
  });
}
