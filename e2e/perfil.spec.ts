import { test, expect } from './accountFixture';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

for (const width of [360, 430]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`centro de perfil propio a ${width} px en ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((value) => localStorage.setItem('fbt-theme', value), theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route('https://*.supabase.co/rest/v1/profiles*', (route) => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
        return route.fulfill({ headers: CORS, json: {
          username: 'maximiliana_de_los_santos_inoce',
          display_name: 'Maximiliana de los Santos Inocentes Bermúdez-Villalobos',
          stats_visibility: 'friends',
        } });
      });
      await page.goto('./#/perfil');
      await expect(page.getByRole('region', { name: 'Tu identidad pública' })).toContainText('@maximiliana_de_los_santos_inoce');
      await expect(page.getByRole('link', { name: /Mis amigos/ })).toHaveAttribute('href', '#/amigos?vista=amigos');
      await expect(page.getByRole('link', { name: /Buscar ciclistas/ })).toHaveAttribute('href', '#/amigos');
      await expect(page.getByRole('link', { name: /Mis retos/ })).toHaveAttribute('href', '#/retos');
      await expect(page.getByText(/comparativas entre perfiles todavía no están disponibles/)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await page.screenshot({ path: `test-results/perfil/perfil-${width}-${theme}.png`, fullPage: true });
    });
  }
}
