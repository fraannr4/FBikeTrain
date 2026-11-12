import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from './accountFixture';
import { HOME, NOW, RIDES, seed, settings } from './seed';

// break-ui de «Rutas cerca»: el peor caso realista entra por la misma frontera que los datos reales
// (funciones `rwgps`, `route-sources`, `ai-routes` y ORS simuladas, IndexedDB y geolocalización).
// Todo es sintético: ni tracks reales ni claves.
test.setTimeout(180_000);

type LatLng = { lat: number; lng: number };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((HOME.lat * Math.PI) / 180);
const D_KM = 60;
const DIR = 'test-results/break-ui-rutas-cerca';

const toXY = (p: LatLng) => ({ x: (p.lng - HOME.lng) * M_LNG, y: (p.lat - HOME.lat) * M_LAT });
const fromXY = (x: number, y: number): LatLng => ({ lat: HOME.lat + y / M_LAT, lng: HOME.lng + x / M_LNG });
const at = (deg: number, km: number) => fromXY(Math.sin((deg * Math.PI) / 180) * km * 1000, Math.cos((deg * Math.PI) / 180) * km * 1000);

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

function loopThrough(waypoints: LatLng[], km: number): LatLng[] {
  const xy = waypoints.map(toXY);
  const legs = xy.slice(1).map((b, i) => Math.hypot(b.x - xy[i].x, b.y - xy[i].y));
  const f = Math.max(1, (km * 1000) / legs.reduce((s, l) => s + l, 0));
  const out = [waypoints[0]];
  xy.slice(1).forEach((b, i) => {
    const a = xy[i];
    const l = legs[i] || 1;
    const h = (l / 2) * Math.sqrt(f * f - 1);
    out.push(fromXY((a.x + b.x) / 2 + ((b.y - a.y) / l) * h, (a.y + b.y) / 2 - ((b.x - a.x) / l) * h), waypoints[i + 1]);
  });
  return densify(out);
}

function orsFeature(points: LatLng[]) {
  const n = points.length - 1;
  const coordinates = points.map((p, i) => [p.lng, p.lat, 650 + 300 * (1 - Math.abs((2 * i) / n - 1))]);
  const all = (value: number) => ({ values: [[0, n, value]], summary: [{ value, distance: D_KM * 1000, amount: 100 }] });
  return {
    type: 'Feature', geometry: { type: 'LineString', coordinates },
    properties: { summary: { distance: D_KM * 1000, duration: 9000 }, extras: { surface: all(3), waytypes: all(2), steepness: all(0), waycategory: all(0) } },
  };
}

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

// ---- Peor caso realista (límites del esquema: nombre de OSM ≤ 80, nombre de Ride with GPS sin límite) ----
const LONG_RWGPS_NAME =
  'Vuelta a Mallorca 312 — Port d’Andratx · Sóller · Puig Major · Lluc · Formentor y vuelta 🚴‍♀️🏔️ (con Aleksandra Wiśniewska-Kowalczyk y el grupo de los domingos)';
const LONG_AUTHOR = 'Aleksandra Wiśniewska-Kowalczyk · Club Ciclista Northwind-Industries-Holdings 🚴‍♀️';
const WORST_NAMES = [
  'Llanfairpwllgwyngyllgogerychwyndrobwllllantysiliogogogoch',
  'Coll de Sa Batalla 🚴‍♀️🏔️ i Santuari de Lluc per la carretera vella',
  'جبل الشيخ عبر الطريق الساحلي القديم',
  '東京都西多摩郡奥多摩町 風張峠 都民の森 周遊道路',
  'Ζέστη ανάβαση στον Υμηττό από την Καισαριανή',
  'Puerto de la Quesera, Riaza, Segovia, Castilla y León (por la SG-112)',
  'X',
  'Перевал Кызыл-Арт, Памирский тракт, Горно-Бадахшанская АО',
];
const DEMO_NAMES = WORST_NAMES.map((_, i) => `Coll ${i + 1}`);

type Real = { id: string; deg: number; km: number; name: string; author: string };
const WORST_REAL: Real[] = [
  { id: '701', deg: 0, km: 59.5, name: LONG_RWGPS_NAME, author: LONG_AUTHOR },
  { id: '702', deg: 184, km: 60.5, name: 'رحلة الدراجة الصباحية إلى جبل الشيخ عبر الطريق الساحلي القديم', author: '' },
];
const RING = [0, 46, 92, 138, 184, 230, 276, 322];
const ring = (names: string[]) => RING.map((deg, i) => ({
  id: `osm-pass-${i + 1}`, kind: 'puerto', name: names[i].slice(0, 80), ...at(deg, 23), ele: 900, distanceM: 23_000, interes: 2,
}));

type Opts = {
  real?: Real[];
  /** Rutas extra en el índice común (la lista larga): ninguna tiene detalle. */
  extraIndex?: number;
  waypoints?: ReturnType<typeof ring>;
  activities?: unknown[];
  home?: LatLng | null;
};

async function setup(page: Page, opts: Opts = {}) {
  const context = page.context();
  const calls = { ors: 0, rwgps: 0, ai: 0, sources: 0 };
  const real = opts.real ?? WORST_REAL;
  await context.clock.setFixedTime(NOW);
  await context.route('https://*.supabase.co/**', (r) => r.abort());
  await context.route('https://*.wikiloc.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Wikiloc sintético</p>' }));
  await page.route(/tile-cyclosm|tile\.openstreetmap/, (r) => r.abort());

  const answerOrs = (coordinates: [number, number][] | undefined, roundTrip: boolean) => {
    calls.ors++;
    if (roundTrip || !coordinates || coordinates.length < 2) return { status: 404, body: { error: { code: 2009, message: 'sin ruta' } } };
    return { status: 200, body: { type: 'FeatureCollection', features: [orsFeature(loopThrough(coordinates.map(([lng, lat]) => ({ lat, lng })), D_KM))] } };
  };
  await page.route('https://api.heigit.org/openrouteservice/**', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const ask = JSON.parse(r.request().postData() ?? '{}');
    const { status, body } = answerOrs(ask.coordinates, !!ask.options?.round_trip);
    return r.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
  });
  await page.route('https://*.supabase.co/functions/v1/ors-proxy', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const ask = JSON.parse(r.request().postData() ?? '{}');
    const coords = ask.operation === 'path' ? (ask.waypoints as LatLng[]).map((p) => [p.lng, p.lat] as [number, number]) : undefined;
    const { status, body } = answerOrs(coords, ask.operation === 'round_trip');
    const shared = status === 200 ? { data: { features: body.features } } : { retryAfterS: 60 };
    return r.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(shared) });
  });

  await page.route('https://*.supabase.co/functions/v1/rwgps', (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    calls.rwgps++;
    const ask = JSON.parse(req.postData() ?? '{}');
    const json = (body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
    if (ask.op === 'nearby') {
      const routes = real.map((f) => ({
        id: f.id, name: f.name, author: f.author, distanceM: f.km * 1000, elevGainM: 600, start: HOME,
        line: circuit(f.km, f.deg, 200).map((p) => [p.lng, p.lat]), passM: 40,
      }));
      for (let i = 0; i < (opts.extraIndex ?? 0); i++) {
        routes.push({
          id: String(900_000 + i), name: `Ruta del índice ${i + 1}`, author: 'Autora sintética', distanceM: 300_000, elevGainM: 9000, start: at(i % 360, 30),
          line: circuit(300, i % 360, 40).map((p) => [p.lng, p.lat]), passM: 30_000,
        });
      }
      return json({ data: { routes, total: routes.length } });
    }
    const f = real.find((x) => x.id === ask.id);
    if (ask.kind !== 'route' || !f) return json({ error: { code: 'not_found', message: 'x' } }, 404);
    const track_points = circuit(f.km, f.deg, 720).map((p, i) => ({ x: p.lng, y: p.lat, e: 650 + 20 * Math.sin(i / 10) }));
    return json({ data: { route: { name: f.name, user: { name: f.author }, track_points } } });
  });

  await page.route('https://*.supabase.co/functions/v1/route-sources', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    calls.sources++;
    const ask = JSON.parse(r.request().postData() ?? '{}');
    const data = ask.kind === 'waypoints' ? (opts.waypoints ?? ring(WORST_NAMES)) : [];
    return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ data }) });
  });

  await page.route('https://*.supabase.co/functions/v1/ai-routes', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    calls.ai++;
    const ask = JSON.parse(r.request().postData() ?? '{}');
    if (ask.operation !== 'waypoints') return r.fulfill({ status: 400, contentType: 'application/json', headers: CORS, body: '{}' });
    const puntos = ask.puntos as { id: string; direccion: string }[];
    const combinaciones = ['este', 'suroeste'].flatMap((direccion) => {
      const p = puntos.find((x) => x.direccion === direccion);
      return p ? [{ puntos: [p.id], direccion, titulo: `Vuelta por el ${direccion} 🚴‍♀️ con un título larguísimo que nadie pidió` }] : [];
    });
    return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ data: { combinaciones } }) });
  });

  await seed(page, { activities: opts.activities ?? RIDES, settings: settings({ orsKey: 'test-key', home: opts.home === undefined ? HOME : opts.home }) });
  return calls;
}

const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

/** Fallos de maquetación de cada tarjeta: algo sale de la tarjeta o un control queda por debajo de 44 px. */
async function cardBreaks(page: Page) {
  return page.locator('article').evaluateAll((cards) =>
    cards.flatMap((card, i) => {
      const box = card.getBoundingClientRect();
      const out: string[] = [];
      if (card.scrollWidth > card.clientWidth + 1) out.push(`tarjeta ${i}: desborda (${card.scrollWidth} > ${card.clientWidth})`);
      for (const el of card.querySelectorAll<HTMLElement>('button, a, h2, h3, p, dd')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < box.left - 1 || r.right > box.right + 1) out.push(`tarjeta ${i}: «${el.textContent?.trim().slice(0, 40)}» sale de la tarjeta`);
        if ((el.tagName === 'BUTTON' || el.classList.contains('btn')) && r.height < 44) out.push(`tarjeta ${i}: «${el.textContent?.trim().slice(0, 40)}» mide ${Math.round(r.height)} px`);
      }
      return out;
    }),
  );
}

async function propose(page: Page, km = '60') {
  await page.goto('#/rutas/cerca');
  await expect(page.getByRole('heading', { level: 1, name: 'Rutas cerca' })).toBeVisible();
  await page.getByLabel('Distancia').fill(km);
  await page.getByRole('button', { name: 'Proponer rutas' }).click();
  await expect(page.getByRole('button', { name: 'Cancelar' })).toHaveCount(0, { timeout: 150_000 });
}

test.beforeAll(() => mkdirSync(DIR, { recursive: true }));

for (const width of [320, 360, 430]) {
  test(`peor caso de nombres a ${width} px: nada sale de las tarjetas y todo se puede pulsar`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await setup(page);
    await propose(page);
    const cards = page.getByRole('article');
    expect(await cards.count()).toBeGreaterThanOrEqual(5);
    expect(await noOverflow(page)).toBe(true);
    expect(await cardBreaks(page)).toEqual([]);
    // La autora larga sin el sufijo, y la ruta sin autora con el origen genérico.
    await expect(cards.nth(0)).toContainText('Ride with GPS · Aleksandra Wiśniewska-Kowalczyk');
    const origins = await page.locator('article .nb-origin').allTextContents();
    test.info().annotations.push({ type: 'origenes', description: JSON.stringify(origins.slice(0, 2)) });
    expect(origins[0]).toBe(`Ride with GPS · ${LONG_AUTHOR}`);
    // Los nombres de puntos de paso, completos en el atributo title y en el mapa.
    const motor = cards.filter({ hasText: 'Motor FBikeTrain' });
    const titles = await motor.getByRole('heading', { level: 3 }).evaluateAll((hs) => hs.map((h) => h.getAttribute('title') ?? ''));
    expect(titles.every((t) => t.length > 0)).toBe(true);
    await page.screenshot({ path: `${DIR}/peor-caso-${width}.png`, fullPage: true });

    // El mapa de una vuelta con el nombre más largo: se abre, se lee y se cierra.
    const longest = titles.reduce((a, b) => (b.length > a.length ? b : a), '');
    const card = motor.filter({ has: page.locator(`h3[title="${longest.replace(/"/g, '\\"')}"]`) }).first();
    await card.getByRole('button', { name: /Mapa/ }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: longest })).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    const sheetActions = await sheet.locator('button').evaluateAll((bs) => bs.map((b) => {
      const r = b.getBoundingClientRect();
      return { t: b.textContent?.trim() ?? b.getAttribute('aria-label'), inside: r.left >= 0 && r.right <= innerWidth, h: r.height };
    }));
    expect(sheetActions.filter((a) => !a.inside)).toEqual([]);
    await page.screenshot({ path: `${DIR}/peor-caso-mapa-${width}.png` });
    await sheet.getByRole('button', { name: 'Cerrar el mapa' }).click();
    await expect(sheet).toBeHidden();
  });
}

test('cero salidas, cero rutas reales y cero puntos de paso: lo dice y se puede volver a probar', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await setup(page, { real: [], waypoints: [], activities: [] });
  await propose(page);
  await expect(page.getByRole('article')).toHaveCount(0);
  const notice = page.getByRole('region', { name: 'Avisos de la búsqueda' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Menos vueltas de las buscadas');
  await expect(notice).toContainText(/Solo 0 vueltas cumplen/);
  await expect(page.getByRole('button', { name: 'Proponer rutas' })).toBeEnabled();
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: `${DIR}/cero-360.png`, fullPage: true });
});

test('una sola vuelta: singular correcto', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await setup(page, { real: [WORST_REAL[0]], waypoints: [] });
  await propose(page);
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Avisos de la búsqueda' })).toContainText('Solo 1 vuelta cumple');
  await page.screenshot({ path: `${DIR}/una-360.png`, fullPage: true });
});

test('índice común enorme (1.000 rutas que no encajan) no bloquea la pantalla', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const calls = await setup(page, { extraIndex: 1000, waypoints: ring(DEMO_NAMES) });
  const t0 = Date.now();
  await propose(page);
  const ms = Date.now() - t0;
  expect(await page.getByRole('article').count()).toBeGreaterThanOrEqual(5);
  // Solo se piden los detalles de las que encajan: la lista larga no se recorre entera por la red.
  expect(calls.rwgps).toBeLessThan(20);
  expect(await noOverflow(page)).toBe(true);
  test.info().annotations.push({ type: 'tiempo', description: `${ms} ms con 1.000 rutas en el índice` });
});

test('salida de 400 km y cifras raras: error junto al campo, foco en él y ninguna petición', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const calls = await setup(page);
  await page.goto('#/rutas/cerca');
  const distance = page.getByLabel('Distancia');
  for (const value of ['400', '5.000', '60 km 🚴', '-60', '0']) {
    await distance.fill(value);
    await expect(distance).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Escribe la distancia en km, entre 5 y 300.')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Proponer rutas' }).click();
  await expect(distance).toBeFocused();
  // El límite exacto se acepta, con coma decimal.
  await distance.fill('300');
  await expect(distance).not.toHaveAttribute('aria-invalid', 'true');
  await distance.fill('62,5');
  await expect(distance).not.toHaveAttribute('aria-invalid', 'true');
  const gain = page.getByLabel('Desnivel (opcional)');
  await gain.fill('25000');
  await expect(gain).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Proponer rutas' }).click();
  expect(calls.ors + calls.rwgps + calls.ai + calls.sources).toBe(0);
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: `${DIR}/cifras-360.png`, fullPage: true });
});

test('sin GPS y sin Casa: lo explica, no busca y Wikiloc pide el inicio', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.context().clearPermissions();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: unknown, fail: (e: { code: number; message: string }) => void) => setTimeout(() => fail({ code: 1, message: 'denied' }), 50) },
    });
  });
  const calls = await setup(page, { home: null });
  await page.goto('#/rutas/cerca');
  await expect(page.getByRole('heading', { level: 1, name: 'Rutas cerca' })).toBeVisible();
  // Sin Casa no se ofrece «Casa».
  await expect(page.getByRole('button', { name: 'Casa', exact: true })).toHaveCount(0);
  await page.getByLabel('Distancia').fill('60');
  await page.getByRole('button', { name: 'Aquí', exact: true }).click();
  await expect(page.getByText('No se ha podido leer tu ubicación. Revisa el permiso del navegador o elige en el mapa.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Volver a intentarlo' })).toBeVisible();
  await page.getByRole('button', { name: 'Proponer rutas' }).click();
  await expect(page.getByText('Falta tu ubicación.')).toBeVisible();
  expect(calls.ors + calls.rwgps + calls.ai + calls.sources).toBe(0);
  await page.getByText('¿Buscas en Wikiloc?').click();
  const popups: unknown[] = [];
  page.on('popup', (p) => popups.push(p));
  await page.getByRole('button', { name: /Buscar en Wikiloc/ }).click();
  await expect(page.getByText('Elige primero tu inicio.')).toBeVisible();
  expect(popups).toHaveLength(0);
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: `${DIR}/sin-gps-360.png`, fullPage: true });
});

test('accesibilidad mínima de la pantalla: un h1, controles con nombre, foco visible en Wikiloc', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await setup(page);
  await propose(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  const unnamed = await page.locator('main button, main a, main input, main summary').evaluateAll((els) =>
    els.filter((el) => {
      const name = (el.getAttribute('aria-label') ?? '') + (el.textContent ?? '') + (el.getAttribute('title') ?? '');
      const labelled = el.id && document.querySelector(`label[for="${el.id}"]`);
      return !name.trim() && !labelled && !el.getAttribute('aria-labelledby');
    }).map((el) => el.outerHTML.slice(0, 120)),
  );
  expect(unnamed).toEqual([]);
  // Saltos de encabezado: dentro de «Propuestas» (h2) las tarjetas son h3.
  const levels = await page.locator('main h1, main h2, main h3, main h4').evaluateAll((hs) => hs.map((h) => Number(h.tagName[1])));
  for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  // El resumen de Wikiloc se alcanza con el teclado y enseña el foco.
  const summary = page.locator('.nb-wikiloc > summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Buscar en Wikiloc/ })).toBeVisible();
  const outline = await summary.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
});
