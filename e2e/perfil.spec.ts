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
          bio: 'Una bici y mil historias por descubrir.', riding_style: 'fondo', avatar_version: 0,
        } });
      });
      await page.route('https://*.supabase.co/rest/v1/rpc/list_profile_posts', route => route.fulfill({ headers: CORS, json: [] }));
      await page.route('https://*.supabase.co/rest/v1/rpc/list_friends', route => route.fulfill({ headers: CORS, json: [] }));
      await page.route('https://*.supabase.co/rest/v1/rpc/list_community_challenges', route => route.fulfill({ headers: CORS, json: [] }));
      await page.route('https://*.supabase.co/rest/v1/rpc/touch_community_activity', route => route.fulfill({ status: 204, headers: CORS }));
      await page.goto('./#/perfil');
      await expect(page.getByRole('region', { name: 'Tu identidad pública' })).toContainText('@maximiliana_de_los_santos_inoce');
      // «Tú»: arriba, lo de este dispositivo. Sin salidas, primero la tarjeta para importar.
      await expect(page.getByRole('heading', { level: 1, name: 'Tú' })).toBeVisible();
      await expect(page.getByText('Empieza por tu archivo de Strava')).toBeVisible();
      const datos = page.getByRole('list', { name: 'Tus datos y ajustes' });
      await expect(datos.getByRole('link', { name: /^Ajustes/ })).toHaveAttribute('href', '#/ajustes');
      await expect(datos.getByRole('link', { name: /^Privacidad/ })).toHaveAttribute('href', '#/privacidad');
      await expect(page.getByRole('link', { name: 'Más opciones' })).toHaveCount(0);
      const edit = await page.getByRole('button', { name: 'Editar perfil', exact: true }).boundingBox();
      const share = await page.getByRole('button', { name: 'Compartir perfil', exact: true }).boundingBox();
      expect(edit && share && Math.abs(edit.y - share.y) < 2 && edit.width > 100 && share.width > 100).toBe(true);
      await expect(page.getByRole('list', { name: 'Tus cifras' }).getByRole('link', { name: /amigos/ })).toHaveAttribute('href', '#/perfil/amigos');
      await expect(page.getByRole('link', { name: 'Ciclistas' }).first()).toHaveAttribute('href', '#/ciclistas');
      await expect(page.getByRole('link', { name: /Mis retos/ })).toHaveAttribute('href', '#/retos');
      await expect(page.getByText(/comparativas entre perfiles siguen pendientes/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Editar perfil', exact: true })).toBeVisible();
      await expect(page.getByRole('form', { name: 'Editar perfil' })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await page.screenshot({ path: `test-results/perfil/perfil-${width}-${theme}.png`, fullPage: true });
    });
  }
}
