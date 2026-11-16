import { mkdirSync } from 'node:fs';
import { Encoder, Profile, type FileIdMesg, type RecordMesg, type SessionMesg } from '@garmin/fitsdk';
import { test, expect, type Page, TEST_DATABASE, AUTH_KEY, TEST_SESSION, TEST_USER_ID } from './accountFixture';

test.setTimeout(90_000);
const NOW = new Date('2026-01-10T12:00:00Z');
const KEY = 'synthetic-intervals-key';
const activity = (id = 'i1', day = '2026-01-09') => ({ id, source: 'OAUTH_CLIENT', device_name: 'IGPSPORT 202', file_type: 'fit', type: 'Ride', start_date_local: `${day}T09:00:00`, start_date: `${day}T08:00:00Z` });
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
  await expect(page.getByText('Conecta tu dispositivo directamente a Intervals.icu, no a través de Strava.', { exact: false })).toBeVisible();
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
  await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await expect(page.getByText('1 salida nueva', { exact: true })).toBeVisible();
  await expect(page.getByText('1 ya estaba')).toBeVisible();
  expect(calls.files()).toBe(2);
  await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await expect(page.getByText('Ya lo tenías todo', { exact: true })).toBeVisible();
  expect(calls.files()).toBe(2);
  await page.getByRole('button', { name: 'Desconectar Intervals.icu' }).click();
  await expect(page.getByLabel('Clave de API de Intervals.icu')).toHaveValue('');
  await page.goto('#/historial');
  await expect(page.getByText('Aún no hay salidas')).not.toBeVisible();
  await expect(page.locator('a[href^="#/historial/"]').first()).toBeVisible();
});

test('recupera un error temporal del original mediante backoff', async ({ page }) => {
  let attempts = 0;
  const calls = await api(page, { fileStatus: () => ++attempts === 1 ? 500 : 200 });
  await open(page); await save(page, false);
  await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
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
  await expect(page.getByRole('button', { name: 'Sincronizar ahora' })).toBeEnabled();
  expect(calls.lists()).toBe(count);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 6 * 3600_000));
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(calls.lists).toBeGreaterThan(count);
  await expect(page.getByRole('button', { name: 'Sincronizar ahora' })).toBeEnabled();
  expect(calls.files()).toBe(1);
});

test('respeta 429 y habilita el botón al vencer Retry-After sin recargar', async ({ page }) => {
  await page.clock.install({ time: NOW });
  const calls = await api(page, { status: 429, retry: '60' });
  await open(page); await save(page, false);
  await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'limitado las peticiones' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sincronizar ahora' })).toBeDisabled();
  expect(calls.lists()).toBe(1);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('button', { name: 'Sincronizar ahora' })).toBeEnabled();
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

test('una clave local dañada se puede restablecer sin bloquear la configuración', async ({ page }) => {
  await open(page); await save(page, false);
  await page.evaluate(name => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('meta', 'readwrite');
      transaction.objectStore('meta').put({ key: 'intervals:credential-key', value: null });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), TEST_DATABASE);
  await page.reload();
  const reset = page.getByRole('button', { name: 'Restablecer conexión local' });
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(page.getByLabel('Clave de API de Intervals.icu')).toBeEnabled();
  await expect(page.getByLabel('Clave de API de Intervals.icu')).toHaveValue('');
  await expect(reset).not.toBeVisible();
});

for (const theme of ['dark', 'light']) {
  for (const [width, height] of [[360, 780], [390, 844], [412, 915], [430, 932], [844, 390]]) {
    test(`conexiones móvil ${theme} ${width}x${height}`, async ({ page }) => {
      mkdirSync('test-results/conexiones', { recursive: true });
      await page.setViewportSize({ width, height });
      await page.addInitScript(theme => localStorage.setItem('fbt-theme', theme), theme);
      await open(page);
      await expect(page.getByLabel('Athlete id de Intervals.icu')).toHaveValue('0');
      const settingsLink = page.getByRole('link', { name: 'Abrir ajustes de Intervals.icu' });
      await expect(settingsLink).toHaveAttribute('href', 'https://intervals.icu/settings');
      await expect(page.locator('.connection-steps')).toHaveCSS('list-style-type', 'decimal');
      expect((await settingsLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator('#conexiones').evaluate(el => el.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `test-results/conexiones/${theme}-${width}x${height}-configurar.png` });
      await save(page, false);
      await page.getByText('Cambiar conexión y sincronización', { exact: true }).click();
      await expect(page.getByLabel('Clave de API de Intervals.icu')).toHaveValue('');
      await page.getByText('Cambiar conexión y sincronización', { exact: true }).click();
      await expect(page.getByRole('button', { name: 'Sincronizar ahora' })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const name of ['Sincronizar ahora', 'Desconectar Intervals.icu']) {
        const box = await page.getByRole('button', { name }).boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeLessThanOrEqual(width);
      }
      await page.locator('#conexiones').evaluate(el => el.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `test-results/conexiones/${theme}-${width}x${height}.png` });
    });
  }
}

async function garminApi(page: Page, available: boolean, initiallyConnected = false) {
  const remote = { connected: initiallyConnected, connects: 0, files: 0, disconnects: 0, consents: 0 };
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,apikey', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  await page.route('https://*.supabase.co/functions/v1/garmin/**', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 200, headers }); return; }
    expect(request.headers()['authorization']).toBe(`Bearer ${TEST_SESSION.access_token}`);
    const path = new URL(request.url()).pathname.split('/garmin/')[1];
    if (path === 'status') {
      await route.fulfill({ json: { available, connected: remote.connected, backfillAvailable: false, receptionAvailable: true }, headers });
    } else if (path === 'connect') {
      expect(request.method()).toBe('POST'); remote.connects++;
      await route.fulfill({ json: { authorizationUrl: 'https://connect.garmin.com/oauth2Confirm?state=synthetic-state' }, headers });
    } else if (path === 'activities') {
      await route.fulfill({ json: { activities: remote.connected ? [{ id: 'synthetic-garmin', deviceName: 'Garmin Edge 530', createdAt: NOW.getTime() }] : [], backfillAvailable: false }, headers });
    } else if (path === 'activities/synthetic-garmin/file') {
      remote.files++;
      await route.fulfill({ contentType: 'application/octet-stream', body: FIT, headers });
    } else if (path === 'disconnect') {
      expect(request.method()).toBe('POST'); remote.disconnects++; remote.connected = false;
      await route.fulfill({ json: { disconnected: true }, headers });
    } else throw new Error(`Unexpected synthetic Garmin endpoint: ${path}`);
  });
  return remote;
}

for (const theme of ['dark', 'light']) {
  for (const [width, height] of [[390, 844]]) {
    test(`Garmin directo ${theme} ${width}: consentimiento, importación y desconexión`, async ({ page }, testInfo) => {
      // La build tiene que llevar el interruptor encendido: VITE_GARMIN_ENABLED=true npx playwright test.
      test.skip(process.env.VITE_GARMIN_ENABLED !== 'true', 'Build sin VITE_GARMIN_ENABLED=true');
      const artifacts = (await import('node:path')).resolve(process.env.FBIKETRAIN_ARTIFACTS_DIR ?? testInfo.outputPath('garmin-directo'));
      mkdirSync(artifacts, { recursive: true });
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(theme => localStorage.setItem('fbt-theme', theme), theme);
      const remote = await garminApi(page, true);
      await open(page);
      const connect = page.getByRole('button', { name: 'Conectar con Garmin', exact: true });
      await expect(connect).toBeEnabled();
      const section = page.locator('.garmin-connection');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await section.screenshot({ path: `${artifacts}/${theme}-${width}-garmin-directo-desconectado.png` });
      const returnUrl = page.url();
      await page.route('https://connect.garmin.com/oauth2Confirm**', async route => {
        remote.consents++; remote.connected = true;
        await route.fulfill({ status: 302, headers: { location: returnUrl } });
      });
      await connect.click();
      await expect(section.getByText('Cuenta Garmin conectada.', { exact: true })).toBeVisible();
      await expect(section.getByText('1 salida nueva de Garmin. 0 ya estaban guardadas.', { exact: true })).toBeVisible();
      expect(remote.connects).toBe(1); expect(remote.consents).toBe(1); expect(remote.files).toBe(1);
      await expect(section.getByText(/Última sincronización:/)).toBeVisible();
      await expect(section.getByText(/Las salidas nuevas llegan solas/)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await section.screenshot({ path: `${artifacts}/${theme}-${width}-garmin-directo-conectado.png` });
      await page.reload();
      await expect(section.getByText('Cuenta Garmin conectada.', { exact: true })).toBeVisible();
      expect(remote.files).toBe(1);
      await page.goto('#/historial');
      const row = page.locator('a[href^="#/historial/"]').filter({ hasText: 'Garmin Edge 530' }).first();
      await expect(row).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${artifacts}/${theme}-${width}-garmin-directo-lista.png` });
      await row.click();
      await expect(page.locator('.ride-head').getByText('Garmin Edge 530', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${artifacts}/${theme}-${width}-garmin-directo-detalle.png` });
      await page.goto('#/ajustes?abrir=conexiones');
      await page.getByRole('button', { name: 'Desconectar Garmin', exact: true }).click();
      await expect(connect).toBeEnabled();
      expect(remote.disconnects).toBe(1);
      await page.goto('#/historial');
      await expect(page.locator('a[href^="#/historial/"]').filter({ hasText: 'Garmin Edge 530' }).first()).toBeVisible();
    });

    test(`Garmin pendiente de aprobación ${theme} ${width}`, async ({ page }, testInfo) => {
      const artifacts = (await import('node:path')).resolve(process.env.FBIKETRAIN_ARTIFACTS_DIR ?? testInfo.outputPath('garmin-directo'));
      mkdirSync(artifacts, { recursive: true });
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(theme => localStorage.setItem('fbt-theme', theme), theme);
      await garminApi(page, false);
      await open(page);
      const section = page.locator('.garmin-connection');
      await expect(section.getByText('Pendiente de la aprobación de Garmin', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Conectar con Garmin', exact: true })).toBeDisabled();
      await expect(section.getByText(/Exporta el FIT desde Garmin Connect y súbelo en Importar/)).toBeVisible();
      await expect(section.getByRole('link', { name: 'Ir a Importar' })).toHaveAttribute('href', '#/importar');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await section.screenshot({ path: `${artifacts}/${theme}-${width}-garmin-directo-pendiente.png` });
    });
  }
}

test('la política de privacidad se abre sin cuenta', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.route('https://*.supabase.co/**', route => route.abort());
    await page.goto(new URL('#/privacidad', baseURL).href);
    await expect(page.getByRole('heading', { name: 'Privacidad', exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Garmin Connect', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vuelve a tu ritmo' })).not.toBeVisible();
  } finally { await context.close(); }
});
