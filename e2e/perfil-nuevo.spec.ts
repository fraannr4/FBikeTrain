import { test, expect, TEST_USER_ID, type Page } from './accountFixture';

// Paso de alta del perfil: Supabase simulado. Datos sintéticos; ninguna llamada real.
test.setTimeout(90_000);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const SHOTS = 'test-results/perfil-nuevo';

async function fakeServices(page: Page, taken: string[] = []) {
  const patches: Record<string, unknown>[] = [];
  await page.route('https://*.supabase.co/rest/v1/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.url().includes('/rpc/my_area')) return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([{ locality: null, show_area: true }]) });
    if (req.url().includes('/profiles')) {
      if (req.method() === 'PATCH') {
        const body = req.postDataJSON() as Record<string, unknown>;
        if (taken.includes(String(body.username))) return r.fulfill({ status: 409, headers: CORS, contentType: 'application/json', body: JSON.stringify({ code: '23505', message: 'duplicate key value', details: null, hint: null }) });
        patches.push(body);
        return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ id: TEST_USER_ID }) });
      }
      return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ username: TEST_USER_ID.replace(/-/g, ''), display_name: 'Ciclista', bio: null, riding_style: 'explorar', avatar_version: 0 }) });
    }
    return r.abort();
  });
  return patches;
}

test('una cuenta sin usuario propio configura el perfil y sigue a Tu zona', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const patches = await fakeServices(page, ['ocupado']);
  await page.goto('./');
  await expect(page).toHaveURL(/#\/perfil\/nuevo\?siguiente=zona$/);
  await expect(page.getByRole('heading', { name: 'Tu perfil ciclista', level: 1 })).toBeVisible();
  await page.getByLabel('Nombre visible').fill('Ana Sintética');
  await page.getByLabel('Nombre de usuario').fill('ocupado');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Ese nombre de usuario ya está ocupado. Elige otro.')).toBeVisible();
  await page.getByLabel('Nombre de usuario').fill('ana_sintetica');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Ponle cara a tu perfil' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await page.screenshot({ path: `${SHOTS}/paso2-390.png`, fullPage: true });
  await page.getByRole('button', { name: 'Más tarde' }).click();
  await expect(page).toHaveURL(/#\/zona$/);
  expect(patches).toEqual([{ display_name: 'Ana Sintética', username: 'ana_sintetica' }]);
});

test('el paso 1 cabe a 390 px sin desbordar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeServices(page);
  await page.goto('./#/perfil/nuevo');
  await expect(page.getByLabel('Nombre de usuario')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await page.screenshot({ path: `${SHOTS}/paso1-390.png`, fullPage: true });
});
