import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from './accountFixture';
import { HOME, NOW, RIDES, seed, settings } from './seed';

// break-ui de #/rutas a 360 px: peores datos realistas por la misma frontera que los datos normales
// (biblioteca común `route-sources` y ORS simulados). Todo sintético; el navegador no sale a internet.
test.setTimeout(150_000);

type LatLng = { lat: number; lng: number };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((HOME.lat * Math.PI) / 180);
const DIR = 'test-results/rutas';
const fromXY = (x: number, y: number): LatLng => ({ lat: HOME.lat + y / M_LAT, lng: HOME.lng + x / M_LNG });
const toXY = (p: LatLng) => ({ x: (p.lng - HOME.lng) * M_LNG, y: (p.lat - HOME.lat) * M_LAT });

/** Nombre de 300 caracteres sin un solo espacio (límite de la prueba del plan). */
const NO_SPACES = 'VoltaPerLesCarreteresDelVallesOrientalIElMoianesAmbPortDeLaCreuDeGuardiaIColldeCanBatlle'.repeat(4).slice(0, 300);
/** Otro alfabeto y emoji compuesto. */
const OTHER_SCRIPT = `Велосипедный маршрут 🚴‍♀️🏔️ 山岳ルート・カタルーニャ ${'ΔρόμοςΒουνού'.repeat(12)}`.slice(0, 300);

function circuit(km: number, deg: number, n: number): LatLng[] {
  const r = (km * 1000) / (2 * Math.PI);
  const a = (deg * Math.PI) / 180;
  const cx = Math.sin(a) * r;
  const cy = Math.cos(a) * r;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = Math.atan2(-cy, -cx) + (i / n) * 2 * Math.PI;
    return fromXY(cx + r * Math.cos(t), cy + r * Math.sin(t));
  });
}

const LIBRARY = [
  { id: 'ref-801', deg: 0, km: 59.5, name: NO_SPACES, author: '' },
  { id: 'ref-802', deg: 184, km: 60.5, name: OTHER_SCRIPT, author: '   ' },
].map((r) => ({ ...r, line: circuit(r.km, r.deg, 400) }));

const gapM = (a: LatLng, b: LatLng) => Math.hypot(toXY(a).x - toXY(b).x, toXY(a).y - toXY(b).y);

/** Puntos cada 400 m como mucho (copia de e2e/rutas.spec.ts). */
function densify(points: LatLng[]): LatLng[] {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = toXY(points[i - 1]);
    const b = toXY(points[i]);
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 400));
    for (let k = 1; k <= n; k++) out.push(fromXY(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n));
  }
  return out;
}

/** Vuelta de 60 km por los puntos pedidos, sin repetir carretera (copia de e2e/rutas.spec.ts). */
function loop60(waypoints: LatLng[]): LatLng[] {
  const xy = waypoints.map(toXY);
  const legs = xy.slice(1).map((b, i) => Math.hypot(b.x - xy[i].x, b.y - xy[i].y));
  const f = Math.max(1, 60_000 / legs.reduce((s, l) => s + l, 0));
  const out = [waypoints[0]];
  xy.slice(1).forEach((b, i) => {
    const a = xy[i];
    const l = legs[i] || 1;
    const h = (l / 2) * Math.sqrt(f * f - 1);
    out.push(fromXY((a.x + b.x) / 2 + ((b.y - a.y) / l) * h, (a.y + b.y) / 2 - ((b.x - a.x) / l) * h), waypoints[i + 1]);
  });
  return densify(out);
}

/** Tramo de una ruta de la biblioteca entre dos puntos suyos; `null` si no están en ella. */
function along(line: LatLng[], a: LatLng, b: LatLng): LatLng[] | null {
  const nearest = (p: LatLng) => line.reduce((best, q, i) => (gapM(p, q) < gapM(p, line[best]) ? i : best), 0);
  const i = nearest(a);
  const j = nearest(b);
  if (gapM(a, line[i]) > 200 || gapM(b, line[j]) > 200) return null;
  const n = line.length - 1;
  const out: LatLng[] = [];
  for (let k = i; k !== j; k = (k + 1) % n) out.push(line[k]);
  out.push(line[j]);
  return out;
}

function road(wps: LatLng[]): LatLng[] {
  for (const { line } of LIBRARY) {
    const legs = wps.slice(1).map((b, i) => along(line, wps[i], b));
    if (legs.every((l) => l !== null)) return legs.flatMap((l, i) => (i === 0 ? l! : l!.slice(1)));
  }
  return loop60(wps);
}

function feature(points: LatLng[]) {
  const n = points.length - 1;
  const coordinates = points.map((p, i) => [p.lng, p.lat, 650 + 300 * (1 - Math.abs((2 * i) / n - 1))]);
  const all = (value: number) => ({ values: [[0, n, value]], summary: [{ value, distance: 60_000, amount: 100 }] });
  return { type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { summary: { distance: 60_000, duration: 9000 }, extras: { surface: all(3), waytypes: all(2), steepness: all(0), waycategory: all(0) } } };
}

const CELLS = Array.from({ length: 31 * 31 }, (_, i) => {
  const p = fromXY((Math.floor(i / 31) - 15) * 1000, ((i % 31) - 15) * 1000);
  return [Number(p.lat.toFixed(5)), Number(p.lng.toFixed(5)), 3, null];
});

type Opts = { slowAfter?: number; quotaAfter?: number };

async function setup(page: Page, opts: Opts = {}) {
  const context = page.context();
  let ors = 0;
  await context.clock.setFixedTime(NOW);
  await context.route('https://*.supabase.co/**', (r) => r.abort());
  await page.route('https://api.heigit.org/openrouteservice/**', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    ors++;
    if (opts.quotaAfter !== undefined && ors > opts.quotaAfter) return r.fulfill({ status: 403, contentType: 'application/json', headers: CORS, body: '{"error":"Quota exceeded"}' });
    if (opts.slowAfter !== undefined && ors > opts.slowAfter) await new Promise((res) => setTimeout(res, 20_000));
    const ask = JSON.parse(r.request().postData() ?? '{}');
    const coords = (ask.coordinates ?? []) as [number, number][];
    const body = coords.length < 2 ? { error: { code: 2009 } } : { type: 'FeatureCollection', features: [feature(road(coords.map(([lng, lat]) => ({ lat, lng }))))] };
    try {
      await r.fulfill({ status: coords.length < 2 ? 404 : 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
    } catch {
      // cancelada
    }
  });
  await page.route('https://*.supabase.co/functions/v1/route-sources', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const ask = JSON.parse(r.request().postData() ?? '{}');
    const data = ask.kind === 'library'
      ? {
          routeCount: 20, cells: CELLS, zoneFactor: 1.75, factorSamples: 10, climbMPerKm: null, fill: 'none',
          routes: LIBRARY.map((r) => ({ id: r.id, source: 'rwgps', url: `https://ridewithgps.com/routes/${r.id.slice(4)}`, name: r.name, author: r.author, distanceM: r.km * 1000, elevGainM: 600, loop: true, passM: 0, line: r.line.map((p) => [p.lng, p.lat, 650]) })),
        }
      : [];
    return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ data }) });
  });
  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
}

async function propose(page: Page, km: string, gain = '') {
  await page.getByLabel('Distancia').fill(km);
  await page.getByLabel('Desnivel (opcional)').fill(gain);
  await page.getByRole('button', { name: 'Proponer rutas' }).click();
}

/** Lo que rompe el uso: scroll lateral, botones pequeños, títulos en varias líneas, cifras crudas, «·» colgando. */
async function usable(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin scroll lateral').toBe(true);
  const heights = await page.locator('main button:visible, main a.btn:visible').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  for (const h of heights) expect(h, 'objetivo táctil').toBeGreaterThanOrEqual(44);
  const widths = await page.locator('main article').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
  for (const right of widths) expect(right).toBeLessThanOrEqual(360);
  for (const h3 of await page.locator('main article h3').all()) {
    const { lines, overflow } = await h3.evaluate((el) => ({ lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)), overflow: getComputedStyle(el).textOverflow }));
    expect.soft(lines, `nombre en una línea: ${(await h3.innerText()).slice(0, 30)}`).toBe(1);
    expect.soft(overflow, 'elipsis').toBe('ellipsis');
    expect.soft((await h3.getAttribute('title'))?.length ?? 0, 'nombre completo en title').toBeGreaterThan(0);
  }
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/\bNaN\b|\bundefined\b|\bnull\b|Infinity/);
  for (const origin of await page.locator('main article .nb-origin').allInnerTexts()) expect(origin.trim()).not.toMatch(/·\s*$/);
}

test.describe('break-ui #/rutas a 360 px', () => {
  test.beforeEach(async ({ page }) => {
    mkdirSync(DIR, { recursive: true });
    await page.setViewportSize({ width: 360, height: 740 });
  });

  test('nombres de 300 caracteres sin espacios, otro alfabeto y autor vacío: 5 tarjetas', async ({ page }) => {
    await setup(page);
    await page.goto('#/rutas');
    await propose(page, '60');
    await expect(page.getByRole('button', { name: 'Cancelar' })).toHaveCount(0, { timeout: 120_000 });
    const cards = page.getByRole('article');
    const n = await cards.count();
    test.info().annotations.push({ type: 'tarjetas', description: String(n) });
    expect(n).toBeGreaterThanOrEqual(3);
    await expect(cards.nth(0)).toContainText('De la biblioteca · Ride with GPS');
    await expect.soft(cards.nth(0).getByRole('heading', { level: 3 })).toHaveText(NO_SPACES);
    await expect.soft(cards.nth(1).getByRole('heading', { level: 3 })).toHaveText(OTHER_SCRIPT);
    await usable(page);
    await page.screenshot({ path: `${DIR}/break-ui-${n}-tarjetas-360.png`, fullPage: true });
  });

  test('3 tarjetas: se cancela con la tercera aceptada', async ({ page }) => {
    await setup(page, { slowAfter: 3 });
    await page.goto('#/rutas');
    await propose(page, '60');
    const cards = page.getByRole('article');
    await expect(cards).toHaveCount(3, { timeout: 60_000 });
    await usable(page);
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(cards).toHaveCount(3);
    await usable(page);
    await page.screenshot({ path: `${DIR}/break-ui-3-tarjetas-360.png`, fullPage: true });
  });

  test('300 km y 20.000 m con la cuota de ORS agotada: 0 tarjetas y avisos largos', async ({ page }) => {
    await setup(page, { quotaAfter: 0 });
    await page.goto('#/rutas');
    await propose(page, '300', '20000');
    const notice = page.getByRole('region', { name: 'Avisos de la búsqueda' });
    await expect(notice).toBeVisible({ timeout: 60_000 });
    const warnings = await notice.locator('.nb-warning').allInnerTexts();
    test.info().annotations.push({ type: 'avisos', description: JSON.stringify(warnings) });
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    await expect(notice).toContainText('300 km');
    await expect(notice).toContainText('20.000 m');
    await expect(page.getByRole('article')).toHaveCount(0);
    await usable(page);
    const box = await notice.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `${DIR}/break-ui-avisos-360.png`, fullPage: true });
  });

  test('por encima de los límites (301 km, 20.001 m) el formulario lo explica y no busca', async ({ page }) => {
    await setup(page);
    await page.goto('#/rutas');
    await page.getByLabel('Distancia').fill('301');
    await page.getByLabel('Desnivel (opcional)').fill('20001');
    await page.getByRole('button', { name: 'Proponer rutas' }).click();
    await expect(page.getByText('Escribe la distancia en km, entre 1 y 300.').or(page.getByText(/entre \d+ y 300/))).toBeVisible();
    await expect(page.getByText('El desnivel va en metros, entre 0 y 20.000.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Avisos de la búsqueda' })).toHaveCount(0);
    await usable(page);
  });
});
