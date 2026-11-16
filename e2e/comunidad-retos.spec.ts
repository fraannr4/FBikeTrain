import { test, expect, TEST_USER_ID, type Page } from './accountFixture';
import type { CommunityChallenge } from '../src/social/communityChallenges';

test.setTimeout(60_000);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const SHOTS = 'test-results/comunidad-retos';
const OTHER = '00000000-0000-0000-0000-000000000022';
const THIRD = '00000000-0000-0000-0000-000000000033';
const LONG = 'Maximiliana de los Santos Inocentes Bermúdez-Villalobos';
const cyclist = (id: string, display_name: string) => ({ id, display_name, username: `ciclista_${id.slice(-2)}`, bio: '', riding_style: 'explorar', avatar_version: 0, locality: null, distance_km: null, last_active_at: null });
function challenge(over: Partial<CommunityChallenge> = {}): CommunityChallenge {
  return {
    id: 'c1', title: '+100 km esta semana', kind: 'distance', created_at: '2026-11-01T08:00:00Z', deadline: '2099-12-15T08:00:00Z', creator_id: OTHER, target_value: 100000, distance_m: null, segment_key: null, status: 'active', winner_ids: [],
    members: [
      { ...cyclist(TEST_USER_ID, 'Fran'), status: 'pending', accepted_at: null, score: null, updated_at: null },
      { ...cyclist(OTHER, LONG), status: 'accepted', accepted_at: '2026-11-01T08:00:00Z', score: 58000, updated_at: '2026-11-02T08:00:00Z' },
      { ...cyclist(THIRD, 'Ana Ruta'), status: 'accepted', accepted_at: '2026-11-01T08:00:00Z', score: 42000, updated_at: '2026-11-02T08:00:00Z' },
    ], ...over,
  };
}
async function mockCommunity(page: Page, initial = [challenge()]) {
  const state = { rows: initial, create: [] as Record<string, unknown>[], responses: [] as unknown[], read: [] as unknown[], score: [] as unknown[], page2: false };
  await page.route('https://*.supabase.co/rest/v1/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const name = url.pathname.split('/').pop();
    const args = req.postDataJSON() ?? {};
    const json = (body: unknown) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (name === 'my_area') return json([{ locality: 'Pueblo sintético', show_area: false }]);
    if (name === 'profiles') return json(cyclist(OTHER, LONG));
    if (name === 'list_cyclists') {
      if (args.page_offset === 50) { state.page2 = true; return json([cyclist(THIRD, 'Ana Ruta')]); }
      if (args.query_text) return json([cyclist(OTHER, LONG)].filter(p => p.display_name.toLowerCase().includes(args.query_text.toLowerCase())));
      return json([cyclist(OTHER, LONG), ...Array.from({ length: 49 }, (_, i) => cyclist(`synthetic-${i}`, `Ciclista de prueba ${i}`))]);
    }
    if (name === 'list_community_challenges') return json(args.page_offset ? [] : state.rows);
    if (name === 'get_community_challenge') return json(state.rows.find(c => c.id === args.challenge_id) ?? null);
    if (name === 'list_community_notifications') return json([{ id: 'n1', kind: 'invitation', challenge_id: 'c1', actor_id: OTHER, created_at: '2026-11-02T08:00:00Z', read_at: null }]);
    if (name === 'read_community_notification') { state.read.push(args); return json(null); }
    if (name === 'respond_community_challenge') {
      state.responses.push(args);
      state.rows = state.rows.map(c => c.id === args.challenge_id ? { ...c, members: c.members.map(m => m.id === TEST_USER_ID ? { ...m, status: args.accept ? 'accepted' : 'declined', accepted_at: args.accept ? new Date().toISOString() : null } : m) } : c);
      return json(null);
    }
    if (name === 'create_community_challenge') {
      state.create.push(args); state.rows.push(challenge({ ...args, id: 'created', creator_id: TEST_USER_ID })); return json('created');
    }
    if (name === 'submit_community_score') {
      state.score.push(args);
      state.rows = state.rows.map(c => c.id === args.challenge_id ? { ...c, members: c.members.map(m => m.id === TEST_USER_ID ? { ...m, score: args.score, updated_at: new Date().toISOString() } : m) } : c);
      return json(null);
    }
    return json([]);
  });
  return state;
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('un dispositivo vacío conserva el marcador remoto y solo lo reemplaza con la acción explícita', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const remote = challenge();
  remote.members[0] = { ...remote.members[0], status: 'accepted', accepted_at: '2026-11-01T08:00:00Z', score: 50000, updated_at: '2026-11-02T08:00:00Z' };
  const state = await mockCommunity(page, [remote]);
  await page.goto('./#/retos/comunidad/c1');
  await page.getByText('Cambiar de dispositivo', { exact: true }).click();
  const replace = page.getByRole('button', { name: 'Usar las salidas de este dispositivo' });
  await expect(replace).toBeEnabled();
  await expect(page.getByText('Reemplaza tu marcador por las salidas guardadas aquí, incluso si está vacío. Úsalo solo si has cambiado de dispositivo.')).toBeVisible();
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(replace).toBeEnabled();
  expect(state.score).toEqual([]);
  await replace.click();
  await expect.poll(() => state.score).toEqual([{ challenge_id: 'c1', score: 0 }]);
  await expect(replace).toBeEnabled();
});

test('aceptar una invitación de grupo, consultar marcador y leer su aviso a 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await mockCommunity(page);
  await page.goto('./#/retos');
  await page.getByRole('link', { name: /Te han retado/ }).click();
  await expect(page.getByRole('heading', { name: '¿Te apuntas?' })).toBeVisible();
  await page.getByRole('button', { name: 'Aceptar reto' }).click();
  await expect(page.getByRole('heading', { name: '¿Te apuntas?' })).toBeHidden();
  expect(state.responses).toEqual([{ challenge_id: 'c1', accept: true }]);
  await expect(page.getByRole('region', { name: 'Marcador del reto' }).getByRole('listitem')).toHaveCount(3);
  await expect(page.getByText('58 km', { exact: true })).toBeVisible();
  expect(await overflow(page)).toBe(0);
  await page.goto('./#/retos');
  await page.getByRole('button', { name: /Avisos/ }).click();
  await expect(page.getByText('Te han invitado a un reto')).toBeVisible();
  await page.getByRole('button', { name: 'Marcar leído' }).click();
  await expect(page.getByRole('button', { name: 'Marcar leído' })).toBeHidden();
  expect(state.read).toContainEqual({ notification_id: 'n1' });
  await page.screenshot({ path: `${SHOTS}/avisos-390.png`, fullPage: true });
});

test('rechazar no comparte cifras y un detalle ausente muestra estado útil', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await mockCommunity(page);
  await page.goto('./#/retos/comunidad/c1');
  await page.getByRole('button', { name: 'Rechazar', exact: true }).click();
  await expect(page.getByText('Has rechazado este reto.')).toBeVisible();
  expect(state.responses).toEqual([{ challenge_id: 'c1', accept: false }]);
  expect(state.score).toEqual([]);
  await page.goto('./#/retos/comunidad/no-existe');
  await expect(page.getByRole('heading', { name: 'Reto no disponible' })).toBeVisible();
});

test('plantilla, búsqueda y paginación permiten crear un grupo con cualquier ciclista', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await mockCommunity(page);
  await page.goto('./#/retos/nuevo?plantilla=100km');
  await expect(page.getByLabel('Nombre del reto')).toHaveValue('+100 km esta semana');
  await expect(page.getByLabel('Objetivo (km, opcional)')).toHaveValue('100');
  await page.getByRole('button', { name: 'Grupo', exact: true }).click();
  await page.getByLabel(new RegExp(LONG)).check();
  await page.getByRole('button', { name: 'Más ciclistas' }).click();
  await page.getByLabel(/Ana Ruta/).check();
  await page.getByRole('button', { name: 'Lanzar reto de grupo' }).click();
  await expect(page).toHaveURL(/retos\/comunidad\/created/);
  expect(state.page2).toBe(true);
  expect(state.create).toEqual([{ title: '+100 km esta semana', kind: 'distance', duration_days: 7, invited_ids: [OTHER, THIRD], target_value: 100000, distance_m: null, segment_key: null }]);
});

test('mejor media define una distancia y no envía geometría; duración fuera de rango se bloquea', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await mockCommunity(page);
  await page.goto('./#/retos/nuevo');
  await page.getByLabel('Nombre del reto').fill('Diez kilómetros con todo');
  await page.getByLabel('Tipo de reto').selectOption('speed');
  await page.getByLabel('Distancia de la mejor media (km)').fill('10');
  await page.getByLabel('Objetivo (km/h, opcional)').fill('36');
  await page.getByLabel(new RegExp(LONG)).check();
  await page.getByLabel('Duración (días)').fill('31');
  await page.getByRole('button', { name: 'Lanzar duelo' }).click();
  expect(state.create).toHaveLength(0);
  await page.getByLabel('Duración (días)').fill('1');
  await page.getByRole('button', { name: 'Lanzar duelo' }).click();
  await expect(page).toHaveURL(/retos\/comunidad\/created/);
  expect(state.create[0]).toMatchObject({ kind: 'speed', duration_days: 1, target_value: 10, distance_m: 10000, segment_key: null });
  expect(Object.keys(state.create[0]).sort()).toEqual(['distance_m', 'duration_days', 'invited_ids', 'kind', 'segment_key', 'target_value', 'title']);
});

test('la plantilla de desnivel tiene un objetivo válido y se puede lanzar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await mockCommunity(page);
  await page.goto('./#/retos/nuevo');
  await page.getByRole('button', { name: '1.000 m', exact: true }).click();
  await expect(page.getByLabel('Objetivo (m, opcional)')).toHaveValue('1000');
  expect(await page.getByLabel('Objetivo (m, opcional)').evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(true);
  await page.getByLabel(new RegExp(LONG)).check();
  await page.getByRole('button', { name: 'Lanzar duelo' }).click();
  await expect(page).toHaveURL(/retos\/comunidad\/created/);
  expect(state.create[0]).toMatchObject({ kind: 'elevation', target_value: 1000, duration_days: 7 });
});

for (const width of [360, 390, 412, 430]) {
  for (const theme of ['light', 'dark']) {
    test(`capturas reales comunidad retos ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript(t => localStorage.setItem('fbt-theme', t), theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const tied = challenge({ id: 'tied', title: 'Un reto con un nombre muy largo para cruzar todos los puertos de la Sierra Ficticia en compañía', status: 'finished', deadline: '2026-11-02T08:00:00Z', winner_ids: [TEST_USER_ID, OTHER] });
      tied.members[0] = { ...tied.members[0], status: 'accepted', score: 58000, accepted_at: '2026-11-01T08:00:00Z', updated_at: '2026-11-02T08:00:00Z' };
      const duel = challenge({ id: 'duel', title: '¿Quién suma más kilómetros?' });
      duel.members = [
        { ...duel.members[0], status: 'accepted', score: 42000, accepted_at: '2026-11-01T08:00:00Z', updated_at: '2026-11-02T08:00:00Z' },
        { ...duel.members[1], display_name: 'Ana Ruiz' },
      ];
      await mockCommunity(page, [duel, challenge(), tied]);
      const tag = `${width}-${theme}`;
      await page.goto('./#/retos');
      await expect(page.getByRole('link', { name: /Te han retado/ })).toBeVisible();
      await expect(page.locator('.community-rival-entry')).toHaveCSS('display', 'flex');
      expect(await overflow(page)).toBe(0);
      await page.screenshot({ path: `${SHOTS}/lista-${tag}.png`, fullPage: true });
      if (width === 390) await page.screenshot({ path: `${SHOTS}/lista-${tag}-viewport.png` });
      await page.getByRole('button', { name: 'Historial', exact: true }).click();
      await expect(page.getByText(/Empate: tú/)).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/historial-${tag}.png`, fullPage: true });
      await page.goto('./#/retos/comunidad/tied');
      await expect(page.getByRole('heading', { name: 'Victoria compartida' })).toBeVisible();
      const scoreRow = page.locator('.community-score-row').first();
      await expect(scoreRow).toHaveCSS('display', 'grid');
      expect(await scoreRow.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(/\s+/).length)).toBe(width >= 430 ? 3 : 2);
      expect(await overflow(page)).toBe(0);
      await page.screenshot({ path: `${SHOTS}/detalle-${tag}.png`, fullPage: true });
      if (width === 390) await page.screenshot({ path: `${SHOTS}/detalle-${tag}-viewport.png` });
      if (width === 390 || width === 430) {
        await page.locator('.community-scoreboard').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/marcador-${tag}-viewport.png` });
      }
      await page.goto('./#/retos/comunidad/duel');
      const comparison = page.getByRole('group', { name: 'Comparativa del duelo' });
      await expect(comparison.getByText('Tú', { exact: true })).toBeVisible();
      await expect(comparison.getByText('Ana Ruiz', { exact: true })).toBeVisible();
      await expect(comparison.getByText('42 km', { exact: true })).toBeVisible();
      await expect(comparison.getByText('58 km', { exact: true })).toBeVisible();
      expect(await overflow(page)).toBe(0);
      await page.screenshot({ path: `${SHOTS}/duelo-${tag}.png`, fullPage: true });
      if (width === 390) await page.screenshot({ path: `${SHOTS}/duelo-${tag}-viewport.png` });
      await page.goto('./#/retos/nuevo?plantilla=100km');
      await expect(page.getByLabel('Nombre del reto')).toHaveValue('+100 km esta semana');
      expect(await overflow(page)).toBe(0);
      await page.screenshot({ path: `${SHOTS}/nuevo-${tag}.png`, fullPage: true });
      if (width === 390) await page.screenshot({ path: `${SHOTS}/nuevo-${tag}-viewport.png` });
    });
  }
}

test('marcador y formulario en apaisado', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await mockCommunity(page);
  await page.goto('./#/retos/comunidad/c1');
  await expect(page.getByRole('button', { name: 'Aceptar reto' })).toBeVisible();
  expect(await overflow(page)).toBe(0);
  await page.screenshot({ path: `${SHOTS}/detalle-apaisado.png`, fullPage: true });
  await page.goto('./#/retos/nuevo?plantilla=100km');
  await expect(page.getByLabel('Nombre del reto')).toBeVisible();
  expect(await overflow(page)).toBe(0);
  await page.screenshot({ path: `${SHOTS}/nuevo-apaisado.png`, fullPage: true });
});
