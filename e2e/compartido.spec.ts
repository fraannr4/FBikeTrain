import { mkdirSync } from 'node:fs';
import { test, expect, type Page, AUTH_KEY, TEST_SESSION } from './accountFixture';

// Apertura de IndexedDB, Worker y capturas móviles en máquinas cargadas (como acceso/perfil).
test.setTimeout(60_000);

const routeXml = '<gpx version="1.1"><metadata><author><name>Autor sintético</name></author><link href="https://example.invalid/ruta"/></metadata><trk><name>Ruta sintética</name><trkseg><trkpt lat="0" lon="0"><ele>1</ele></trkpt><trkpt lat="0" lon="0.01"><ele>4</ele></trkpt></trkseg></trk></gpx>';
const activityXml = '<gpx version="1.1"><trk><name>Salida sintética</name><type>cycling</type><trkseg>' + Array.from({ length: 31 }, (_, index) => `<trkpt lat="0" lon="${index * 0.0001}"><ele>1</ele><time>${new Date(Date.UTC(2026, 0, 1, 10, 0, index * 4)).toISOString()}</time></trkpt>`).join('') + '</trkseg></trk></gpx>';
type Shared = { name: string; content: string };
async function seed(page: Page, files: Shared[], id = crypto.randomUUID()) {
  await page.evaluate(async ({ files, id }) => {
    const data = new FormData();
    files.forEach(file => data.append('files', new File([file.content], file.name)));
    const response = new Response(data);
    response.headers.set('X-Shared-At', String(Date.now()));
    await (await caches.open('fbiketrain-shares-v1')).put(new URL(`shared-inbox/${id}`, location.href.split('#')[0]), response);
  }, { files, id });
  return id;
}

test('un envío mixto guarda referencias y usa el informe habitual de duplicados', async ({ page }) => {
  await page.goto('/');
  const files = [{ name: 'ruta.gpx', content: routeXml }, { name: 'salida.gpx', content: activityXml }, { name: 'repetida.gpx', content: activityXml }];
  const id = await seed(page, files);
  await page.goto(`#/compartido?envio=${id}`);
  await expect(page.getByRole('heading', { name: '3 ficheros recibidos' })).toBeVisible();
  await page.getByRole('button', { name: 'Importar ficheros' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 ruta guardada' })).toBeVisible();
  await expect(page.getByText('Importación terminada', { exact: true })).toBeVisible();
  await expect(page.getByText(/ya estaba/, { exact: false }).first()).toBeVisible();
  expect(await page.evaluate(async id => !!await (await caches.open('fbiketrain-shares-v1')).match(new URL(`shared-inbox/${id}`, location.href.split('#')[0])), id)).toBe(false);
  await page.getByRole('link', { name: 'Ir a la biblioteca', exact: true }).click();
  await expect(page.getByText('Ruta sintética', { exact: true })).toBeVisible();
  await page.goto(`#/compartido?envio=${id}`);
  await expect(page.getByText(/No hay ficheros pendientes/)).toBeVisible();
});

test('Ajustes ofrece el aviso de instalación disponible y lo consume una sola vez', async ({ page }) => {
  await page.goto('#/ajustes');
  const button = page.getByRole('button', { name: 'Instalar la app', exact: true });
  await expect(button).toBeVisible();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: async () => { document.documentElement.dataset.installPrompt = 'shown'; },
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(event);
  });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.locator('html')).toHaveAttribute('data-install-prompt', 'shown');
  await expect(button).toBeDisabled();
});

test('recargar antes de importar conserva el GPX y permite guardarlo como ruta aunque incluya horas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const id = await seed(page, [{ name: 'ruta-con-horas.gpx', content: activityXml }]);
  await page.goto(`#/compartido?envio=${id}`);
  await expect(page.getByRole('heading', { name: '1 fichero recibido' })).toBeVisible();
  await page.reload();
  const destination = page.getByRole('combobox', { name: 'Guardar ruta-con-horas.gpx como' });
  await expect(destination).toHaveValue('activity');
  await destination.selectOption('route');
  await page.getByRole('button', { name: 'Importar ficheros' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 ruta guardada' })).toBeVisible();
  await page.getByRole('link', { name: 'Ir a la biblioteca', exact: true }).click();
  await expect(page.getByRole('button', { name: /Salida sintética/ })).toBeVisible();
  await page.goto(`#/compartido?envio=${id}`);
  await page.reload();
  await expect(page.getByText(/No hay ficheros pendientes/)).toBeVisible();
});

test('descartar borra un envío no admitido sin importar nada', async ({ page }) => {
  await page.goto('/');
  const id = await seed(page, [{ name: 'documento.txt', content: 'synthetic' }]);
  await page.goto(`#/compartido?envio=${id}`);
  await page.getByRole('button', { name: 'Descartar envío' }).click();
  await page.reload();
  await expect(page.getByText(/No hay ficheros pendientes/)).toBeVisible();
});

test('una actividad no legible queda pendiente tras recargar y permite corregir el destino', async ({ page }) => {
  await page.goto('/');
  const id = await seed(page, [{ name: 'referencia-sin-horas.gpx', content: routeXml }]);
  await page.goto(`#/compartido?envio=${id}`);
  const destination = page.getByRole('combobox', { name: 'Guardar referencia-sin-horas.gpx como' });
  await destination.selectOption('activity');
  await page.getByRole('button', { name: 'Importar ficheros' }).click();
  await expect(page.getByRole('heading', { name: 'Nada nuevo', exact: true })).toBeVisible();
  await expect(page.getByText('Hay puntos del GPX sin hora', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(async id => !!await (await caches.open('fbiketrain-shares-v1')).match(new URL(`shared-inbox/${id}`, location.href.split('#')[0])), id)).toBe(true);
  await page.reload();
  await expect(destination).toHaveValue('route');
  await page.getByRole('button', { name: 'Importar ficheros' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 ruta guardada' })).toBeVisible();
});

test('el envío permanece guardado hasta entrar y se recupera aunque OAuth pierda el hash', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('https://*.supabase.co/**', route => route.abort());
  await page.goto('/');
  const id = await seed(page, [{ name: 'pendiente.gpx', content: routeXml }]);
  await page.evaluate(key => localStorage.removeItem(key), AUTH_KEY);
  await page.goto(`#/compartido?envio=${id}`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Vuelve a tu ritmo' })).toBeVisible();
  expect(await page.evaluate(async id => !!await (await caches.open('fbiketrain-shares-v1')).match(new URL(`shared-inbox/${id}`, location.href.split('#')[0])), id)).toBe(true);
  await page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_KEY, session: TEST_SESSION });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '1 fichero recibido' })).toBeVisible();
  await context.close();
});

test('el SW recibe POST multipart y redirige 303 sin cachear la app', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.evaluate(xml => {
    const form = document.createElement('form');
    form.action = 'share-target'; form.method = 'POST'; form.enctype = 'multipart/form-data';
    const input = document.createElement('input'); input.type = 'file'; input.name = 'files';
    const data = new DataTransfer(); data.items.add(new File([xml], 'desde-android.gpx'));
    input.files = data.files; form.append(input); document.body.append(form); form.submit();
  }, routeXml);
  await page.waitForURL(/#\/compartido\?envio=/);
  await expect(page.getByText('desde-android.gpx', { exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await (await caches.open('fbiketrain-shares-v1')).keys()).every(key => key.url.includes('/shared-inbox/')))).toBe(true);
});

for (const theme of ['light', 'dark']) {
  for (const width of [360, 390, 412, 430, 844]) {
    for (const scenario of ['uno', 'tres', 'no-admitido']) {
      test(`compartido ${theme} ${width} ${scenario}`, async ({ page }) => {
        mkdirSync('test-results/pwa-compartir', { recursive: true });
        await page.setViewportSize({ width, height: width === 844 ? 390 : width === 360 ? 780 : width === 390 ? 844 : width === 412 ? 915 : 932 });
        await page.addInitScript(theme => localStorage.setItem('fbt-theme', theme), theme);
        await page.goto('/');
        const files = scenario === 'uno' ? [{ name: 'ruta-wikiloc-sintetica.gpx', content: routeXml }] : scenario === 'tres' ? [{ name: 'ruta.gpx', content: routeXml }, { name: 'salida.gpx', content: activityXml }, { name: 'dispositivo.fit', content: 'synthetic' }] : [{ name: 'documento-no-admitido.txt', content: 'synthetic' }];
        const id = await seed(page, files);
        await page.goto(`#/compartido?envio=${id}`);
        await expect(page.getByRole('heading', { name: `${files.length} ${files.length === 1 ? 'fichero recibido' : 'ficheros recibidos'}` })).toBeVisible();
        if (scenario === 'no-admitido') await expect(page.getByText('Formato no admitido. Usa GPX, TCX o FIT.')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `test-results/pwa-compartir/${theme}-${width}-${scenario}.png`, fullPage: true });
      });
    }
  }
}
