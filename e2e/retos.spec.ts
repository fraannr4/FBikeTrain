import { test, expect, type Page } from './accountFixture';
import { ride, seed, settings } from './seed';

// Retos con las RPC simuladas y salidas sintéticas en IndexedDB. Nombres extremos para las capturas.
test.setTimeout(90_000);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const SHOTS = 'test-results/retos';
const LONG_NAME = 'Maximiliana de los Santos Inocentes Bermúdez-Villalobos';
const LONG_ROUTE = 'Vuelta sintética por los siete puertos de la Sierra Ficticia con regreso por el valle';
const rival = (display_name: string, username: string) => ({ id: 'p2', username, display_name, locality: null, distance_km: null });
const POINTS = Array.from({ length: 40 }, (_, i) => [40.4168 + i * 0.002, -3.7038 + Math.sin(i / 6) * 0.01, 650 + i * 3]);
const result = (over: Record<string, unknown> = {}) => ({
  activity_date: '2026-11-04', moving_time_s: 5400, distance_m: 42000, avg_speed_ms: 7.78, elev_gain_m: 600, vam_mh: 400, ...over,
});

function challenge(id: string, status: string, over: Record<string, unknown> = {}, people = rival('Ana Ruta', 'ana_ruta')) {
  const { mine = null, theirs = null, ...rest } = over;
  return {
    challenge: {
      id, status, route_name: 'Vuelta sintética', route_points: POINTS, distance_m: 42000, elev_gain_m: 610,
      deadline: '2026-12-15T09:00:00Z', created_at: '2026-10-25T09:00:00Z', i_am_challenger: false, ...rest,
    },
    rival: people,
    mine,
    theirs,
  };
}

async function fakeRpc(page: Page, rows: unknown[]) {
  const state = { rows, submitted: [] as unknown[], responded: [] as unknown[] };
  await page.route('https://*.tile-cyclosm.openstreetmap.fr/**', (r) => r.abort());
  await page.route('https://*.supabase.co/rest/v1/rpc/*', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const fn = new URL(req.url()).pathname.split('/').pop();
    const json = (body: unknown) => r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (fn === 'list_challenges') return json(state.rows);
    if (fn === 'list_friends') return json([]);
    if (fn === 'respond_challenge') {
      state.responded.push(req.postDataJSON());
      state.rows = [challenge('r1', 'accepted')];
      return r.fulfill({ status: 204, headers: CORS });
    }
    if (fn === 'submit_challenge_result') {
      state.submitted.push(req.postDataJSON());
      return r.fulfill({ status: 204, headers: CORS });
    }
    return r.fulfill({ status: 204, headers: CORS });
  });
  return state;
}

const RIDES = [ride('s1', 2, 'Vuelta sintética de los martes', 42), ride('s2', 4, 'Salida corta', 20), ride('s3', 30, 'Salida anterior al reto', 42)];
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('aceptar un reto y elegir a mano la salida: solo suben las cifras', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fakeRpc(page, [challenge('r1', 'pending')]);
  await seed(page, { activities: RIDES, settings: settings() });
  await page.goto('./#/mas');
  await page.getByRole('link', { name: /Retos/ }).click();
  await page.getByRole('link', { name: /Vuelta sintética/ }).click();
  await page.getByRole('button', { name: 'Aceptar' }).click();
  expect(state.responded).toEqual([{ challenge_id: 'r1', accept: true }]);
  await page.getByRole('button', { name: 'Usar una salida' }).click();
  const sheet = page.getByRole('dialog', { name: 'Elige tu salida' });
  await expect(sheet.getByRole('listitem')).toHaveCount(2);
  await expect(sheet.getByRole('listitem').first()).toContainText('Vuelta sintética de los martes');
  await expect(sheet.getByRole('listitem').nth(1)).toContainText('Esta salida es bastante más corta que la ruta del reto');
  await sheet.getByRole('button', { name: 'Usar esta salida: Vuelta sintética de los martes' }).click();
  await expect(sheet).toBeHidden();
  expect(state.submitted).toHaveLength(1);
  const sent = state.submitted[0] as Record<string, unknown>;
  expect(Object.keys(sent).sort()).toEqual(['activity_date', 'avg_speed_ms', 'challenge_id', 'distance_m', 'elev_gain_m', 'moving_time_s', 'vam_mh']);
  expect(sent).toMatchObject({ challenge_id: 'r1', activity_date: '2026-11-04', distance_m: 42000, moving_time_s: 5600, elev_gain_m: 600 });
  expect(JSON.stringify(sent)).not.toMatch(/lat|lng|points/);
});

for (const width of [360, 430]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`capturas de Retos a ${width} px en ${theme === 'light' ? 'claro' : 'oscuro'}`, async ({ page }) => {
      const tag = `${width}-${theme}`;
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((t) => localStorage.setItem('fbt-theme', t), theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const long = rival(LONG_NAME, 'maximiliana_de_los_santos_inoce');
      await fakeRpc(page, [
        challenge('r1', 'pending'),
        challenge('r2', 'accepted', { route_name: LONG_ROUTE, i_am_challenger: true, mine: result() }, long),
        challenge('r3', 'finished', { route_name: LONG_ROUTE, mine: result(), theirs: result({ moving_time_s: 5735, avg_speed_ms: 7.32, vam_mh: 377, elev_gain_m: 612 }) }, long),
        challenge('r4', 'expired', { route_name: 'Costa sintética' }),
        challenge('r5', 'declined', { route_name: 'Interior sintético', i_am_challenger: true }),
      ]);
      await seed(page, { activities: RIDES, settings: settings() });
      await page.goto('./#/retos');
      await expect(page.getByText('Caducado')).toBeVisible();
      expect(await overflow(page)).toBe(0);
      await page.screenshot({ path: `${SHOTS}/retos-lista-${tag}.png`, fullPage: true });

      await page.goto('./#/retos/r3');
      await expect(page.getByText('Has ganado')).toBeVisible();
      await expect(page.getByRole('table', { name: 'Comparativa del reto' })).toBeVisible();
      expect(await overflow(page)).toBe(0);
      await page.screenshot({ path: `${SHOTS}/reto-comparativa-${tag}.png`, fullPage: true });

      await page.goto('./#/retos/r1');
      await expect(page.getByRole('button', { name: 'Aceptar' })).toBeVisible();
      expect(await overflow(page)).toBe(0);
      await page.screenshot({ path: `${SHOTS}/reto-pendiente-${tag}.png`, fullPage: true });

      await page.goto('./#/retos/r2');
      await page.getByRole('button', { name: 'Cambiar de salida' }).click();
      await expect(page.getByRole('dialog', { name: 'Elige tu salida' }).getByText('Esta salida es bastante más corta que la ruta del reto')).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/reto-elegir-salida-${tag}.png` });
    });
  }
}

test('nuevo reto sin amigos aceptados, a 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await fakeRpc(page, []);
  await page.goto('./#/retos');
  await expect(page.getByText('Sin retos todavía')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/retos-vacio-360.png`, fullPage: true });
  await page.goto('./#/retos/nuevo');
  await expect(page.getByText('Necesitas un amigo aceptado para retarle')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/nuevo-reto-sin-amigos-360.png`, fullPage: true });
});

test('formulario de nuevo reto con un amigo y una ruta, a 360 px en claro y oscuro', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const state = await fakeRpc(page, []);
  await page.route('https://*.supabase.co/rest/v1/rpc/list_friends', (r) =>
    r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([{ friendship_id: 'f1', status: 'accepted', direction: 'sent', profile: rival(LONG_NAME, 'maximiliana_de_los_santos_inoce') }]) }));
  await page.route('https://*.supabase.co/rest/v1/rpc/create_challenge', (r) => {
    state.submitted.push(r.request().postDataJSON());
    return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify('r9') });
  });
  await seed(page, { settings: settings() });
  const points = POINTS.map(([lat, lng, ele]) => ({ lat, lng, ele }));
  await page.evaluate(async ({ name, points }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ciclismo-user-00000000-0000-0000-0000-000000000011');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['referenceRoutes'], 'readwrite');
    tx.objectStore('referenceRoutes').put({
      id: 'ruta-larga', name, format: 'gpx', sourceFileName: 'sintetica.gpx', originalXml: '<gpx/>', originalPoints: points, points,
      summary: { distanceM: 8640, elevGainM: 117, elevLossM: 0, closed: false, pointCount: points.length }, createdAt: 1, updatedAt: 1,
    });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  }, { name: LONG_ROUTE, points });
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((t) => localStorage.setItem('fbt-theme', t), theme);
    await page.goto('./#/retos/nuevo?ruta=ruta-larga');
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Ruta' })).toHaveValue('ruta-larga');
    expect(await overflow(page)).toBe(0);
    await page.screenshot({ path: `${SHOTS}/nuevo-reto-360-${theme}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Enviar reto' }).click();
  await expect(page).toHaveURL(/#\/retos\/r9$/);
  expect(state.submitted[0]).toMatchObject({ challenged_id: 'p2', route_name: LONG_ROUTE, distance_m: 8640, elev_gain_m: 117 });
  expect((state.submitted[0] as { route_points: unknown[] }).route_points).toHaveLength(40);
});
