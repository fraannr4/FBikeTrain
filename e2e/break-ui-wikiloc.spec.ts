import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from './accountFixture';
import { auditContrast } from './contrast';
import { HOME, NOW, RIDES, seed, settings } from './seed';

// Peor caso realista (skill break-ui) para «Rutas de Wikiloc cerca» y «Adaptar ruta de Wikiloc».
// Todo es sintético: los datos entran por el almacén `wikilocNearby` de la base de la cuenta, con
// los límites del esquema (wikilocNearby.ts: nombre 120, autor 80, km 0-1000, desnivel 0-20.000,
// 50 rutas como mucho). Nunca se sale a wikiloc.com; ORS y la nube real están cortados.
test.setTimeout(120_000);

const DIR = 'test-results/break-ui-wikiloc';
const URL = (id: string) => `https://es.wikiloc.com/rutas-ciclismo/sintetica-${id}`;

// 120 unidades UTF-16, el máximo del esquema; con emoji, diacríticos y guiones largos.
const LONG_NAME = 'Vuelta sintética a la Sierra — Navacerrada · Cotos · Morcuera · Canencia 🚴‍♀️🏔️ con Aleksandra Wiśniewska-Kowalczyk y';
const UNBROKEN_NAME = 'VueltaSinteticaPorLaSierraDeGuadarrama_Navacerrada_Cotos_Morcuera_Canencia_MirafloresDeLaSierra_BustarviejoYValdemanco';
const ARABIC_NAME = 'رحلة الدراجة الصباحية على طريق الساحل من الميناء إلى الجبل';
const VIET_NAME = 'Đường đèo Hải Vân — vòng xe đạp tổng hợp qua Lăng Cô và Đà Nẵng';
// 80 unidades UTF-16, el máximo del autor.
const LONG_AUTHOR = 'Aleksandra Wiśniewska-Kowalczyk · Club Ciclista Sintético de la Sierra Norte 🚴';
const UNBROKEN_AUTHOR = 'bartholomew.fitzgerald@northwind-industries-holdings.example.com';

type Card = { id: string; nombre: string; km: number; desnivelM: number | null; dificultad: string | null; autor: string | null; url: string };
const card = (id: string, nombre: string, km: number, desnivelM: number | null, autor: string | null): Card =>
  ({ id, nombre, km, desnivelM, dificultad: 'moderado', autor, url: URL(id) });

const WORST: Card[] = [
  card('1', LONG_NAME, 30, 420, LONG_AUTHOR),
  card('2', UNBROKEN_NAME, 29.6, null, UNBROKEN_AUTHOR),
  card('3', ARABIC_NAME, 33, 20_000, 'سارة'),
  card('4', VIET_NAME, 15, 0, null),
  card('5', 'A', 48, 900, 'Jo'),
  card('6', LONG_NAME.replace('Sierra', 'Sierro'), 0, null, LONG_AUTHOR),
  card('7', UNBROKEN_NAME.replace('Bustarviejo', 'Bustarviejx'), 1000, 20_000, UNBROKEN_AUTHOR),
  ...Array.from({ length: 43 }, (_, i) => card(String(100 + i), `${LONG_NAME.slice(0, 100)} ${i + 1}`, 14 + (i % 36), i % 5 === 0 ? null : 200 + i * 37, i % 2 ? LONG_AUTHOR : null)),
];

function circuitGpx(km: number, n: number): string {
  const r = (km * 1000) / (2 * Math.PI);
  const mLat = 111_320;
  const mLng = mLat * Math.cos((HOME.lat * Math.PI) / 180);
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const t = ((i % n) / n) * 2 * Math.PI;
    const lat = HOME.lat + (r + r * Math.cos(t)) / mLat;
    const lng = HOME.lng + (r * Math.sin(t)) / mLng;
    return `<trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><ele>${(650 + 40 * Math.sin(3 * t)).toFixed(1)}</ele></trkpt>`;
  });
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>Vuelta sintética</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

type Rows = { nearby?: Card[]; track?: { nombre: string; autor: string | null; gpx: string }; request?: { distanceKm: number; elevGainM: number | null } };

async function putWikiloc(page: Page, rows: Rows, savedAt: number) {
  await page.evaluate(async ({ rows, savedAt, home, url }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ciclismo-user-00000000-0000-0000-0000-000000000011');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['wikilocNearby'], 'readwrite');
    const store = tx.objectStore('wikilocNearby');
    if (rows.nearby) store.put({ key: 'nearby', savedAt, rutas: rows.nearby });
    if (rows.track) store.put({ key: 'track', savedAt, track: { v: 1, kind: 'track', id: '1', url, ...rows.track } });
    if (rows.request) store.put({ key: 'request', request: { ...rows.request, start: home } });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  }, { rows, savedAt, home: HOME, url: URL('1') });
}

async function open(page: Page, theme: 'light' | 'dark', width: number, rows: Rows, hash: string) {
  await page.setViewportSize({ width, height: 800 });
  await page.addInitScript((t) => localStorage.setItem('fbt-theme', t), theme);
  await page.clock.setFixedTime(NOW);
  await page.route('https://api.heigit.org/**', (r) => r.abort());
  await page.route(/tile-cyclosm|tile\.openstreetmap/, (r) => r.abort());
  await page.route('https://*.wikiloc.com/**', (r) => r.abort());
  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key', llmKey: '' }) });
  await putWikiloc(page, rows, NOW.getTime() - 3600_000);
  await page.goto(hash);
}

/** Lo que rompe el uso a esta anchura: scroll lateral, cajas fuera de pantalla, texto cortado, botones pequeños. */
function layoutProblems(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const W = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > W) out.push(`scroll lateral: ${document.documentElement.scrollWidth} > ${W}`);
    const name = (el: Element) => `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').trim().split(/\s+/).join('.')} "${(el.textContent || '').trim().slice(0, 30)}" en ${el.parentElement?.closest('[class]')?.getAttribute('class') ?? ''}`;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || el.closest('.leaflet-container')) continue;
      if (r.right > W + 0.5 || r.left < -0.5) out.push(`fuera de pantalla (${Math.round(r.left)}-${Math.round(r.right)}): ${name(el)}`);
      const cs = getComputedStyle(el);
      if (el.children.length === 0 && (el.textContent || '').trim() && cs.overflow !== 'visible' && el.scrollWidth > el.clientWidth + 1) out.push(`texto cortado: ${name(el)}`);
    }
    for (const el of document.querySelectorAll('main button, main a.btn, main input')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.height < 44 || r.width < 44)) out.push(`zona táctil ${Math.round(r.width)}x${Math.round(r.height)}: ${name(el)}`);
    }
    return [...new Set(out)];
  });
}

test.beforeAll(() => mkdirSync(DIR, { recursive: true }));

for (const theme of ['light', 'dark'] as const) {
  for (const width of [360, 430]) {
    test.describe(`${theme} ${width} px`, () => {
      test('Wikiloc cerca: 50 rutas con nombres, autores y km extremos', async ({ page }) => {
        for (const c of WORST) {
          expect(c.nombre.length, c.nombre).toBeLessThanOrEqual(120);
          expect((c.autor ?? '').length, c.autor ?? '').toBeLessThanOrEqual(80);
        }
        expect(WORST).toHaveLength(50);
        await open(page, theme, width, { nearby: WORST, track: { nombre: LONG_NAME, autor: UNBROKEN_AUTHOR, gpx: circuitGpx(30, 320) } }, '#/rutas/wikiloc');
        await page.getByLabel('Distancia').fill('30');
        const list = page.getByRole('list', { name: 'Rutas que encajan' });
        await expect(list.getByRole('listitem').first()).toBeVisible();
        const shown = await list.getByRole('listitem').count();
        await page.getByText(/rutas? descartadas?/).click();
        await page.screenshot({ path: `${DIR}/lista50-${theme}-${width}.png`, fullPage: true });
        const problems = await layoutProblems(page);
        const contrast = await auditContrast(page);
        console.log(`[lista50 ${theme} ${width}] encajan=${shown} problemas=${JSON.stringify(problems)} contraste=${JSON.stringify(contrast.contrast)}`);
        expect(problems).toEqual([]);
        expect(contrast.contrast).toEqual([]);
      });

      test('Wikiloc cerca: 0 rutas recibidas', async ({ page }) => {
        await open(page, theme, width, { nearby: [] }, '#/rutas/wikiloc');
        await page.getByLabel('Distancia').fill('30');
        await expect(page.getByRole('heading', { name: /No ha llegado ninguna ruta/ })).toBeVisible();
        const text = await page.locator('main').innerText();
        console.log(`[lista0 ${theme} ${width}] ${text.replace(/\s+/g, ' ').slice(0, 600)}`);
        await page.screenshot({ path: `${DIR}/lista0-${theme}-${width}.png`, fullPage: true });
        expect(await layoutProblems(page)).toEqual([]);
        // Con 0 rutas no tiene sentido «Ninguna ruta encaja con 30 km»: no ha llegado ninguna.
        expect(text).not.toMatch(/0 rutas recibidas/);
      });

      test('Adaptar: nombre de 120 y autor sin espacios, 400 km frente a 1.000 km y 20.000 m', async ({ page }) => {
        await open(page, theme, width, {
          track: { nombre: LONG_NAME, autor: UNBROKEN_AUTHOR, gpx: circuitGpx(400, 8000) },
          request: { distanceKm: 1000, elevGainM: 20_000 },
        }, '#/rutas/wikiloc/adaptar');
        await expect(page.getByRole('heading', { name: LONG_NAME })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Ruta adaptada', exact: true }).or(page.getByText('No se ha podido adaptar la ruta'))).toBeVisible({ timeout: 30_000 });
        await page.screenshot({ path: `${DIR}/adaptar400-${theme}-${width}.png`, fullPage: true });
        const text = await page.locator('main').innerText();
        console.log(`[adaptar400 ${theme} ${width}] ${text.replace(/\s+/g, ' ').slice(0, 900)}`);
        const problems = await layoutProblems(page);
        const contrast = await auditContrast(page);
        console.log(`[adaptar400 ${theme} ${width}] problemas=${JSON.stringify(problems)} contraste=${JSON.stringify(contrast.contrast)}`);
        expect(problems).toEqual([]);
        expect(contrast.contrast).toEqual([]);
      });
    });
  }
}

test.describe('Adaptar con éxito y textos largos', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`autor de 80 con espacios, circuito de 30 km (${theme}, 360 px)`, async ({ page }) => {
      await open(page, theme, 360, {
        track: { nombre: ARABIC_NAME, autor: LONG_AUTHOR, gpx: circuitGpx(30, 320) },
        request: { distanceKm: 30, elevGainM: 20_000 },
      }, '#/rutas/wikiloc/adaptar');
      await expect(page.getByRole('region', { name: 'Ruta adaptada', exact: true })).toBeVisible({ timeout: 30_000 });
      const ws = await page.locator('a.btn--wrap').evaluate((e) => getComputedStyle(e).whiteSpace);
      console.log(`[adaptar30 ${theme}] white-space de .btn--wrap = ${ws}`);
      await page.screenshot({ path: `${DIR}/adaptar30-${theme}-360.png`, fullPage: true });
      const problems = await layoutProblems(page);
      console.log(`[adaptar30 ${theme}] problemas=${JSON.stringify(problems)}`);
      expect(problems).toEqual([]);
    });
  }
});

test.describe('cifras extremas en el texto', () => {
  test('pedir 1 km: rutas de 0,4 / 0,6 / 1,4 km', async ({ page }) => {
    await open(page, 'light', 360, { nearby: [card('1', 'Corta A', 0.4, 10, null), card('2', 'Corta B', 0.6, 10, null), card('3', 'Corta C', 1.4, 10, null)] }, '#/rutas/wikiloc');
    await page.getByLabel('Distancia').fill('1');
    await expect(page.getByRole('list', { name: 'Rutas que encajan' })).toBeVisible();
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    console.log(`[1km] ${text}`);
    // Con 0 decimales sale «Se alarga de 1 km a 1 km» o «Encaja: 1 km frente a 1 km».
    expect(text).not.toMatch(/de (\d+) km a \1 km\b/);
  });

  test('desnivel escrito con punto de miles: «1.200» m', async ({ page }) => {
    await open(page, 'light', 360, { nearby: [card('1', 'Puerto', 30, 1200, null)] }, '#/rutas/wikiloc');
    await page.getByLabel('Distancia').fill('30');
    await page.getByLabel('Desnivel (opcional)').fill('1.200');
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    console.log(`[1.200 m] ${text.match(/Desnivel:[^.]*\./)?.[0] ?? '(sin motivo de desnivel)'}`);
    expect(text).not.toMatch(/frente a 1 m pedidos/);
  });

  test('distancia escrita con punto de miles: «1.000» km', async ({ page }) => {
    await open(page, 'light', 360, { nearby: [card('1', 'Larguísima', 1000, 0, null)] }, '#/rutas/wikiloc');
    await page.getByLabel('Distancia').fill('1.000');
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    console.log(`[1.000 km] ${text.slice(0, 500)}`);
    expect(text).not.toMatch(/para 1 km|con 1 km/);
  });
});
