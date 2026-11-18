import { test, expect, type Page, TEST_USER_ID } from './accountFixture';

// Perfil, Retos y Amigos en móvil: plazo y ventaja a la vista, respuesta instantánea, compartir perfil,
// confirmación al quitar amigos y objetivos táctiles de 44 px. Datos sintéticos; capturas a 390 px.
test.setTimeout(90_000);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const SHOTS = 'docs/design/2026-11-16-perfil-retos-amigos';
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
  challenge('c3', 'Collado de las Encinas', people.ana.id, [member(people.ana, 'accepted', 42_000), me('accepted', 38_500)]),
  challenge('c4', 'Noviembre en llano', ME, [me('accepted', 90_000), member(people.pablo, 'accepted', 80_000)], { status: 'finished', winner_ids: [ME] }),
];
const card = (p: { id: string; username: string; display_name: string }, locality: string | null = null, distance_km: number | null = null) => ({ ...p, locality, distance_km });

async function fake(page: Page) {
  const calls: string[] = [];
  let friends = [
    { friendship_id: 'f1', status: 'pending', direction: 'received', profile: card(people.pablo, 'Villa Norte') },
    { friendship_id: 'f2', status: 'accepted', direction: 'sent', profile: card(people.ana, 'Villa Prueba') },
  ];
  await page.route('https://*.supabase.co/rest/v1/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const fn = url.pathname.split('/').pop() ?? '';
    calls.push(fn);
    const json = (body: unknown) => r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (fn === 'profiles') return json({ id: ME, username: 'fran', display_name: 'Fran', stats_visibility: 'friends', bio: 'Una bici y mil historias por descubrir.', riding_style: 'fondo', avatar_version: 0 });
    const offset = (req.postDataJSON() as { page_offset?: number } | null)?.page_offset ?? 0;
    if (fn === 'list_community_challenges') return json(offset ? [] : CHALLENGES);
    if (fn === 'list_community_notifications') return json([]);
    if (fn === 'list_friends') return json(friends);
    if (fn === 'accept_friendship') { friends = friends.map(f => f.friendship_id === (req.postDataJSON() as { request_id: string }).request_id ? { ...f, status: 'accepted' } : f); return r.fulfill({ status: 204, headers: CORS }); }
    if (fn === 'request_friendship') { const target = (req.postDataJSON() as { target_id: string }).target_id; friends = [...friends, { friendship_id: 'f-new', status: 'pending', direction: 'sent', profile: card(Object.values(people).find(p => p.id === target)!) }]; return r.fulfill({ status: 204, headers: CORS }); }
    if (fn === 'get_community_challenge') return json(CHALLENGES[1]);
    if (fn === 'search_profiles_near') return json([card(people.jordi, 'Villa Centro', 10)]);
    if (fn === 'list_cyclists') return json([{ ...card(people.jordi), bio: '', riding_style: 'grupo', avatar_version: 0, last_active_at: new Date().toISOString() }, { ...card(people.marta), bio: '', riding_style: 'subir', avatar_version: 0, last_active_at: null }]);
    if (fn === 'list_profile_posts') return json([]);
    return r.fulfill({ status: 204, headers: CORS });
  });
  return calls;
}
async function prepare(page: Page, theme: 'light' | 'dark' = 'light') {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((t) => localStorage.setItem('fbt-theme', t), theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Controles visibles de menos de 44 px en alguno de los dos ejes (los enlaces dentro de un párrafo quedan fuera). */
const smallTargets = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  let total = 0;
  for (const el of document.querySelectorAll<HTMLElement>('main a[href], main button, main summary, main input:not([type=file]):not([type=radio]), main select, main textarea')) {
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height || getComputedStyle(el).visibility === 'hidden') continue;
    if (el.closest('.sr-only')) continue;
    total++;
    if (el.tagName === 'A' && el.closest('p, li > span, small') && getComputedStyle(el).display === 'inline') continue;
    if (box.height < 43.5 || box.width < 43.5) out.push(`${el.tagName.toLowerCase()} «${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}» ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  return { total, small: out };
});

test('Retos: plazo, ventaja y respuesta instantánea al aceptar', async ({ page }) => {
  await prepare(page);
  await fake(page);
  await page.goto('./#/retos');
  const active = page.getByRole('link', { name: /Collado de las Encinas/ });
  await expect(active.getByText('Quedan 5 días')).toBeVisible();
  await expect(active.getByText('Ana Ruta te saca 3,5 km')).toBeVisible();
  expect(await overflow(page)).toBe(0);
  await page.screenshot({ path: `${SHOTS}/retos-390.png`, fullPage: true });
  await page.getByRole('button', { name: 'Aceptar reto «Vuelta del embalse»' }).click();
  await expect(page.getByRole('article', { name: /Marta te reta/ })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Reto aceptado' })).toBeVisible();
  await page.getByRole('button', { name: 'Historial' }).click();
  await expect(page.getByText('Gana tú')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/retos-historial-390.png`, fullPage: true });
});

test('Detalle del reto: ventaja y plazo en la cabecera', async ({ page }) => {
  await prepare(page, 'dark');
  await fake(page);
  await page.goto('./#/retos/comunidad/c3');
  await expect(page.getByText('Quedan 5 días')).toBeVisible();
  await expect(page.getByText('Ana Ruta te saca 3,5 km')).toBeVisible();
  expect(await overflow(page)).toBe(0);
  await page.screenshot({ path: `${SHOTS}/reto-detalle-390-dark.png`, fullPage: true });
});

test('Perfil: cifras estables, compartir enlace y radios de la hoja de edición', async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: async (d: unknown) => { (window as unknown as { shared: unknown }).shared = d; } }); });
  await fake(page);
  await page.goto('./#/perfil');
  await expect(page.getByRole('list', { name: 'Tus cifras' })).toBeVisible();
  const share = page.getByRole('button', { name: 'Compartir perfil' });
  await expect(share).toBeVisible();
  expect(await overflow(page)).toBe(0);
  await page.screenshot({ path: `${SHOTS}/perfil-390.png` });
  await share.click();
  const shared = await page.evaluate(() => (window as unknown as { shared: { url: string } }).shared);
  expect(shared.url).toMatch(/#\/personas\/00000000-0000-0000-0000-000000000011$/);

  await page.getByRole('button', { name: 'Editar perfil' }).click();
  const radio = page.getByRole('radio').first();
  const radioBox = await radio.boundingBox();
  expect(radioBox!.width).toBeLessThanOrEqual(24);
  const modeBox = await page.locator('.profile-mode').first().boundingBox();
  expect(modeBox!.height).toBeLessThanOrEqual(64);
  expect(modeBox!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `${SHOTS}/perfil-editar-390.png` });
});

test('Amigos: quitar pide confirmación; aceptar es instantáneo', async ({ page }) => {
  await prepare(page);
  const calls = await fake(page);
  await page.goto('./#/perfil/amigos');
  await page.getByRole('button', { name: 'Quitar a Ana Ruta' }).click();
  await expect(page.getByRole('button', { name: 'Quitar definitivamente a Ana Ruta' })).toBeVisible();
  expect(await overflow(page)).toBe(0);
  await page.screenshot({ path: `${SHOTS}/amigos-confirmar-390.png`, fullPage: true });
  await page.getByRole('button', { name: 'Mantener a Ana Ruta' }).click();
  expect(calls).not.toContain('remove_friendship');
  await page.getByRole('button', { name: 'Aceptar a Pablo' }).click();
  await expect(page.getByRole('region', { name: 'Solicitudes recibidas' })).toHaveCount(0);
  await expect(page.getByText('Ahora eres amigo de Pablo.')).toBeVisible();
});

test('Ciclistas: la solicitud cambia al tocar', async ({ page }) => {
  await prepare(page);
  await fake(page);
  await page.goto('./#/ciclistas');
  await page.getByRole('button', { name: 'Solicitar amistad a Jordi' }).click();
  await expect(page.getByLabel('Solicitud enviada').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/ciclistas-390.png`, fullPage: true });
});

for (const [name, hash] of [['Retos', '#/retos'], ['Perfil', '#/perfil'], ['Amigos', '#/perfil/amigos'], ['Ciclistas', '#/ciclistas'], ['Detalle del reto', '#/retos/comunidad/c3']] as const) {
  test(`objetivos táctiles de 44 px en ${name}`, async ({ page }) => {
    await prepare(page);
    await fake(page);
    await page.goto(`./${hash}`);
    // La pantalla baja en su propio chunk: se espera a que pinte, no un tiempo fijo.
    await expect.poll(async () => (await smallTargets(page)).total).toBeGreaterThan(3);
    await page.waitForTimeout(700);
    expect((await smallTargets(page)).small).toEqual([]);
  });
}
