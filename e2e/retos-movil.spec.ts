import { test, expect, type Page, TEST_USER_ID } from './accountFixture';

// Opción 2 «Pestaña Retos» y amigos en el perfil, con datos sintéticos. Capturas para el diseño.
test.setTimeout(90_000);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const SHOTS = 'docs/design/2026-11-17-retos-movil/implementado';
const DAY = 86_400_000;
const ME = TEST_USER_ID;
const people = {
  marta: { id: '00000000-0000-0000-0000-000000000021', username: 'marta_sierra', display_name: 'Marta' },
  jordi: { id: '00000000-0000-0000-0000-000000000022', username: 'jordi_llano', display_name: 'Jordi' },
  ana: { id: '00000000-0000-0000-0000-000000000023', username: 'ana_ruta', display_name: 'Ana Ruta' },
  pablo: { id: '00000000-0000-0000-0000-000000000024', username: 'pablo_puerto', display_name: 'Pablo' },
};
const member = (p: { id: string; username: string; display_name: string }, status: string, score: number | null = null) => ({ ...p, status, accepted_at: null, score, updated_at: null });
const me = (status: string, score: number | null = null) => member({ id: ME, username: 'fran', display_name: 'Fran' }, status, score);
const challenge = (id: string, title: string, creator: string, members: unknown[], over: Record<string, unknown> = {}) => ({
  id, title, kind: 'distance', created_at: new Date(Date.now() - DAY).toISOString(), deadline: new Date(Date.now() + 6 * DAY).toISOString(), creator_id: creator,
  target_value: null, distance_m: null, segment_key: null, status: 'active', members, winner_ids: [], ...over,
});
const CHALLENGES = [
  challenge('c1', 'Vuelta del embalse', people.marta.id, [member(people.marta, 'accepted'), me('pending')]),
  challenge('c2', 'Puerto de la Morcuera', ME, [me('accepted'), member(people.jordi, 'pending')]),
  challenge('c3', 'Collado de las Encinas', people.ana.id, [member(people.ana, 'accepted', 42_000), me('accepted', 38_500)]),
  challenge('c4', 'Noviembre en llano', ME, [me('accepted', 90_000), member(people.pablo, 'accepted', 80_000)], { status: 'finished', winner_ids: [ME] }),
];
const card = (p: { id: string; username: string; display_name: string }, locality: string | null = null, distance_km: number | null = null) => ({ ...p, locality, distance_km });

async function fake(page: Page, opts: { challenges?: unknown[] } = {}) {
  await page.route('https://*.supabase.co/rest/v1/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const fn = url.pathname.split('/').pop();
    const json = (body: unknown) => r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (fn === 'profiles') {
      const id = (url.searchParams.get('id') ?? '').replace('eq.', '');
      const other = Object.values(people).find((p) => p.id === id);
      return json(other ? { ...other, bio: 'Puertos al amanecer y café en la cima.', riding_style: 'subir', avatar_version: 0 }
        : { id: ME, username: 'fran', display_name: 'Fran', stats_visibility: 'friends', bio: 'Una bici y mil historias por descubrir.', riding_style: 'fondo', avatar_version: 0 });
    }
    const offset = (req.postDataJSON() as { page_offset?: number } | null)?.page_offset ?? 0;
    if (fn === 'list_community_challenges') return json(offset ? [] : (opts.challenges ?? CHALLENGES));
    if (fn === 'list_community_notifications') return json([{ id: 'n1', kind: 'invitation', challenge_id: 'c1', actor_id: people.marta.id, created_at: new Date().toISOString(), read_at: null }]);
    if (fn === 'list_friends') return json([
      { friendship_id: 'f1', status: 'pending', direction: 'received', profile: card(people.pablo, 'Villa Norte') },
      { friendship_id: 'f2', status: 'accepted', direction: 'sent', profile: card(people.ana, 'Villa Prueba') },
      { friendship_id: 'f3', status: 'accepted', direction: 'received', profile: card(people.marta) },
    ]);
    if (fn === 'search_profiles_near') return json([card(people.jordi, 'Villa Centro', 10), card(people.ana, 'Villa Prueba', 25)]);
    if (fn === 'list_cyclists') return json([{ ...card(people.jordi), bio: '', riding_style: 'grupo', avatar_version: 0, last_active_at: null }]);
    if (fn === 'list_profile_posts') return json([]);
    return r.fulfill({ status: 204, headers: CORS });
  });
}

async function prepare(page: Page, width: number, height: number, theme: 'light' | 'dark') {
  await page.setViewportSize({ width, height });
  await page.addInitScript((t) => localStorage.setItem('fbt-theme', t), theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const theme of ['light', 'dark'] as const) {
  test(`móvil 390: pestaña Retos, perfil y amigos (${theme})`, async ({ page }) => {
    await prepare(page, 390, 844, theme);
    await fake(page);
    await page.goto('./#/retos');
    const nav = page.getByRole('navigation', { name: 'Menú principal' });
    await expect(nav.getByRole('link', { name: 'Retos, 1 pendiente' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('region', { name: '¿A quién retas?' }).getByRole('link', { name: 'Marta: te reta' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Marta te reta: Vuelta del embalse' })).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await page.screenshot({ path: `${SHOTS}/retos-390-${theme}.png` });

    await page.getByRole('link', { name: 'Tu perfil', exact: true }).click();
    const stats = page.getByRole('list', { name: 'Tus cifras' });
    await expect(stats.getByRole('link', { name: '2 amigos, 1 solicitud pendiente' })).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await page.screenshot({ path: `${SHOTS}/perfil-390-${theme}.png` });

    await stats.getByRole('link', { name: /amigos/ }).click();
    await expect(page.getByRole('region', { name: 'Solicitudes recibidas' })).toContainText('Pablo');
    await expect(page.getByRole('region', { name: 'Sugerencias' })).toContainText('Jordi');
    expect(await overflow(page)).toBe(0);
    await page.screenshot({ path: `${SHOTS}/amigos-390-${theme}.png`, fullPage: true });

    await page.goto(`./#/personas/${people.ana.id}`);
    await expect(page.getByRole('button', { name: 'Amigos' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Retar a Ana Ruta' })).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await page.screenshot({ path: `${SHOTS}/persona-390-${theme}.png` });
  });

  test(`móvil 390: Retos vacío con sugerencias (${theme})`, async ({ page }) => {
    await prepare(page, 390, 844, theme);
    await fake(page, { challenges: [] });
    await page.goto('./#/retos');
    await expect(page.getByRole('heading', { name: 'Aún no tienes retos en juego' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Retar a Ana Ruta' })).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await page.screenshot({ path: `${SHOTS}/retos-vacio-390-${theme}.png` });
  });

  test(`PC 1280: carril con badge en Retos (${theme})`, async ({ page }) => {
    await prepare(page, 1280, 800, theme);
    await fake(page);
    await page.goto('./#/retos');
    const group = page.getByRole('group', { name: 'Comunidad' });
    await expect(group.getByRole('link', { name: 'Retos, 1 pendiente' })).toHaveAttribute('aria-current', 'page');
    await expect(group.getByRole('link', { name: 'Tu perfil', exact: true })).toBeVisible();
    // En PC el perfil está en el carril: la foto de la cabecera no se repite.
    await expect(page.locator('.appbar-profile')).toBeHidden();
    expect(await overflow(page)).toBe(0);
    await page.screenshot({ path: `${SHOTS}/retos-1280-${theme}.png` });
  });
}
