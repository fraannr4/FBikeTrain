import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from './accountFixture';
import { HOME, NOW, RIDES, seed, settings } from './seed';

// Todo es sintético: ORS, Ride with GPS, OSM (`route-sources`) y la IA común (`ai-routes`) están simulados;
// el navegador nunca sale a internet. Las geometrías son rombos y círculos alrededor del fixture de Casa.
test.setTimeout(120_000);

type LatLng = { lat: number; lng: number };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((HOME.lat * Math.PI) / 180);
const D_KM = 60;
const DIR = 'test-results/rutas-cerca';
const SIZES = [{ width: 360, height: 740 }, { width: 430, height: 932 }];

const toXY = (p: LatLng) => ({ x: (p.lng - HOME.lng) * M_LNG, y: (p.lat - HOME.lat) * M_LAT });
const fromXY = (x: number, y: number): LatLng => ({ lat: HOME.lat + y / M_LAT, lng: HOME.lng + x / M_LNG });
/** Punto a `km` de Casa con rumbo `deg` (0 norte, 90 este). */
const at = (deg: number, km: number) => fromXY(Math.sin((deg * Math.PI) / 180) * km * 1000, Math.cos((deg * Math.PI) / 180) * km * 1000);

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

/** Dos rutas reales de Ride with GPS: hacia el norte y hacia el sur. */
const REAL = [{ id: '701', deg: 0, km: 59.5 }, { id: '702', deg: 184, km: 60.5 }];
const REAL_NAME = (id: string) => `Ruta sintética de Ride with GPS ${id}`;
/** Ocho puertos a 23 km, separados 46°: cada vuelta por uno mide unos 60 km. */
const RING = [0, 46, 92, 138, 184, 230, 276, 322];
const WAYPOINTS = RING.map((deg, i) => ({
  id: `osm-pass-${i + 1}`, kind: 'puerto', name: `Coll sintètic ${i + 1} amb un nom molt llarg per al mòbil`, ...at(deg, 23), ele: 900, distanceM: 23_000, interes: 2,
}));

type Mocks = { aiBodies: string[]; orsCalls: () => number };

async function setup(page: Page, opts: { orsLimited?: boolean } = {}): Promise<Mocks> {
  const context = page.context();
  const aiBodies: string[] = [];
  let ors = 0;
  await context.clock.setFixedTime(NOW);
  await context.route('https://*.supabase.co/**', (r) => r.abort());
  await context.route('https://*.wikiloc.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Wikiloc sintético</p>' }));

  // ORS con la clave de Ajustes (y por el servicio común, por si la build lo activa): una vuelta por los puntos pedidos.
  const answerOrs = (coordinates: [number, number][] | undefined, roundTrip: boolean) => {
    ors++;
    if (opts.orsLimited) return { status: 429, body: { error: 'Rate limit exceeded' } };
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

  // Colección común de Ride with GPS.
  await page.route('https://*.supabase.co/functions/v1/rwgps', (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const ask = JSON.parse(req.postData() ?? '{}');
    const json = (body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
    if (ask.op === 'nearby') {
      const routes = REAL.map((f) => ({
        id: f.id, name: REAL_NAME(f.id), author: 'Autora sintética', distanceM: f.km * 1000, elevGainM: 600, start: HOME,
        line: circuit(f.km, f.deg, 200).map((p) => [p.lng, p.lat]), passM: 40,
      }));
      return json({ data: { routes, total: routes.length } });
    }
    const f = REAL.find((x) => x.id === ask.id);
    if (ask.kind !== 'route' || !f) return json({ error: { code: 'not_found', message: 'x' } }, 404);
    const track_points = circuit(f.km, f.deg, 720).map((p, i) => ({ x: p.lng, y: p.lat, e: 650 + 20 * Math.sin(i / 10) }));
    return json({ data: { route: { name: REAL_NAME(f.id), user: { name: 'Autora sintética' }, track_points } } });
  });

  // Puntos de paso de OSM.
  await page.route('https://*.supabase.co/functions/v1/route-sources', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const ask = JSON.parse(r.request().postData() ?? '{}');
    const data = ask.kind === 'waypoints' ? WAYPOINTS : [];
    return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ data }) });
  });

  // IA común: combina un punto hacia el este y otro hacia el suroeste.
  await page.route('https://*.supabase.co/functions/v1/ai-routes', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const raw = r.request().postData() ?? '{}';
    aiBodies.push(raw);
    const ask = JSON.parse(raw);
    if (ask.operation !== 'waypoints') return r.fulfill({ status: 400, contentType: 'application/json', headers: CORS, body: '{}' });
    const puntos = ask.puntos as { id: string; direccion: string }[];
    const combinaciones = ['este', 'suroeste'].flatMap((direccion) => {
      const p = puntos.find((x) => x.direccion === direccion);
      return p ? [{ puntos: [p.id], direccion, titulo: `Vuelta por el ${direccion}` }] : [];
    });
    return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ data: { combinaciones } }) });
  });

  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
  return { aiBodies, orsCalls: () => ors };
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

for (const size of SIZES) {
  test.describe(`Rutas cerca a ${size.width} px`, () => {
    test.beforeEach(async ({ page }) => {
      mkdirSync(DIR, { recursive: true });
      await page.setViewportSize(size);
    });

    test('los enlaces antiguos llevan a Rutas cerca', async ({ page }) => {
      await setup(page);
      await page.goto('#/rutas/catalogo');
      await expect(page.getByRole('heading', { level: 1, name: 'Rutas cerca' })).toBeVisible();
      await expect(page).toHaveURL(/#\/rutas\/cerca$/);
      await page.goto('#/rutas/wikiloc/recibir');
      await expect(page).toHaveURL(/#\/rutas\/cerca$/);
      await page.goto('#/rutas');
      await page.getByRole('link', { name: /Rutas cerca/ }).click();
      await expect(page).toHaveURL(/#\/rutas\/cerca$/);
    });

    test('propone al menos 5 vueltas: las reales primero y después las del motor', async ({ page }) => {
      const { aiBodies } = await setup(page);
      await page.goto('#/rutas/cerca');
      await expect(page.getByRole('heading', { level: 1, name: 'Rutas cerca' })).toBeVisible();
      await expect(page.getByLabel('Distancia')).toBeVisible();
      await visibleWithoutScroll(page, 'Proponer rutas');
      expect(await noOverflow(page)).toBe(true);
      // Nada se busca hasta que se pide.
      expect(aiBodies).toEqual([]);
      await page.screenshot({ path: `${DIR}/formulario-${size.width}.png`, fullPage: true });

      await page.getByLabel('Distancia').fill('60');
      await page.getByRole('button', { name: 'Proponer rutas' }).click();
      await expect(page.getByRole('button', { name: 'Cancelar' })).toHaveCount(0, { timeout: 90_000 });
      const cards = page.getByRole('article');
      expect(await cards.count()).toBeGreaterThanOrEqual(5);
      await expect(cards.nth(0)).toContainText('Ride with GPS · Autora sintética');
      await expect(cards.nth(1)).toContainText('Ride with GPS · Autora sintética');
      for (let i = 2; i < (await cards.count()); i++) await expect(cards.nth(i)).toContainText('Motor FBikeTrain');
      await expect(page.getByText('Combinada por la IA').first()).toBeVisible();

      // La IA solo ve nombres y cifras: ni coordenadas ni Casa.
      const waypointBodies = aiBodies.filter((b) => JSON.parse(b).operation === 'waypoints');
      expect(waypointBodies).toHaveLength(1);
      for (const body of waypointBodies) {
        expect(body).not.toMatch(/"(lat|lng|lon|latitude|longitude|coordinates|approach|departure)"/i);
        expect(body).not.toContain(String(HOME.lat));
        expect(body).not.toContain(String(HOME.lng));
        expect(body).not.toMatch(/casa/i);
      }

      // Una columna, sin scroll lateral, y botones de al menos 44 px.
      expect(await noOverflow(page)).toBe(true);
      const heights = await page.locator('article button, article a.btn').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      expect(heights.length).toBeGreaterThan(0);
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
      // El nombre largo de los puntos de paso cabe en una línea con elipsis.
      const via = cards.nth(2).getByRole('heading', { level: 3 });
      expect(await via.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis');
      await page.screenshot({ path: `${DIR}/propuestas-${size.width}.png`, fullPage: true });

      // El mapa enseña el nombre completo.
      const motorCard = cards.nth(2);
      const fullName = await via.getAttribute('title');
      await motorCard.getByRole('button', { name: /Mapa/ }).click();
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByRole('heading', { name: fullName! })).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${DIR}/mapa-${size.width}.png` });
      await sheet.getByRole('button', { name: 'Cerrar el mapa' }).click();

      await motorCard.getByRole('button', { name: 'Guardar en la biblioteca' }).click();
      await expect(motorCard.getByRole('button', { name: 'Guardada en la biblioteca' })).toBeDisabled();
    });

    test('con el límite por minuto de ORS espera y «Cancelar» conserva las tarjetas aceptadas', async ({ page }) => {
      const mocks = await setup(page, { orsLimited: true });
      await page.goto('#/rutas/cerca');
      await page.getByLabel('Distancia').fill('60');
      await page.getByRole('button', { name: 'Proponer rutas' }).click();
      await expect(page.getByText(/Esperando \d+ s por el límite de consultas/)).toBeVisible({ timeout: 60_000 });
      const cards = page.getByRole('article');
      await expect(cards).toHaveCount(2);
      expect(mocks.orsCalls()).toBe(1);
      await page.screenshot({ path: `${DIR}/esperando-${size.width}.png`, fullPage: true });

      await page.getByRole('button', { name: 'Cancelar' }).click();
      await expect(page.getByText(/Esperando/)).toHaveCount(0);
      await expect(cards).toHaveCount(2);
      await expect(page.getByRole('button', { name: 'Proponer rutas' })).toBeEnabled();
      expect(mocks.orsCalls()).toBe(1);
      expect(await noOverflow(page)).toBe(true);
    });

    test('Wikiloc va plegado debajo: abre la búsqueda y adapta el GPX descargado', async ({ page }) => {
      await setup(page);
      await page.goto('#/rutas/cerca');
      await page.getByLabel('Distancia').fill('60');
      await expect(page.getByRole('button', { name: /Buscar en Wikiloc/ })).toBeHidden();
      await page.getByText('¿Buscas en Wikiloc?').click();
      const popup = page.waitForEvent('popup');
      await page.getByRole('button', { name: /Buscar en Wikiloc/ }).click();
      const tab = await popup;
      await tab.waitForURL(/wikiloc\.com\/wikiloc\/map\.do\?.*act=29/);
      await tab.close();

      const gpx = `<gpx version="1.1"><metadata><link href="https://es.wikiloc.com/rutas-ciclismo/sintetica-1"/></metadata><trk><name>Vuelta sintética de Wikiloc</name><trkseg>${circuit(60, 90, 360)
        .map((p, i) => `<trkpt lat="${p.lat}" lon="${p.lng}"><ele>${650 + 20 * Math.sin(i / 10)}</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
      await page.getByLabel('Subir el GPX descargado').setInputFiles({ name: 'vuelta.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx) });
      const card = page.getByRole('article');
      await expect(card).toHaveCount(1, { timeout: 30_000 });
      await expect(card.getByRole('link', { name: /Ver en Wikiloc/ })).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
      await page.screenshot({ path: `${DIR}/wikiloc-${size.width}.png`, fullPage: true });
    });
  });
}
