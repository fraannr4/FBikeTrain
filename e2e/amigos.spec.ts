import { test, expect, type Page } from './accountFixture';

// Amigos dentro del perfil, con las RPC simuladas. Nombres sintéticos, también los extremos (largos y sin espacios).
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
    if (fn === 'search_profiles_near') {
      if (opts.locality === null) return r.fulfill({ status: 400, headers: CORS, contentType: 'application/json', body: JSON.stringify({ message: 'Sin zona configurada' }) });
      return json((opts.results ?? RESULTS).map((c, i) => ({ ...(c as object), distance_km: [5, 25, 50][i % 3] })));
    }
    if (fn === 'list_cyclists') return json((opts.results ?? RESULTS).map((c) => ({ ...(c as object), bio: '', riding_style: 'grupo', avatar_version: 0, last_active_at: null })));
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

test('el enlace antiguo lleva a Amigos dentro del perfil y una sugerencia se añade', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fakeRpc(page);
  await page.goto('./#/amigos?vista=amigos');
  await expect(page).toHaveURL(/#\/perfil\/amigos$/);
  await expect(page.getByRole('heading', { name: 'Gente', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Partes de Gente' }).getByRole('link', { name: 'Amigos', exact: true })).toHaveAttribute('aria-current', 'page');
  const suggestions = page.getByRole('region', { name: 'Sugerencias' });
  await suggestions.getByRole('button', { name: 'Añadir a Ana Ruta' }).click();
  await expect(suggestions.getByRole('listitem').filter({ hasText: 'Ana Ruta' }).getByText('Solicitud enviada')).toBeVisible();
  expect(state.requested).toEqual([{ target_id: 'p2' }]);
  await expect(page.getByRole('region', { name: 'Solicitudes enviadas' })).toContainText('Ana Ruta');
});

test('sin zona, las sugerencias son ciclistas activos y explican cómo ver los cercanos', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeRpc(page, { locality: null });
  await page.goto('./#/perfil/amigos');
  const suggestions = page.getByRole('region', { name: 'Sugerencias' });
  await expect(suggestions.getByRole('link', { name: 'Indicar mi zona' })).toHaveAttribute('href', '#/ajustes?abrir=zona');
  await expect(suggestions.getByText('Ana Ruta')).toBeVisible();
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
      await fakeRpc(page, { friends, results: [...RESULTS, card('p5', 'Carla Cumbre', 'carla', 'Villa Norte')] });
      await page.goto('./#/perfil/amigos');
      await expect(page.getByRole('region', { name: 'Solicitudes recibidas' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Sugerencias' }).getByText('Carla Cumbre')).toBeVisible();
      // Cada amigo: «Escribir» y «Retar» a la derecha del nombre, también a 360 px. «Quitar» está en su perfil.
      const row = page.getByRole('region', { name: 'Tus amigos' }).getByRole('listitem').first();
      const name = await row.getByRole('link', { name: 'Bea', exact: true }).boundingBox();
      const write = await row.getByRole('button', { name: 'Escribir a Bea' }).boundingBox();
      await expect(row.getByRole('link', { name: 'Retar a Bea' })).toBeVisible();
      expect(write!.x).toBeGreaterThanOrEqual(name!.x + name!.width);
      expect(write!.height).toBeGreaterThanOrEqual(44);
      await expect(page.getByRole('button', { name: /^Quitar/ })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await page.screenshot({ path: `${SHOTS}/amigos-lista-${tag}.png`, fullPage: true });
    });
  }
}

test('lista vacía, a 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await fakeRpc(page, { results: [] });
  await page.goto('./#/perfil/amigos');
  await expect(page.getByText('Todavía no tienes amigos.')).toBeVisible();
  await expect(page.getByText('Sin sugerencias por ahora.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/amigos-vacio-360.png`, fullPage: true });
});
