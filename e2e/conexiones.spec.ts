import { mkdirSync } from 'node:fs';
import { Encoder, Profile, type FileIdMesg, type RecordMesg, type SessionMesg } from '@garmin/fitsdk';
import { test, expect, type Page, TEST_DATABASE, AUTH_KEY, TEST_SESSION, TEST_USER_ID } from './accountFixture';

test.setTimeout(90_000);
const NOW = new Date('2026-01-10T12:00:00Z');
const KEY = 'synthetic-intervals-key';
const activity = (id = 'i1', day = '2026-01-09') => ({ id, source: 'UPLOAD', file_type: 'fit', type: 'Ride', start_date_local: `${day}T09:00:00`, start_date: `${day}T08:00:00Z` });
const encoder = new Encoder();
const start = Date.parse('2026-01-09T08:00:00Z');
const at = (seconds: number) => new Date(start + seconds * 1000);
encoder.onMesg(Profile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'development', product: 1, timeCreated: at(0) } as FileIdMesg);
for (let i = 0; i < 5; i++) encoder.onMesg(Profile.MesgNum.RECORD, { timestamp: at(i * 30), distance: i * 300, speed: 10 } as RecordMesg);
encoder.onMesg(Profile.MesgNum.SESSION, { timestamp: at(120), startTime: at(0), sport: 'cycling', totalDistance: 1200, totalTimerTime: 120, totalElapsedTime: 120 } as SessionMesg);
const FIT = Buffer.from(encoder.close());

async function open(page: Page) {
  await page.clock.setFixedTime(NOW);
  await page.goto('#/ajustes?abrir=conexiones');
  await expect(page.getByLabel('Athlete id de Intervals.icu')).toBeEnabled();
}
async function save(page: Page, automatic = true) {
  await page.getByLabel('Athlete id de Intervals.icu').fill('i42');
  await page.getByLabel('Clave de API de Intervals.icu').fill(KEY);
  if (!automatic) await page.getByRole('checkbox', { name: /Traer salidas al abrir/ }).uncheck();
  await page.getByRole('button', { name: 'Guardar conexión' }).click();
  await expect(page.getByText('Conexión guardada en este navegador.')).toBeVisible();
}
async function api(page: Page, options: { rows?: ReturnType<typeof activity>[]; fileStatus?: () => number; status?: number; retry?: string } = {}) {
  let lists = 0;
  let files = 0;
  await page.route('https://intervals.icu/api/v1/**', async route => {
    const request = route.request();
    expect(request.url()).not.toContain(KEY);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization', 'access-control-expose-headers': 'retry-after' };
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 200, headers: { ...headers, 'access-control-allow-methods': 'GET' } }); return; }
    expect(request.headers()['authorization']).toBe(`Basic ${Buffer.from(`API_KEY:${KEY}`).toString('base64')}`);
    if (request.url().includes('/activities?')) {
      lists++;
      const url = new URL(request.url());
      const rows = (options.rows ?? [activity()]).filter(a => a.start_date_local.slice(0, 10) >= url.searchParams.get('oldest')! && a.start_date_local.slice(0, 10) <= url.searchParams.get('newest')!);
      await route.fulfill({ status: options.status ?? 200, contentType: 'application/json', body: JSON.stringify(rows), headers: { ...headers, ...(options.retry ? { 'retry-after': options.retry } : {}) } });
    } else {
      files++;
      await route.fulfill({ status: options.fileStatus?.() ?? 200, contentType: 'application/octet-stream', body: FIT, headers });
    }
  });
  return { lists: () => lists, files: () => files };
}

test('a un toque importa FIT por Worker, informa duplicados, protege la clave y desconecta sin borrar salidas', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const calls = await api(page, { rows: [activity('i1'), activity('i2')] });
  await open(page); await save(page, false);
  await expect(page.getByLabel('Clave de API de Intervals.icu')).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Traer salidas nuevas' }).click();
  await expect(page.getByText('1 salida nueva', { exact: true })).toBeVisible();
  await expect(page.getByText('1 ya estaba')).toBeVisible();
  expect(calls.files()).toBe(2);
  await page.getByRole('button', { name: 'Traer salidas nuevas' }).click();
  await expect(page.getByText('Ya lo tenías todo', { exact: true })).toBeVisible();
  expect(calls.files()).toBe(2);
  await page.getByRole('button', { name: 'Desconectar Intervals.icu' }).click();
  await expect(page.getByLabel('Clave de API de Intervals.icu')).toHaveValue('');
  await page.goto('#/historial');
  await expect(page.getByText('Aún no hay salidas')).not.toBeVisible();
  await expect(page.locator('a[href^="#/historial/"]').first()).toBeVisible();
});

test('reintenta un original fallido aunque después haya llegado una salida nueva', async ({ page }) => {
  let status = 500;
  const calls = await api(page, { fileStatus: () => status });
  await open(page); await save(page, false);
  await page.getByRole('button', { name: 'Traer salidas nuevas' }).click();
  await expect(page.getByText(/HTTP 500/).first()).toBeVisible();
  status = 200;
  await page.getByRole('button', { name: 'Traer salidas nuevas' }).click();
  await expect(page.getByText('1 salida nueva', { exact: true })).toBeVisible();
  expect(calls.files()).toBe(2);
});

test('al abrir actualiza Inicio y no vuelve a consultar antes de seis horas', async ({ page }) => {
  const calls = await api(page);
  await open(page); await save(page);
  await page.goto('#/');
  await page.reload();
  await expect(page.getByText('1 salida nueva de Intervals.icu', { exact: true })).toBeVisible();
  await expect(page.getByText('Ver con datos de ejemplo', { exact: true })).not.toBeVisible();
  await expect(page.getByText(/1 salida desde enero de 2026/)).toBeVisible();
  const count = calls.lists();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Inicio', exact: true })).toBeAttached();
  await page.goto('#/ajustes?abrir=conexiones');
  await expect(page.getByRole('button', { name: 'Traer salidas nuevas' })).toBeEnabled();
  expect(calls.lists()).toBe(count);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 6 * 3600_000));
  await page.reload();
  await expect.poll(calls.lists).toBeGreaterThan(count);
  await expect(page.getByRole('button', { name: 'Traer salidas nuevas' })).toBeEnabled();
  expect(calls.files()).toBe(1);
});

test('respeta 429 y habilita el botón al vencer Retry-After sin recargar', async ({ page }) => {
  await page.clock.install({ time: NOW });
  const calls = await api(page, { status: 429, retry: '60' });
  await open(page); await save(page, false);
  await page.getByRole('button', { name: 'Traer salidas nuevas' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'limitado las peticiones' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Traer salidas nuevas' })).toBeDisabled();
  expect(calls.lists()).toBe(1);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('button', { name: 'Traer salidas nuevas' })).toBeEnabled();
});

test('borrar todo detiene una descarga automática y elimina la clave también de memoria', async ({ page }) => {
  await open(page); await save(page);
  let downloading!: () => void;
  const started = new Promise<void>(resolve => { downloading = resolve; });
  await page.route('https://intervals.icu/api/v1/**', async route => {
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization', 'access-control-allow-methods': 'GET' };
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 200, headers }); return; }
    if (route.request().url().includes('/activities?')) {
      await route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify([activity()]) });
    } else { downloading(); /* permanece pendiente hasta que cancelar aborte fetch */ }
  });
  await page.reload(); await started;
  await page.locator('#borrar summary').click();
  await page.getByRole('button', { name: /Borrar todos los datos/ }).click();
  await page.getByRole('button', { name: 'Borrar todo', exact: true }).click();
  await expect(page.getByText('Datos borrados.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Clave de API de Intervals.icu')).toHaveValue('');
  expect(await page.evaluate(name => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open(name); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const database = request.result; const count = database.transaction('activities').objectStore('activities').count(); count.onsuccess = () => { database.close(); resolve(count.result); }; };
  }), TEST_DATABASE)).toBe(0);
});

test('otra cuenta de FBikeTrain no ve la clave ni consulta Intervals', async ({ page }) => {
  const calls = await api(page);
  await open(page); await save(page, false);
  const otherId = TEST_USER_ID.replace(/11$/, '22');
  const other = { ...TEST_SESSION, user: { ...TEST_SESSION.user, id: otherId } };
  await page.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_KEY, session: other });
  await page.reload();
  await expect(page.getByLabel('Clave de API de Intervals.icu')).toHaveValue('');
  expect(calls.lists()).toBe(0);
});

for (const theme of ['dark', 'light']) {
  for (const [width, height] of [[360, 780], [390, 844], [412, 915], [430, 932], [844, 390]]) {
    test(`conexiones móvil ${theme} ${width}x${height}`, async ({ page }) => {
      mkdirSync('test-results/conexiones', { recursive: true });
      await page.setViewportSize({ width, height });
      await page.addInitScript(theme => localStorage.setItem('fbt-theme', theme), theme);
      await open(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator('#conexiones').evaluate(el => el.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `test-results/conexiones/${theme}-${width}x${height}-configurar.png` });
      await save(page, false);
      await expect(page.getByRole('button', { name: 'Traer salidas nuevas' })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const name of ['Traer salidas nuevas', 'Desconectar Intervals.icu']) {
        const box = await page.getByRole('button', { name }).boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeLessThanOrEqual(width);
      }
      await page.locator('#conexiones').evaluate(el => el.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `test-results/conexiones/${theme}-${width}x${height}.png` });
    });
  }
}
