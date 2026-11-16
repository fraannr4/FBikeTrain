import { fileURLToPath } from 'node:url';
import { test, expect, TEST_USER_ID } from './accountFixture';

test('una importación real por Worker actualiza el reto sin salir de Importar y no suma duplicados', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date('2026-01-04T12:00:00+01:00'));
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const me = { id: TEST_USER_ID, username: 'sintetico', display_name: 'Ciclista sintético', status: 'accepted', accepted_at: '2026-01-03T00:00:00Z', score: null as number | null, updated_at: null as string | null };
  const challenge = { id: 'reto-import', creator_id: TEST_USER_ID, title: 'Una salida más', kind: 'distance', status: 'active', created_at: me.accepted_at, deadline: '2026-01-05T00:00:00Z', target_value: 100000, distance_m: null, segment_key: null, winner_ids: [], members: [me, { ...me, id: 'rival-sintetico', display_name: 'Rival', status: 'pending', accepted_at: null }] };
  const submissions: Record<string, unknown>[] = [];
  await page.route('https://*.supabase.co/rest/v1/rpc/*', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const name = request.url().split('/').pop();
    let data: unknown = null;
    if (name === 'list_community_challenges') data = [challenge];
    if (name === 'get_community_challenge') data = challenge;
    if (name === 'list_community_notifications') data = [];
    if (name === 'submit_community_score') {
      const body = request.postDataJSON(); submissions.push(body); me.score = body.score; me.updated_at = '2026-01-04T11:00:00Z';
    }
    return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('#/importar');
  const input = page.getByLabel('Elegir el ZIP o ficheros');
  const file = fileURLToPath(new URL('../tests/fixtures/ride.gpx', import.meta.url));
  await input.setInputFiles(file);
  await expect(page.getByText('1 salida nueva')).toBeVisible();
  await expect.poll(() => me.score, { timeout: 20_000 }).toBeGreaterThan(200);
  const first = me.score;
  await input.setInputFiles(file);
  await expect(page.getByText('1 ya estaba')).toBeVisible();
  await page.goto('#/retos/comunidad/reto-import');
  await expect(page.getByRole('heading', { name: 'Una salida más' })).toBeVisible();
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect.poll(() => me.score).toBe(first);
  expect(submissions.filter(s => Number(s.score) > 0)).toHaveLength(1);
  for (const s of submissions) expect(Object.keys(s).sort()).toEqual(['challenge_id', 'score']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/comunidad/importacion-marcador-390.png', fullPage: true });
});
