import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from './accountFixture';
import { HOME, NOW, RIDES, seed, settings } from './seed';

// Todo es sintético: las páginas de «Wikiloc» las sirve esta prueba (nunca se sale a wikiloc.com),
// el marcador se simula con su protocolo y la IA y ORS están interceptados.
test.setTimeout(90_000);

const APP_ORIGIN = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 4173}`;
const RECEIVE = `${APP_ORIGIN}/#/rutas/wikiloc/recibir`;
const CORS = { 'access-control-allow-origin': '*' };
const card = (id: string, nombre: string, km: number, desnivelM: number) => ({
  id, nombre, km, desnivelM, dificultad: 'moderado', autor: `Autora sintética ${id}`, url: `https://es.wikiloc.com/rutas-ciclismo/sintetica-${id}`,
});
const CARDS = [
  card('101', 'Vuelta sintética al embalse con un nombre largo para el móvil', 31, 420),
  card('102', 'Circuito sintético de las colinas', 28, 380),
  card('103', 'Gran vuelta sintética', 36, 600),
  card('104', 'Paseo sintético', 20, 150),
  card('105', 'Travesía sintética demasiado larga', 60, 900),
];

/** Circuito de ~30 km que pasa por Casa: se adapta rotándolo, sin consultas a ORS. */
function circuitGpx(): string {
  const r = 30_000 / (2 * Math.PI);
  const mLat = 111_320;
  const mLng = mLat * Math.cos((HOME.lat * Math.PI) / 180);
  const n = 320;
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const t = (i % n) / n * 2 * Math.PI;
    // Empieza en el punto más alejado de Casa (al norte) y pasa por Casa a mitad de camino.
    const lat = HOME.lat + (r + r * Math.cos(t)) / mLat;
    const lng = HOME.lng + (r * Math.sin(t)) / mLng;
    return `<trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><ele>${(650 + 40 * Math.sin(3 * t)).toFixed(1)}</ele></trkpt>`;
  });
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>Vuelta sintética</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

/** Página sintética que hace lo mismo que el marcador: abre la app, espera «fbt-ready» y le entrega el mensaje. */
const fakeWikiloc = (message: unknown) => `<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body><p>Wikiloc sintético</p><script>
const app = window.open(${JSON.stringify(RECEIVE)}, '_blank');
addEventListener('message', (e) => {
  if (e.source === app && e.origin === ${JSON.stringify(APP_ORIGIN)} && e.data === 'fbt-ready') app.postMessage(${JSON.stringify(message)}, ${JSON.stringify(APP_ORIGIN)});
});
</script></body></html>`;

const PLAN = {
  opciones: [
    { titulo: 'A', dimension: 'distancia', subidaPct: 10, distanciaKm: 31, desnivelM: null, motivo: 'La más cercana a tus 30 km.', referenciaId: 'ref1' },
    { titulo: 'B', dimension: 'distancia', subidaPct: 10, distanciaKm: 28, desnivelM: null, motivo: 'Algo más corta y más llana.', referenciaId: 'ref2' },
    { titulo: 'C', dimension: 'distancia', subidaPct: 10, distanciaKm: 36, desnivelM: null, motivo: 'Para alargar un poco.', referenciaId: 'ref3' },
  ],
};
const chatBody = (content: unknown) => JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }] });

async function setup(page: Page) {
  const context = page.context();
  const aiBodies: string[] = [];
  await context.clock.setFixedTime(NOW);
  // Las ventanas que abre el marcador también quedan sin nube real.
  await context.route('https://*.supabase.co/**', (r) => r.abort());
  await context.route('https://api.heigit.org/**', (r) => r.abort());
  await context.route('https://*.wikiloc.com/**', (r) => {
    const url = new URL(r.request().url());
    const message = url.pathname === '/wikiloc/map.do'
      ? { v: 1, kind: 'list', rutas: CARDS }
      : { v: 1, kind: 'track', id: '101', url: CARDS[0].url, nombre: CARDS[0].nombre, autor: CARDS[0].autor, gpx: circuitGpx() };
    return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fakeWikiloc(message) });
  });
  await context.route('**/chat/completions', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    aiBodies.push(r.request().postData() ?? '');
    return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: chatBody(PLAN) });
  });
  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key', llmKey: 'test-key' }) });
  return aiBodies;
}

/** Pulsa algo que abre la pestaña de Wikiloc y devuelve la ventana de la app que abre el marcador simulado. */
async function viaBookmarklet(page: Page, click: () => Promise<void>, expectWikiloc: RegExp): Promise<Page> {
  const context = page.context();
  const opened: Page[] = [];
  const onPage = (p: Page) => opened.push(p);
  context.on('page', onPage);
  try {
    await click();
    // Primero la pestaña de Wikiloc; el marcador simulado abre la app al cargar.
    await expect.poll(() => opened.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  } finally {
    context.off('page', onPage);
  }
  const [tab, app] = opened;
  await tab.waitForURL(expectWikiloc);
  return app;
}

const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const theme of ['light', 'dark'] as const) {
  for (const width of [360, 430]) {
    test(`Wikiloc cerca: lista, IA, adaptación y envío (${theme}, ${width} px)`, async ({ page }) => {
      const dir = 'test-results/wikiloc-cerca';
      mkdirSync(dir, { recursive: true });
      const viewport = { width, height: 860 };
      await page.setViewportSize(viewport);
      await page.context().addInitScript((t) => localStorage.setItem('fbt-theme', t), theme);
      const aiBodies = await setup(page);

      // 1. Lo que quiero hacer hoy y «Buscar en Wikiloc».
      await page.goto('#/rutas');
      await page.getByRole('link', { name: /Rutas de Wikiloc cerca/ }).click();
      await page.getByLabel('Distancia').fill('30');
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${dir}/vacia-${theme}-${width}.png`, fullPage: true });
      const app = await viaBookmarklet(page, () => page.getByRole('button', { name: 'Buscar en Wikiloc' }).click(), /\/wikiloc\/map\.do\?.*act=29/);
      await app.setViewportSize(viewport);

      // 2. La lista recibida, ordenada por lo pedido.
      const list = app.getByRole('list', { name: 'Rutas que encajan' });
      await expect(list.getByRole('listitem')).toHaveCount(4);
      await expect(list.getByRole('listitem').first()).toContainText('Vuelta sintética al embalse');
      await expect(app.getByText('1 ruta descartada')).toBeVisible();
      expect(await noOverflow(app)).toBe(true);
      await app.screenshot({ path: `${dir}/lista-${theme}-${width}.png`, fullPage: true });

      // 3. La recomendación de la IA, sin coordenadas ni enlaces.
      await app.getByRole('button', { name: 'Pedir recomendación a la IA' }).click();
      const picks = app.getByRole('list', { name: 'Recomendadas por la IA' });
      await expect(picks.getByRole('listitem')).toHaveCount(3);
      await expect(picks).toContainText('La más cercana a tus 30 km.');
      expect(aiBodies.length).toBe(1);
      for (const body of aiBodies) {
        expect(body).not.toMatch(/wikiloc\.com|Autora sintética|sintetica-10\d|\b(lat|lng|lon|trkpt|coordinates)\b/i);
        expect(body).not.toContain(String(HOME.lat));
        expect(body).not.toContain(String(HOME.lng));
        // Los datos que salen (no el esquema de respuesta) no llevan ningún enlace.
        const { messages } = JSON.parse(body) as { messages: { content: string }[] };
        for (const m of messages) expect(m.content).not.toMatch(/https?:/);
      }
      expect(await noOverflow(app)).toBe(true);
      await app.screenshot({ path: `${dir}/ia-${theme}-${width}.png`, fullPage: true });

      // 4. «Adaptar esta ruta» abre la ficha; el marcador entrega el GPX y se abre la adaptación.
      const first = list.getByRole('listitem').first();
      const adapted = await viaBookmarklet(app, () => first.getByRole('button', { name: /Adaptar esta ruta/ }).click(), /\/rutas-ciclismo\/sintetica-101/);
      await adapted.setViewportSize(viewport);
      const region = adapted.getByRole('region', { name: 'Ruta adaptada', exact: true });
      await expect(region).toBeVisible({ timeout: 20_000 });
      await expect(region).toContainText('Distancia');
      await expect(region).toContainText('30 km');
      await expect(region).toContainText('empezar y acabar en tu inicio');
      await expect(adapted.getByRole('link', { name: /Ver en Wikiloc · Autora sintética 101/ })).toHaveAttribute('rel', 'noopener noreferrer');
      // El trazado adaptado se dibuja en el mapa de CyclOSM, con su atribución.
      await expect(adapted.locator('.wk-map .rmap-core')).toBeVisible();
      await expect(adapted.locator('.wk-map .leaflet-control-attribution')).toContainText('CyclOSM');
      expect(await noOverflow(adapted)).toBe(true);
      // Las dos salidas se leen enteras, sin cortar con puntos suspensivos.
      const salida = adapted.getByRole('group', { name: 'Salida' });
      await expect(salida.getByRole('button', { name: 'Desde mi inicio' })).toBeVisible();
      await expect(salida.getByRole('button', { name: 'Desde el inicio de la ruta' })).toBeVisible();
      expect(await salida.locator('button span').evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth))).toBe(true);
      await adapted.screenshot({ path: `${dir}/adaptada-${theme}-${width}.png`, fullPage: true });

      // 5. «Enviar al iGPSPORT»: en el ordenador, la descarga del GPX.
      const download = adapted.waitForEvent('download');
      await adapted.getByRole('button', { name: 'Enviar al iGPSPORT' }).click();
      expect((await download).suggestedFilename()).toMatch(/^wikiloc-adaptada-30km\.gpx$/);
    });
  }
}
