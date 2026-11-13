import { test, expect, TEST_USER_ID, type Page } from './accountFixture';
import { seed, ride, settings } from './seed';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const FRIEND_ID = '00000000-0000-0000-0000-000000000022';
const owner = { id: TEST_USER_ID, username: 'ana_ruta', display_name: 'Ana del Puerto', bio: 'Me gustan las carreteras pequeñas, las subidas largas y el café de después. La bici es mi forma de descubrir.', riding_style: 'subir', avatar_version: 1, stats_visibility: 'friends' };
const friend = { id: FRIEND_ID, username: 'bea_explora', display_name: 'Bea Explora', bio: 'Rutas nuevas, buenas conversaciones y cero prisa.', riding_style: 'explorar', avatar_version: 1, stats_visibility: 'everyone' };
function post(id: string, author = owner, body = 'Hoy no tocaba ir más rápido. Tocaba llegar un poco más lejos. La última curva del puerto lo ha compensado todo.') {
  return { id, author_id: author.id, author, body, created_at: '2026-11-05T09:30:00Z', visibility: 'friends', ride: { activity_date: '2026-11-04', distance_m: 62400, elev_gain_m: 1120, moving_time_s: 8700 } };
}
async function fixture(page: Page) {
  const photos = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 320;
    const ctx = c.getContext('2d')!; const g = ctx.createLinearGradient(0, 0, 320, 320);
    g.addColorStop(0, '#233B30'); g.addColorStop(1, '#80B4F5'); ctx.fillStyle = g; ctx.fillRect(0, 0, 320, 320);
    ctx.fillStyle = '#E5EDDF'; ctx.font = 'bold 160px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('A', 160, 220);
    return { png: c.toDataURL('image/png').split(',')[1], webp: c.toDataURL('image/webp').split(',')[1] };
  });
  const state = { profile: { ...owner }, rows: [post('p1'), post('p2', friend, 'Nos hemos encontrado en la cima. Al final, la mejor parte de la ruta era la compañía.')], published: [] as Record<string, unknown>[], uploads: [] as { webp: boolean; bytes: number }[] };
  await page.route('https://*.supabase.co/rest/v1/**', async r => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const fn = new URL(req.url()).pathname.split('/').pop();
    let json: unknown = [];
    if (fn === 'profiles') {
      if (req.method() === 'PATCH') { Object.assign(state.profile, req.postDataJSON()); json = { id: TEST_USER_ID }; }
      else json = new URL(req.url()).searchParams.get('id')?.includes(FRIEND_ID) ? friend : state.profile;
    }
    if (fn === 'my_area') json = [{ locality: 'Villa Prueba', show_area: true }];
    if (fn === 'list_friends') json = [{ friendship_id: 'f1', status: 'accepted', direction: 'sent', profile: { ...friend, locality: 'Villa Prueba', distance_km: null } }];
    if (fn === 'list_profile_posts') { const target = req.postDataJSON().target_id; json = state.rows.filter(p => !target || p.author_id === target).map(p => ({ ...p, author: p.author_id === TEST_USER_ID ? state.profile : friend })); }
    if (fn === 'create_profile_post') {
      const body = req.postDataJSON(); state.published.push(body);
      state.rows.unshift({ ...post('new'), ...body, author: state.profile }); json = 'new';
    }
    if (fn === 'delete_profile_post') { state.rows = state.rows.filter(p => p.id !== req.postDataJSON().post_id); json = null; }
    return r.fulfill({ headers: CORS, json });
  });
  await page.route('https://*.supabase.co/storage/v1/**', async r => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (req.method() === 'POST') {
      const bytes = req.postDataBuffer();
      state.uploads.push({ webp: (req.headers()['content-type'] ?? '').includes('image/webp') || (bytes?.toString('latin1').includes('image/webp') ?? false), bytes: bytes?.length ?? 0 });
      return r.fulfill({ headers: CORS, json: { Key: `${TEST_USER_ID}/avatar.webp` } });
    }
    if (req.method() === 'DELETE') return r.fulfill({ headers: CORS, json: [] });
    return r.fulfill({ headers: CORS, contentType: 'image/webp', body: Buffer.from(photos.webp, 'base64') });
  });
  return { state, photos };
}

test('biografía, estilo, foto y cuaderno de amigos funcionan juntos', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { state, photos } = await fixture(page);
  await seed(page, { activities: [ride('s1', 2, 'Salida sintética privada', 42)], settings: settings() });
  await page.goto('./#/perfil');
  await expect(page.getByRole('region', { name: 'Tu identidad pública' }).getByAltText('Foto de Ana del Puerto')).toBeVisible();
  await page.getByRole('button', { name: 'Editar perfil', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Editar perfil' });
  await edit.getByLabel('Sobre ti').fill('La bici, los puertos y un buen café.');
  await edit.getByLabel('Nombre de usuario').fill('ana_lagrupeta');
  await edit.getByRole('radio', { name: 'Grupeta' }).check();
  await edit.getByRole('button', { name: 'Guardar perfil' }).click();
  await expect(page.getByRole('region', { name: 'Tu identidad pública' }).getByText('La bici, los puertos y un buen café.', { exact: true })).toBeVisible();
  expect(state.profile.riding_style).toBe('grupo');
  await expect(page.getByRole('article', { name: 'Publicación de Ana del Puerto' })).toContainText('@ana_lagrupeta');
  await page.getByLabel('Archivo de foto de perfil').setInputFiles({ name: 'foto-sintetica.png', mimeType: 'image/png', buffer: Buffer.from(photos.png, 'base64') });
  await expect(page.getByText('Foto de perfil guardada.', { exact: true })).toBeVisible();
  expect(state.uploads).toHaveLength(1); expect(state.uploads[0].webp).toBe(true); expect(state.uploads[0].bytes).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Mi grupeta', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Publicación de Bea Explora' })).toBeVisible();
  await page.getByRole('link', { name: 'Ver perfil de Bea Explora' }).click();
  await expect(page.getByRole('region', { name: 'Identidad del ciclista' })).toContainText(friend.bio);
  await expect(page.getByRole('region', { name: 'Cuaderno de ruta' })).toContainText('Nos hemos encontrado en la cima');
});

test('publicación explícita comparte cifras y se puede borrar', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const { state } = await fixture(page);
  await seed(page, { activities: [ride('s1', 2, 'Salida sintética privada', 42)], settings: settings() });
  await page.goto('./#/perfil');
  await page.getByRole('button', { name: 'Escribir en mi cuaderno' }).click();
  await page.getByLabel('¿Qué te llevas de la ruta?').fill('Mi primer cuaderno, sin compartir mi mapa.');
  await page.getByRole('button', { name: 'Añadir cifras de una salida' }).click();
  await page.getByLabel('Salida que quieres compartir').selectOption('s1');
  await expect(page.getByText('Compartes las cifras, nunca el mapa.')).toBeVisible();
  expect(state.published).toHaveLength(0);
  await page.getByRole('button', { name: 'Publicar en mi cuaderno' }).click();
  const card = page.getByRole('article').filter({ hasText: 'Mi primer cuaderno' });
  await expect(card).toBeVisible();
  expect(state.published).toEqual([{ body: 'Mi primer cuaderno, sin compartir mi mapa.', visibility: 'friends', ride: { activity_date: '2026-11-04', distance_m: 42000, moving_time_s: 5600, elev_gain_m: 600 } }]);
  await card.getByRole('button', { name: 'Borrar publicación' }).click();
  await card.getByRole('button', { name: 'Sí, borrar' }).click();
  await expect(card).toHaveCount(0);
});

for (const [width, height] of [[360, 780], [390, 844], [412, 915], [430, 932], [844, 390], [1280, 900], [1440, 1000]]) for (const theme of ['light', 'dark'] as const) {
  test(`cuaderno visual ${width}x${height} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(t => localStorage.setItem('fbt-theme', t), theme);
    await fixture(page); await seed(page, { activities: [ride('s1', 2, 'Salida sintética privada', 62.4)], settings: settings() });
    await page.goto('./#/perfil');
    await expect(page.getByRole('article', { name: 'Publicación de Ana del Puerto' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Tu identidad pública' }).getByAltText('Foto de Ana del Puerto')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await page.screenshot({ path: `test-results/cuaderno/perfil-${width}-${theme}.png`, fullPage: true });
    if (width === 360 || width === 1440) {
      await page.getByRole('button', { name: 'Editar perfil', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Editar perfil' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await page.screenshot({ path: `test-results/cuaderno/editor-${width}-${theme}.png`, fullPage: true });
    }
  });
}
