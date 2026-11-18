import { test, expect, type Page, TEST_USER_ID } from './accountFixture';

// «Me gusta» en retos y salidas compartidas, con datos sintéticos y sin llamadas a la nube real.
test.setTimeout(90_000);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const SHOTS = 'docs/design/2026-11-17-me-gusta';
const DAY = 86_400_000;
const ME = TEST_USER_ID;
const ANA = { id: '00000000-0000-0000-0000-000000000023', username: 'ana_ruta', display_name: 'Ana Ruta' };
const BEA = { id: '00000000-0000-0000-0000-000000000024', username: 'bea_explora', display_name: 'Bea Explora', riding_style: 'explorar', avatar_version: 0 };
const member = (p: { id: string; username: string; display_name: string }, status: string, score: number | null = null) => ({ ...p, status, accepted_at: null, score, updated_at: null });
const CHALLENGE = {
  id: 'c3', title: 'Collado de las Encinas', kind: 'distance', created_at: new Date(Date.now() - DAY).toISOString(), deadline: new Date(Date.now() + 6 * DAY).toISOString(), creator_id: ANA.id,
  target_value: null, distance_m: null, segment_key: null, status: 'active', winner_ids: [],
  members: [member(ANA, 'accepted', 42_000), member({ id: ME, username: 'fran', display_name: 'Fran' }, 'accepted', 38_500)],
};
const POST = (id: string, body: string) => ({
  id, author_id: BEA.id, body, visibility: 'everyone', created_at: '2026-11-15T09:30:00Z', author: BEA,
  ride: { activity_date: '2026-11-14', distance_m: 62_400, elev_gain_m: 1120, moving_time_s: 8700 },
});
const POSTS = [POST('p1', 'La última curva del puerto lo ha compensado todo.'), POST('p2', 'Hoy tocaba llegar un poco más lejos.')];
const LIKES: Record<string, { like_count: number; liked: boolean }> = { c3: { like_count: 4, liked: false }, p1: { like_count: 12, liked: true }, p2: { like_count: 0, liked: false } };

async function fake(page: Page) {
  const writes: { method: string; url: string; body: unknown }[] = [];
  await page.route('https://*.supabase.co/rest/v1/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const fn = url.pathname.split('/').pop();
    const json = (body: unknown) => r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (fn === 'likes') { writes.push({ method: req.method(), url: url.search, body: req.postDataJSON() }); return r.fulfill({ status: req.method() === 'POST' ? 201 : 204, headers: CORS }); }
    if (fn === 'list_likes') return json((req.postDataJSON() as { ids: string[] }).ids.map((id) => ({ object_id: id, ...(LIKES[id] ?? { like_count: 0, liked: false }) })));
    if (fn === 'profiles') {
      const id = (url.searchParams.get('id') ?? '').replace('eq.', '');
      return json(id === BEA.id ? { ...BEA, bio: 'Rutas nuevas y cero prisa.', stats_visibility: 'everyone' }
        : { id: ME, username: 'fran', display_name: 'Fran', stats_visibility: 'everyone', bio: 'Una bici y mil historias.', riding_style: 'fondo', avatar_version: 0 });
    }
    const offset = (req.postDataJSON() as { page_offset?: number } | null)?.page_offset ?? 0;
    if (fn === 'list_community_challenges') return json(offset ? [] : [CHALLENGE]);
    if (fn === 'get_community_challenge') return json(CHALLENGE);
    if (fn === 'list_community_notifications') return json([]);
    if (fn === 'list_friends') return json([{ friendship_id: 'f1', status: 'accepted', direction: 'sent', profile: { ...BEA, locality: 'Villa Prueba', distance_km: null } }]);
    if (fn === 'my_area') return json([{ locality: 'Villa Prueba', show_area: true }]);
    if (fn === 'list_profile_posts') return json((req.postDataJSON() as { target_id: string | null }).target_id === null ? POSTS : []);
    return r.fulfill({ status: 204, headers: CORS });
  });
  return writes;
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of [360, 390]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`me gusta en retos y salidas compartidas a ${width} px (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((t) => localStorage.setItem('fbt-theme', t), theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const writes = await fake(page);

      // Lista de retos: un único pedido de recuentos, objetivo táctil de 44 px y alternancia con vuelta.
      await page.goto('./#/retos');
      const like = page.getByRole('button', { name: 'Me gusta, 4' });
      await expect(like).toHaveAttribute('aria-pressed', 'false');
      const box = await like.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await like.click();
      const liked = page.getByRole('button', { name: 'Quitar me gusta, 5' });
      await expect(liked).toHaveAttribute('aria-pressed', 'true');
      // El botón cambia antes de que salga la petición: se espera a que llegue.
      await expect.poll(() => writes.at(-1)).toMatchObject({ method: 'POST', body: { user_id: ME, object_type: 'challenge', object_id: 'c3' } });
      expect(await overflow(page)).toBe(0);
      await page.screenshot({ path: `${SHOTS}/retos-${width}-${theme}.png` });
      await liked.click();
      await expect(page.getByRole('button', { name: 'Me gusta, 4' })).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => writes.at(-1)).toMatchObject({ method: 'DELETE' });
      expect(writes.at(-1)!.url).toContain('object_id=eq.c3');

      // Detalle del reto.
      await page.goto('./#/retos/comunidad/c3');
      await expect(page.getByRole('button', { name: 'Me gusta, 4' })).toBeVisible();
      expect(await overflow(page)).toBe(0);
      await page.screenshot({ path: `${SHOTS}/reto-detalle-${width}-${theme}.png` });

      // Salidas compartidas de los amigos.
      await page.goto('./#/perfil');
      await page.getByRole('button', { name: 'Mi grupeta', exact: true }).click();
      const first = page.getByRole('article', { name: 'Publicación de Bea Explora' }).first();
      await expect(first.getByRole('button', { name: 'Quitar me gusta, 12' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'Me gusta', exact: true })).toBeVisible();
      expect(await overflow(page)).toBe(0);
      await first.getByRole('button', { name: 'Quitar me gusta, 12' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/salidas-${width}-${theme}.png` });
    });
  }
}
