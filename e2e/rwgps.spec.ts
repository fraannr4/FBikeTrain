import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from './accountFixture';
import { HOME, NOW, RIDES, seed, settings } from './seed';

// Todo es sintético: la función `rwgps` está simulada; el navegador nunca llama a ridewithgps.com.
test.setTimeout(120_000);

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((HOME.lat * Math.PI) / 180);

/** Circuito de `km` que sale y vuelve a Casa, con su punto más lejano hacia `deg` (0 norte, 90 este). */
function circuit(km: number, deg: number, n: number) {
  const r = (km * 1000) / (2 * Math.PI);
  const a = (deg * Math.PI) / 180;
  const cx = Math.sin(a) * r;
  const cy = Math.cos(a) * r;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = Math.atan2(-cy, -cx) + (i / n) * 2 * Math.PI;
    return { lat: HOME.lat + (cy + r * Math.sin(t)) / M_LAT, lng: HOME.lng + (cx + r * Math.cos(t)) / M_LNG };
  });
}

/** Índice sintético: 8 circuitos de unos 60 km, uno por dirección. */
const INDEX = [0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => ({ id: String(500 + i), km: 58 + i * 0.5, deg }));
const NAME = (id: string) => `Ruta sintética de Ride with GPS con un nombre bastante largo ${id}`;

const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function setup(page: Page) {
  const context = page.context();
  const bodies: { op?: string; kind?: string; id?: string; radiusKm?: number; lat?: number; lng?: number; distanceKm?: number }[] = [];
  const direct: string[] = [];
  await context.clock.setFixedTime(NOW);
  await context.route('https://*.supabase.co/**', (r) => r.abort());
  await context.route('https://api.heigit.org/**', (r) => r.abort());
  await context.route('https://ridewithgps.com/**', (r) => { direct.push(r.request().url()); return r.abort(); });
  // Función `rwgps` compartida, simulada. En la página y después del bloqueo de supabase.co, así que gana.
  await page.route('https://*.supabase.co/functions/v1/rwgps', (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const ask = JSON.parse(req.postData() ?? '{}');
    bodies.push(ask);
    const json = (body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
    if (ask.op === 'nearby') {
      const routes = INDEX.map((f) => ({
        id: f.id, name: NAME(f.id), author: 'Autora sintética', distanceM: f.km * 1000, elevGainM: 600, start: HOME,
        line: circuit(f.km, f.deg, 200).map((p) => [p.lng, p.lat]), passM: 40,
      }));
      return json({ data: { routes, total: routes.length } });
    }
    const f = INDEX.find((x) => x.id === ask.id);
    if (ask.kind !== 'route' || !f) return json({ error: { code: 'not_found', message: 'x' } }, 404);
    const track_points = circuit(f.km, f.deg, 720).map((p, i) => ({ x: p.lng, y: p.lat, e: 650 + 20 * Math.sin(i / 10) }));
    return json({ data: { route: { name: NAME(f.id), user: { name: 'Autora sintética' }, track_points } } });
  });
  await seed(page, { activities: RIDES, settings: settings({ orsKey: 'test-key' }) });
  return { bodies, direct };
}

for (const width of [360, 430]) {
  test(`Ride with GPS por zona: al menos 5 propuestas en direcciones distintas (${width} px)`, async ({ page }) => {
    const dir = 'test-results/rwgps-zona';
    mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width, height: 860 });
    const { bodies, direct } = await setup(page);
    await page.goto('#/rutas/catalogo');

    await expect(page.getByRole('heading', { level: 1, name: 'Rutas de Ride with GPS' })).toBeVisible();
    await expect(page.getByLabel('Distancia')).toBeVisible();
    // Lo retirado: precarga de OpenStreetMap, importación por lotes y pegado de enlaces.
    await expect(page.getByRole('button', { name: /OpenStreetMap/ })).toHaveCount(0);
    await expect(page.getByLabel('Importar GPX, TCX o ZIP')).toHaveCount(0);
    await expect(page.getByLabel('Enlaces de rutas o colecciones')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Buscar en Wikiloc/ })).toBeVisible();
    // Solo se busca cuando se pide.
    expect(bodies).toEqual([]);
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: `${dir}/formulario-${width}.png`, fullPage: true });

    await page.getByLabel('Distancia').fill('60');
    await page.getByRole('button', { name: 'Proponer rutas' }).click();
    const cards = page.getByRole('article');
    await expect(cards).toHaveCount(6, { timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Parar' })).toHaveCount(0);

    expect(bodies[0]).toEqual({ op: 'nearby', lat: Number(HOME.lat.toFixed(2)), lng: Number(HOME.lng.toFixed(2)), radiusKm: 5, distanceKm: 60 });
    expect(bodies.filter((b) => b.op === 'nearby')).toHaveLength(3);
    // Solo se descargan los tracks de las que se adaptan, y nunca dos veces la misma.
    const tracks = bodies.filter((b) => b.kind === 'route').map((b) => b.id);
    expect(new Set(tracks).size).toBe(tracks.length);
    expect(tracks.length).toBe(6);
    expect(direct).toEqual([]);

    await expect(cards.first()).toContainText('Autora sintética en Ride with GPS');
    await expect(cards.first().getByRole('link', { name: /Ver en Ride with GPS/ })).toHaveAttribute('href', /^https:\/\/ridewithgps\.com\/routes\/5\d\d$/);
    await expect(cards.first().getByRole('button', { name: 'Enviar al iGPSPORT' })).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: `${dir}/propuestas-${width}.png`, fullPage: true });

    await cards.first().getByRole('button', { name: 'Guardar en la biblioteca' }).click();
    await expect(cards.first().getByRole('button', { name: 'Guardada en la biblioteca' })).toBeDisabled();
  });
}
