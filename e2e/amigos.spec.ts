import { test, expect, type Page } from './accountFixture';

// Amigos con las RPC simuladas. Nombres sintéticos, también los extremos (largos y sin espacios).
test.setTimeout(90_000);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const SHOTS = 'test-results/amigos';
const LONG = 'Maximiliana de los Santos Inocentes Bermúdez-Villalobos';
const LONG_USER = 'maximiliana_de_los_santos_inoce';
const card = (id: string, display_name: string, username: string, locality: string | null, distance_km: number | null = null) =>
  ({ id, display_name, username, locality, distance_km });
const RESULTS = [
  card('p2', 'Ana Ruta', 'ana_ruta', 'Villa Prueba, Provincia Ficticia'),
  card('p3', LONG, LONG_USER, 'San Cristóbal de la Sierra Sintética de Arriba, Provincia Ficticia del Norte'),
  card('p4', 'Bea', 'bea_puerto', null),
];

async function fakeRpc(page: Page, opts: { results?: unknown[]; friends?: unknown[]; locality?: string | null } = {}) {
  const state = { friends: opts.friends ?? [], requested: [] as unknown[] };
  await page.route('https://*.supabase.co/rest/v1/rpc/*', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const fn = new URL(req.url()).pathname.split('/').pop();
    const json = (body: unknown) => r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (fn === 'my_area') return json([{ locality: opts.locality === undefined ? 'Villa Centro' : opts.locality, show_area: true }]);
    if (fn === 'list_friends') return json(state.friends);
    if (fn === 'search_profiles') return json(opts.results ?? RESULTS);
    if (fn === 'search_profiles_near') return json((opts.results ?? RESULTS).map((c, i) => ({ ...(c as object), distance_km: 8 + i * 15 })));
    if (fn === 'request_friendship') {
      state.requested.push(req.postDataJSON());
      const target = (opts.results ?? RESULTS).find((c) => (c as { id: string }).id === req.postDataJSON().target_id);
      state.friends = [...state.friends, { friendship_id: 'f-new', status: 'pending', direction: 'sent', profile: target }];
      return r.fulfill({ status: 204, headers: CORS });
    }
    return r.fulfill({ status: 204, headers: CORS });
  });
  return state;
}

test('desde Más: buscar por nombre, solicitar amistad y verla pendiente', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fakeRpc(page);
  await page.goto('./#/mas');
  await page.getByRole('link', { name: /Amigos/ }).click();
  await expect(page.getByRole('heading', { name: 'Amigos', level: 1 })).toBeVisible();
  await page.getByLabel('Nombre o usuario').fill('Ana');
  await page.getByRole('search').getByRole('button', { name: 'Buscar' }).click();
  await page.getByRole('button', { name: 'Solicitar amistad a Ana Ruta' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Ana Ruta' }).getByText('Pendiente')).toBeVisible();
  expect(state.requested).toEqual([{ target_id: 'p2' }]);
  await page.getByRole('button', { name: 'Amigos', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Solicitudes enviadas' })).toContainText('Ana Ruta');
});

test('sin zona, «Cerca de mí» lleva a indicarla', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeRpc(page, { locality: null });
  await page.goto('./#/amigos');
  await page.waitForResponse((r) => r.url().includes('/rpc/my_area'));
  await page.getByRole('button', { name: 'Cerca de mí: 25 km' }).click();
  await expect(page.getByText('Indica tu zona en Ajustes para buscar cerca.')).toBeVisible();
});

for (const width of [360, 430]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`capturas de Amigos a ${width} px en ${theme === 'light' ? 'claro' : 'oscuro'}`, async ({ page }) => {
      const tag = `${width}-${theme}`;
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((t) => localStorage.setItem('fbt-theme', t), theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const friends = [
        { friendship_id: 'f1', status: 'pending', direction: 'received', profile: RESULTS[1] },
        { friendship_id: 'f2', status: 'pending', direction: 'sent', profile: RESULTS[0] },
        { friendship_id: 'f3', status: 'accepted', direction: 'sent', profile: RESULTS[2] },
      ];
      await fakeRpc(page, { friends });
      await page.goto('./#/amigos');
      await page.getByRole('button', { name: 'Cerca de mí: 50 km' }).click();
      await expect(page.getByText(/a 23 km/)).toBeVisible();
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(await overflow()).toBe(0);
      await page.screenshot({ path: `${SHOTS}/amigos-buscar-${tag}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Amigos (1)' }).click();
      await expect(page.getByRole('region', { name: 'Tus amigos' })).toBeVisible();
      expect(await overflow()).toBe(0);
      await page.screenshot({ path: `${SHOTS}/amigos-lista-${tag}.png`, fullPage: true });
    });
  }
}

test('0 resultados y lista vacía, a 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await fakeRpc(page, { results: [] });
  await page.goto('./#/amigos');
  await page.getByLabel('Nombre o usuario').fill('Nadie');
  await page.getByRole('search').getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('Nadie se llama así.', { exact: false })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/amigos-sin-resultados-360.png`, fullPage: true });
  await page.getByRole('button', { name: 'Amigos', exact: true }).click();
  await expect(page.getByText('Todavía no tienes amigos. Busca a alguien por su nombre o cerca de ti.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/amigos-vacio-360.png`, fullPage: true });
});
