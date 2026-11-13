import { test, expect } from './accountFixture';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const sizes = [[360, 780], [430, 932], [844, 390], [900, 600], [1024, 600], [1280, 640], [1440, 900]];

for (const [width, height] of sizes) for (const theme of ['light', 'dark'] as const) {
  test(`comunidad visible ${width}x${height} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(t => localStorage.setItem('fbt-theme', t), theme);
    await page.route('https://*.supabase.co/rest/v1/**', r => {
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
      const profiles = new URL(r.request().url()).pathname.endsWith('/profiles');
      return r.fulfill({ headers: CORS, json: profiles
        ? { username: 'ana_ruta', display_name: 'Ana Ruta', stats_visibility: 'friends' }
        : [] });
    });
    await page.goto('./#/perfil');
    await expect(page.getByRole('region', { name: 'Tu identidad pública' })).toContainText('Ana Ruta');
    const nav = page.getByRole('navigation', { name: 'Menú principal' });
    if (width < 900) {
      await expect(nav.getByRole('link')).toHaveCount(5);
      await expect(nav.getByRole('link', { name: 'Perfil', exact: true })).toHaveAttribute('aria-current', 'page');
      await page.getByRole('link', { name: /Más opciones/ }).click();
      await expect(page.getByRole('heading', { name: 'Más', exact: true })).toBeVisible();
      await nav.getByRole('link', { name: 'Perfil', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Tu perfil' })).toBeVisible();
    } else {
      const group = nav.getByRole('group', { name: 'Comunidad' });
      await expect(group).toBeVisible();
      await expect(group.getByRole('link', { name: 'Tu perfil', exact: true })).toHaveAttribute('aria-current', 'page');
      await group.getByRole('link', { name: 'Amigos', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Amigos', exact: true })).toBeVisible();
      await expect(group.getByRole('link', { name: 'Amigos', exact: true })).toHaveAttribute('aria-current', 'page');
      await group.getByRole('link', { name: 'Retos', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Retos', exact: true })).toBeVisible();
      await expect(group.getByRole('link', { name: 'Retos', exact: true })).toHaveAttribute('aria-current', 'page');
      await nav.getByRole('link', { name: 'Más', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Más', exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Más', exact: true })).toHaveAttribute('aria-current', 'page');
      await group.getByRole('link', { name: 'Tu perfil', exact: true }).click();
      if (width >= 1280) {
        const label = group.getByRole('link', { name: 'Tu perfil', exact: true }).locator('span').last();
        expect(await label.evaluate(el => el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) * 1.5)).toBe(true);
      }
      await nav.evaluate(el => { el.scrollTop = 0; });
    }
    expect(await nav.getByRole('link').evaluateAll(links => links.filter(link => getComputedStyle(link).display !== 'none').every(link => link.getBoundingClientRect().height >= 44))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await page.screenshot({ path: `test-results/comunidad-nav/${width}-${theme}.png`, fullPage: true });
  });
}
