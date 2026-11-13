import { test, expect, type Page } from './accountFixture';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const PERSON = { id: '00000000-0000-0000-0000-000000000022', display_name: 'Maximiliana de los Santos Inocentes Bermúdez-Villalobos', username: 'maximiliana_de_los_santos_inoce', locality: null, distance_km: null };

async function social(page: Page) {
  const state = { status: 'pending', present: true, requested: 0 };
  await page.route('https://*.supabase.co/rest/v1/**', async r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const fn = new URL(r.request().url()).pathname.split('/').pop();
    let data: unknown = null;
    if (fn === 'profiles') data = PERSON;
    if (fn === 'search_profiles') data = [PERSON];
    if (fn === 'list_friends') data = state.present ? [{ friendship_id: 'f1', status: state.status, direction: 'received', profile: PERSON }] : [];
    if (fn === 'accept_friendship') state.status = 'accepted';
    if (fn === 'remove_friendship') state.present = false;
    if (fn === 'request_friendship') { state.present = true; state.requested++; }
    return r.fulfill({ status: 200, headers: CORS, json: data });
  });
  return state;
}

test('buscador → perfil → aceptar amistad → retar al mismo ciclista', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await social(page);
  await page.goto('./#/amigos');
  await page.getByLabel('Nombre o usuario').fill('Maximiliana');
  await page.getByRole('search').getByRole('button', { name: 'Buscar' }).click();
  await page.getByRole('link', { name: PERSON.display_name, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Perfil del ciclista' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Retar a/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Aceptar solicitud' }).click();
  await expect(page.getByRole('link', { name: `Retar a ${PERSON.display_name}` })).toHaveAttribute('href', `#/retos/nuevo?amigo=${PERSON.id}`);
  expect(state.status).toBe('accepted');
  expect(state.requested).toBe(0);
  await page.getByRole('link', { name: /Retar a/ }).click();
  await expect(page).toHaveURL(new RegExp(`amigo=${PERSON.id}$`));
});

for (const [width, height] of [[360, 780], [390, 844], [412, 915], [430, 932], [844, 390]]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`perfil ajeno ${width}x${height} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(value => localStorage.setItem('fbt-theme', value), theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const state = await social(page);
      state.status = 'accepted';
      await page.goto(`./#/personas/${PERSON.id}`);
      await expect(page.getByRole('link', { name: /Retar a/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await page.screenshot({ path: `test-results/personas/perfil-${width}-${theme}.png`, fullPage: true });
    });
  }
}
