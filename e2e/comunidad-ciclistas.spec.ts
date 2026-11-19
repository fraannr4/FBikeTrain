import { test, expect, TEST_USER_ID, type Page } from './accountFixture';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const NAME = 'Maximiliana de los Santos Inocentes Bermúdez-Villalobos';
const cyclist = (id: string, display_name = `Ciclista ${id}`) => ({ id, username: `ciclista_${id}`, display_name, locality: 'Villa Sintética', distance_km: null, bio: 'La mejor compañía se encuentra pedaleando. Explorando las carreteras de la Sierra Ficticia.', riding_style: 'explorar', avatar_version: 0, last_active_at: '2026-11-15T00:00:00Z' });

async function fakeCommunity(page: Page, short = false) {
  const people = [cyclist(TEST_USER_ID, 'Tu perfil sintético'), cyclist('p2', NAME), ...(short
    ? ['Marta Soler', 'Luis Vega', 'Elena Costa'].map((name, i) => cyclist(`p${i + 3}`, name))
    : Array.from({ length: 50 }, (_, i) => cyclist(`p${i + 3}`)))];
  const state = { blocked: false, friends: [] as unknown[], requests: [] as unknown[], reports: [] as unknown[], searches: [] as { query_text: string; page_offset: number }[] };
  await page.route('https://*.supabase.co/rest/v1/profiles*', route => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(cyclist('p2', NAME)) }));
  await page.route('https://*.supabase.co/rest/v1/rpc/*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const args = route.request().postDataJSON() ?? {};
    const json = (value: unknown) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(value) });
    if (name === 'list_cyclists') {
      state.searches.push(args);
      const result = people.filter(p => (!state.blocked || p.id !== 'p2') && (!args.query_text || p.display_name.toLowerCase().includes(String(args.query_text).toLowerCase())));
      return json(result.slice(args.page_offset ?? 0, (args.page_offset ?? 0) + 50));
    }
    if (name === 'list_friends') return json(state.friends);
    if (name === 'request_friendship') {
      state.requests.push(args);
      state.friends = [{ friendship_id: 'f1', status: 'pending', direction: 'sent', profile: cyclist('p2', NAME) }];
    }
    if (name === 'report_cyclist') state.reports.push(args);
    if (name === 'block_cyclist') { state.blocked = Boolean(args.blocked); state.friends = []; }
    if (name === 'list_blocked_cyclists') return json(state.blocked ? [cyclist('p2', NAME)] : []);
    if (name === 'my_area') return json([{ locality: 'Villa Sintética', show_area: true }]);
    if (name?.startsWith('list_')) return json([]);
    return route.fulfill({ status: 204, headers: CORS });
  });
  return state;
}

test('directorio completo paginado: buscar, amistad, perfil, denunciar, bloquear y desbloquear a 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fakeCommunity(page);
  await page.goto('./#/ciclistas');
  const list = page.getByRole('list', { name: 'Ciclistas registrados' });
  await expect(list.getByRole('listitem')).toHaveCount(49);
  await page.getByRole('button', { name: 'Ver más ciclistas' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(51);
  expect(state.searches).toContainEqual({ query_text: '', page_offset: 50 });
  await page.getByLabel('Nombre o usuario').fill('Maximiliana');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();
  await expect(page.getByLabel('Nombre o usuario')).toBeFocused();
  await expect(list.getByRole('listitem')).toHaveCount(49);
  await page.getByLabel('Nombre o usuario').fill('Maximiliana');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: `Solicitar amistad a ${NAME}` }).click();
  await expect(page.getByText('Solicitud enviada', { exact: true })).toBeVisible();
  expect(state.requests).toEqual([{ target_id: 'p2' }]);
  await expect(page.getByRole('link', { name: `Retar a ${NAME}` })).toHaveAttribute('href', '#/retos/nuevo?ciclista=p2');
  await page.getByRole('link', { name: `Ver perfil de ${NAME}` }).click();
  await expect(page.getByRole('link', { name: `Retar a ${NAME}` })).toBeVisible();
  await page.getByRole('button', { name: 'Bloquear o denunciar' }).click();
  await page.getByLabel('Motivo de la denuncia').fill('Acoso en mensajes sintéticos');
  await page.getByRole('button', { name: 'Enviar denuncia' }).click();
  await expect(page.getByText(/Denuncia enviada/)).toBeVisible();
  expect(state.reports).toEqual([{ target_id: 'p2', reason: 'Acoso en mensajes sintéticos' }]);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('dialog')?.open)).toBe(true);
  await page.screenshot({ path: 'test-results/comunidad/ciclista-denuncia-390-viewport.png' });
  await page.screenshot({ path: 'test-results/comunidad/ciclista-denuncia-390.png', fullPage: true });
  await page.getByRole('button', { name: 'Bloquear a este ciclista' }).click();
  await expect(page.getByRole('heading', { name: 'Perfil no disponible' })).toBeVisible();
  await page.goto('./#/ciclistas');
  await expect(page.getByRole('link', { name: `Ver perfil de ${NAME}` })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ciclistas bloqueados' }).click();
  await page.getByRole('button', { name: `Desbloquear a ${NAME}` }).click();
  await expect(page.getByRole('link', { name: `Ver perfil de ${NAME}` })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

for (const width of [360, 390, 412, 430]) {
  for (const theme of ['dark', 'light']) {
    test(`Ciclistas y perfil a ${width} px en ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript(value => localStorage.setItem('fbt-theme', value), theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await fakeCommunity(page, true);
      await page.goto('./#/ciclistas');
      await expect(page.getByRole('link', { name: `Ver perfil de ${NAME}` })).toBeVisible();
      // Sin filtro «Todos / Amigos»: Amigos es una parte de «Gente».
      await expect(page.getByRole('navigation', { name: 'Vistas de ciclistas' })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      const smallTargets = await page.locator('.cyclist-actions a, .cyclist-actions button').evaluateAll(elements => elements.filter(e => e.getBoundingClientRect().height < 44).length);
      expect(smallTargets).toBe(0);
      await page.screenshot({ path: `test-results/comunidad/ciclistas-${width}-${theme}.png`, fullPage: true });
      if (width === 390) await page.screenshot({ path: `test-results/comunidad/ciclistas-390-${theme}-viewport.png` });
      await page.getByRole('link', { name: `Ver perfil de ${NAME}` }).click();
      await expect(page.getByRole('link', { name: `Retar a ${NAME}` })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await page.screenshot({ path: `test-results/comunidad/ciclista-perfil-${width}-${theme}.png`, fullPage: true });
    });
  }
}

test('Ciclistas en apaisado conserva acciones y navegación', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await fakeCommunity(page, true);
  await page.goto('./#/ciclistas');
  await expect(page.getByRole('link', { name: `Ver perfil de ${NAME}` })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: 'test-results/comunidad/ciclistas-apaisado.png', fullPage: true });
});
