import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from './accountFixture';
import { HOME, NOW, RIDES, seed, settings } from './seed';

// Todo es sintético: ORS (clave propia y servicio común) y la biblioteca común (`route-sources`) están
// simulados; el navegador nunca sale a internet. Las geometrías son círculos y vueltas alrededor del fixture de Casa.
test.setTimeout(120_000);

type LatLng = { lat: number; lng: number };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((HOME.lat * Math.PI) / 180);
const D_KM = 60;
const DIR = 'test-results/rutas';
const SIZES = [{ width: 360, height: 740 }, { width: 430, height: 932 }];

const toXY = (p: LatLng) => ({ x: (p.lng - HOME.lng) * M_LNG, y: (p.lat - HOME.lat) * M_LAT });
const fromXY = (x: number, y: number): LatLng => ({ lat: HOME.lat + y / M_LAT, lng: HOME.lng + x / M_LNG });
const gapM = (a: LatLng, b: LatLng) => {
  const p = toXY(a);
  const q = toXY(b);
  return Math.hypot(p.x - q.x, p.y - q.y);
};

/** Puntos cada 400 m como mucho. */
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

/** Vuelta de `km` por los puntos pedidos, sin repetir carretera: cada tramo se desvía a su derecha. */
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

/** Circuito de `km` que sale y vuelve a Casa, con su punto más lejano hacia `deg`. */
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

/** Dos rutas de la biblioteca común: hacia el norte y hacia el sur. */
const LIBRARY = [{ id: 'ref-701', deg: 0, km: 59.5 }, { id: 'ref-702', deg: 184, km: 60.5 }].map((r) => ({ ...r, line: circuit(r.km, r.deg, 400) }));
const LIBRARY_NAME = (id: string) => `Ruta sintética de la biblioteca ${id} con un nombre muy largo para el móvil`;

/** Tramo de una ruta de la biblioteca entre dos puntos suyos, en el sentido de la ruta; `null` si no están en ella. */
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

/** Carretera de ORS por los puntos pedidos: por la ruta de la biblioteca si todos están en ella; si no, una vuelta de 60 km. */
function road(waypoints: LatLng[]): LatLng[] {
  for (const { line } of LIBRARY) {
    const legs = waypoints.slice(1).map((b, i) => along(line, waypoints[i], b));
    if (legs.every((l) => l !== null)) return legs.flatMap((l, i) => (i === 0 ? l! : l!.slice(1)));
  }
  return loopThrough(waypoints, D_KM);
}

/** Respuesta de ORS: asfalto, carretera secundaria, sin autopista y un perfil que sube y baja. */
function orsFeature(points: LatLng[]) {
  const n = points.length - 1;
  const coordinates = points.map((p, i) => [p.lng, p.lat, 650 + 300 * (1 - Math.abs((2 * i) / n - 1))]);
  const all = (value: number) => ({ values: [[0, n, value]], summary: [{ value, distance: D_KM * 1000, amount: 100 }] });
  return {
    type: 'Feature', geometry: { type: 'LineString', coordinates },
    properties: { summary: { distance: D_KM * 1000, duration: 9000 }, extras: { surface: all(3), waytypes: all(2), steepness: all(0), waycategory: all(0) } },
  };
}

/** Mapa de calor: una celda por km en 30 × 30 km alrededor de Casa, todas con 3 rutas. */
const CELLS = Array.from({ length: 31 * 31 }, (_, i) => {
  const p = fromXY((Math.floor(i / 31) - 15) * 1000, ((i % 31) - 15) * 1000);
  return [Number(p.lat.toFixed(5)), Number(p.lng.toFixed(5)), 3, null];
});

function zone(empty: boolean) {
  return {
    routeCount: empty ? 0 : 20,
    cells: empty ? [] : CELLS,
    routes: empty ? [] : LIBRARY.map((r) => ({
      id: r.id, source: 'rwgps', url: `https://ridewithgps.com/routes/${r.id.slice(4)}`, name: LIBRARY_NAME(r.id), author: 'Autora sintética',
      distanceM: r.km * 1000, elevGainM: 600, loop: true, passM: 0, line: r.line.map((p, i) => [p.lng, p.lat, 650 + 20 * Math.sin(i / 10)]),
    })),
    zoneFactor: 1.75, factorSamples: empty ? 0 : 10, climbMPerKm: null, fill: empty ? 'nothing-found' : 'none',
  };
}

type Mocks = { libraryBodies: string[]; orsCalls: () => number; weatherUrls: string[] };

/** Previsión sintética de Open-Meteo (7 días, hora de Madrid): 14 grados, 20 % de lluvia y 18 km/h del noroeste. */
function weatherBody() {
  const time: string[] = [];
  for (let d = 0; d < 7; d++) {
    const day = new Date(NOW.getTime() + d * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    for (let h = 0; h < 24; h++) time.push(`${day}T${String(h).padStart(2, '0')}:00`);
  }
  const fill = (v: number) => time.map(() => v);
  return {
    latitude: HOME.lat, longitude: HOME.lng, timezone: 'Europe/Madrid',
    hourly: { time, temperature_2m: fill(14.2), precipitation_probability: fill(20), wind_speed_10m: fill(18), wind_direction_10m: fill(315), wind_gusts_10m: fill(33) },
  };
}

/** `slowAfter`: a partir de esa consulta, ORS no contesta en 20 s. `weather: 'fail'`: Open-Meteo no responde. */
async function setup(page: Page, opts: { emptyLibrary?: boolean; slowAfter?: number; weather?: 'ok' | 'fail' } = {}): Promise<Mocks> {
  const context = page.context();
  const libraryBodies: string[] = [];
  const weatherUrls: string[] = [];
  let ors = 0;
  await context.clock.setFixedTime(NOW);
  await context.route('https://*.supabase.co/**', (r) => r.abort());
  await context.route('https://*.wikiloc.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Wikiloc sintético</p>' }));

  const answerOrs = async (coordinates: [number, number][] | undefined) => {
    ors++;
    if (opts.slowAfter !== undefined && ors > opts.slowAfter) await new Promise((resolve) => setTimeout(resolve, 20_000));
    if (!coordinates || coordinates.length < 2) return { status: 404, body: { error: { code: 2009, message: 'sin ruta' } } };
    return { status: 200, body: { type: 'FeatureCollection', features: [orsFeature(road(coordinates.map(([lng, lat]) => ({ lat, lng }))))] } };
  };
  const fulfill = async (r: Parameters<Parameters<Page['route']>[1]>[0], status: number, body: unknown) => {
    try {
      await r.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
    } catch {
      // La búsqueda se ha cancelado o la página se ha cerrado mientras ORS «tardaba».
    }
  };
  await page.route('https://api.heigit.org/openrouteservice/**', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const ask = JSON.parse(r.request().postData() ?? '{}');
    const { status, body } = await answerOrs(ask.options?.round_trip ? undefined : ask.coordinates);
    await fulfill(r, status, body);
  });
  await page.route('https://*.supabase.co/functions/v1/ors-proxy', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const ask = JSON.parse(r.request().postData() ?? '{}');
    const coords = ask.operation === 'path' ? (ask.waypoints as LatLng[]).map((p) => [p.lng, p.lat] as [number, number]) : undefined;
    const { status, body } = await answerOrs(coords);
    await fulfill(r, status, status === 200 ? { data: { features: (body as { features: unknown[] }).features } } : { retryAfterS: 60 });
  });

  // Biblioteca común de la zona.
  await page.route('https://*.supabase.co/functions/v1/route-sources', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const raw = r.request().postData() ?? '{}';
    const ask = JSON.parse(raw);
    if (ask.kind === 'library') libraryBodies.push(raw);
    const data = ask.kind === 'library' ? zone(!!opts.emptyLibrary) : [];
    return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ data }) });
  });

  // Previsión: el navegador nunca sale a internet.
  await page.route('https://api.open-meteo.com/**', (r) => {
    weatherUrls.push(r.request().url());
    if (opts.weather === 'fail') return r.abort('internetdisconnected');
    return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(weatherBody()) });
  });

  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
  return { libraryBodies, orsCalls: () => ors, weatherUrls };
}

const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

/** El botón se ve entero sin desplazar y nada lo tapa (ni la barra de pestañas). */
async function visibleWithoutScroll(page: Page, name: string) {
  const button = page.getByRole('button', { name });
  await expect(button).toBeInViewport({ ratio: 1 });
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest('button')?.textContent?.trim() ?? null;
  }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
  expect(hit).toBe(name);
}

async function propose(page: Page) {
  await page.getByLabel('Distancia').fill('60');
  await page.getByRole('button', { name: 'Proponer rutas' }).click();
}

// Capturas de revisión del tiempo y el viento a 390 px, en claro y en oscuro.
for (const theme of ['light', 'dark'] as const) {
  test(`tiempo y viento a 390 px (${theme})`, async ({ page }) => {
    const shots = 'docs/design/2026-11-17-viento-rutas';
    mkdirSync(shots, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
    await setup(page);
    await page.goto('#/rutas');
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await propose(page);
    await expect(page.getByRole('button', { name: 'Cancelar' })).toHaveCount(0, { timeout: 90_000 });
    await expect(page.getByRole('group', { name: 'Tiempo para la salida' })).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    await page.getByRole('heading', { name: 'Propuestas' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `${shots}/rutas-viento-390-${theme}.png`, fullPage: false });
    await page.getByRole('article').nth(2).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shots}/tarjeta-viento-390-${theme}.png`, fullPage: false });
  });
}

for (const size of SIZES) {
  test.describe(`Rutas a ${size.width} px`, () => {
    test.beforeEach(async ({ page }) => {
      mkdirSync(DIR, { recursive: true });
      await page.setViewportSize(size);
    });

    test('los enlaces antiguos llevan a Rutas', async ({ page }) => {
      await setup(page);
      for (const old of ['#/rutas/ia', '#/rutas/cerca', '#/rutas/empalmar', '#/rutas/catalogo']) {
        await page.goto(old);
        await expect(page.getByRole('heading', { level: 1, name: 'Rutas' })).toBeVisible();
        await expect(page).toHaveURL(/#\/rutas$/);
      }
    });

    test('propone de 3 a 5 vueltas: primero las de la biblioteca y después las nuevas', async ({ page }) => {
      const mocks = await setup(page);
      await page.goto('#/rutas');
      await expect(page.getByLabel('Distancia')).toBeVisible();
      await visibleWithoutScroll(page, 'Proponer rutas');
      expect(await noOverflow(page)).toBe(true);
      // Nada se pide hasta pulsar «Proponer rutas».
      expect(mocks.libraryBodies).toEqual([]);
      expect(mocks.orsCalls()).toBe(0);
      await page.screenshot({ path: `${DIR}/formulario-${size.width}.png`, fullPage: true });

      await propose(page);
      await expect(page.getByRole('button', { name: 'Cancelar' })).toHaveCount(0, { timeout: 90_000 });
      const cards = page.getByRole('article');
      const count = await cards.count();
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(5);
      await expect(cards.nth(0)).toContainText('De la biblioteca');
      await expect(cards.nth(1)).toContainText('De la biblioteca');
      for (let i = 2; i < count; i++) await expect(cards.nth(i).getByText('Nueva', { exact: true })).toBeVisible();

      // A la biblioteca viaja un punto de 3 decimales, nunca «Casa».
      expect(mocks.libraryBodies).toHaveLength(1);
      const body = JSON.parse(mocks.libraryBodies[0]);
      expect(mocks.libraryBodies[0]).not.toMatch(/casa/i);
      for (const v of [body.lat, body.lon]) expect(String(v).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);

      // Una columna, sin scroll lateral, y botones de al menos 44 px.
      expect(await noOverflow(page)).toBe(true);
      const heights = await page.locator('article button, article a.btn').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      expect(heights.length).toBeGreaterThan(0);
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
      // El nombre largo cabe en una línea con elipsis y sale completo en el mapa.
      const name = cards.nth(2).getByRole('heading', { level: 3 });
      expect(await name.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis');
      await expect(cards.nth(2).getByLabel(`Mapa de ${await name.getAttribute('title')}`)).toBeVisible();
      await page.screenshot({ path: `${DIR}/propuestas-${size.width}.png`, fullPage: true });
    });

    test('enseña el tiempo de la hora elegida y cómo pega el viento en cada vuelta', async ({ page }) => {
      const mocks = await setup(page);
      await page.goto('#/rutas');
      // Antes de proponer no se pide nada al servicio del tiempo.
      expect(mocks.weatherUrls).toEqual([]);
      await propose(page);
      await expect(page.getByRole('button', { name: 'Cancelar' })).toHaveCount(0, { timeout: 90_000 });

      const row = page.getByRole('group', { name: 'Tiempo para la salida' });
      await expect(row).toBeVisible();
      await expect(row).toContainText('14 °C');
      await expect(row).toContainText('Lluvia 20 %');
      await expect(row).toContainText('Viento 18 km/h del NO, rachas de 33');
      // Hoy a la hora siguiente (NOW es las 12:00 de Madrid).
      await expect(row.getByLabel('Hora')).toHaveValue('13');
      await expect(row.getByLabel('Día').locator('option')).toHaveCount(7);

      const cards = page.getByRole('article');
      const count = await cards.count();
      expect(count).toBeGreaterThanOrEqual(3);
      for (let i = 0; i < count; i++) {
        const summary = cards.nth(i).locator('.wx-summary');
        await expect(summary).toBeVisible();
        await expect(summary).toContainText('18 km/h del NO');
        await expect(cards.nth(i).locator('.wx-share')).toContainText(/% de cara · .* % a favor · .* % de lado/);
      }
      // Sin scroll lateral y el texto del viento cabe en su tarjeta.
      expect(await noOverflow(page)).toBe(true);
      const fits = await page.locator('.wx-row, .wx-wind').evaluateAll((els) => els.every((el) => el.scrollWidth <= el.clientWidth + 1));
      expect(fits).toBe(true);

      // A Open-Meteo solo viaja el inicio redondeado a 2 decimales, y una sola vez.
      expect(mocks.weatherUrls).toHaveLength(1);
      const q = new URL(mocks.weatherUrls[0]).searchParams;
      for (const k of ['latitude', 'longitude']) expect(q.get(k)!.split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
      expect(q.get('latitude')).toBe((Math.round(HOME.lat * 100) / 100).toString());

      // Cambiar la hora no vuelve a pedir y mantiene la línea de viento.
      await row.getByLabel('Hora').selectOption('18');
      await expect(cards.first().locator('.wx-summary')).toContainText('18 km/h del NO');
      expect(mocks.weatherUrls).toHaveLength(1);
      await page.screenshot({ path: `${DIR}/viento-${size.width}.png`, fullPage: true });
    });

    test('si el tiempo no responde, las tarjetas salen igual con una línea discreta', async ({ page }) => {
      const mocks = await setup(page, { weather: 'fail' });
      await page.goto('#/rutas');
      await propose(page);
      await expect(page.getByRole('button', { name: 'Cancelar' })).toHaveCount(0, { timeout: 90_000 });
      const cards = page.getByRole('article');
      expect(await cards.count()).toBeGreaterThanOrEqual(3);
      await expect(page.getByText('Sin previsión ahora')).toBeVisible();
      await expect(page.getByRole('group', { name: 'Tiempo para la salida' })).toHaveCount(0);
      await expect(page.locator('.wx-wind')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Exportar GPX' }).first()).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
      expect(mocks.weatherUrls.length).toBeGreaterThanOrEqual(1);
    });

    test('una biblioteca vacía no enseña tarjetas y dice por qué', async ({ page }) => {
      const mocks = await setup(page, { emptyLibrary: true });
      await page.goto('#/rutas');
      await propose(page);
      const notice = page.getByRole('region', { name: 'Avisos de la búsqueda' });
      await expect(notice).toContainText('No hay rutas de referencia en esta zona todavía', { timeout: 30_000 });
      await expect(page.getByRole('article')).toHaveCount(0);
      expect(mocks.orsCalls()).toBe(0);
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${DIR}/sin-resultados-${size.width}.png`, fullPage: true });
    });

    test('con ORS lento, «Cancelar» conserva las tarjetas aceptadas y para las consultas', async ({ page }) => {
      // Las dos rutas de la biblioteca gastan una consulta cada una (su re-trazado); la tercera no contesta.
      const mocks = await setup(page, { slowAfter: 2 });
      await page.goto('#/rutas');
      await propose(page);
      const cards = page.getByRole('article');
      await expect(cards).toHaveCount(2, { timeout: 30_000 });
      const status = page.getByRole('status', { name: 'Progreso de la búsqueda' });
      await expect(status).toContainText(/Probando 3 de 20/);
      await page.screenshot({ path: `${DIR}/buscando-${size.width}.png`, fullPage: true });

      await page.getByRole('button', { name: 'Cancelar' }).click();
      await expect(status).toHaveCount(0);
      await expect(cards).toHaveCount(2);
      await expect(page.getByRole('button', { name: 'Proponer rutas' })).toBeEnabled();
      const calls = mocks.orsCalls();
      await page.waitForTimeout(1_500);
      expect(mocks.orsCalls()).toBe(calls);
      expect(await noOverflow(page)).toBe(true);
    });

    test('Explore y Wikiloc van plegados debajo y abren su pestaña', async ({ page }) => {
      await setup(page);
      await page.goto('#/rutas');
      await page.getByLabel('Distancia').fill('60');
      await page.evaluate(() => {
        const opened: string[] = [];
        (window as unknown as { opened: string[] }).opened = opened;
        window.open = (url?: string | URL) => {
          opened.push(String(url));
          return null;
        };
      });
      const opened = () => page.evaluate(() => (window as unknown as { opened: string[] }).opened);

      await expect(page.getByRole('button', { name: /Abrir Explore con tus filtros/ })).toBeHidden();
      await page.getByText('¿Buscas en Ride with GPS Explore?').click();
      await page.getByRole('button', { name: /Abrir Explore con tus filtros/ }).click();
      await expect.poll(opened).toHaveLength(1);
      expect((await opened())[0]).toMatch(/^https:\/\/ridewithgps\.com\/explore\?/);

      await expect(page.getByRole('button', { name: /Buscar en Wikiloc/ })).toBeHidden();
      await page.getByText('¿Buscas en Wikiloc?').click();
      await page.getByRole('button', { name: /Buscar en Wikiloc/ }).click();
      await expect.poll(opened).toHaveLength(2);
      expect((await opened())[1]).toMatch(/wikiloc\.com\/wikiloc\/map\.do\?.*act=29/);
      expect(await noOverflow(page)).toBe(true);
    });
  });
}
