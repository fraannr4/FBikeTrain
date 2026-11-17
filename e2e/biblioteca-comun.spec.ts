import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from './accountFixture';
import { HOME, seed, settings } from './seed';

// Todo es sintético: la función `route-sources` se intercepta y las rutas son curvas inventadas
// alrededor de la Puerta del Sol; ninguna ruta, autor ni enlace es real.
const SHOTS = 'docs/design/2026-11-17-biblioteca-comun';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const SOURCES = ['rwgps', 'komoot', 'bikemap', 'wikiloc'] as const;
const SOURCE_URL: Record<(typeof SOURCES)[number], string> = {
  rwgps: 'https://ridewithgps.com/routes/', komoot: 'https://www.komoot.com/tour/', bikemap: 'https://www.bikemap.net/en/r/', wikiloc: 'https://es.wikiloc.com/rutas-ciclismo/ruta-',
};
const NAMES = ['Vuelta al pantano', 'Puerto de la Morcuera', 'Circular por la sierra', 'Subida a la cima', 'Llano del río', 'Ruta de los embalses', 'Anillo norte', 'Cresta y valle'];
const LONG_NAME = `Ruta sintética con un nombre larguísimo que nadie querría leer entero ${'y sigue '.repeat(20)}`.slice(0, 300);
const LONG_AUTHOR = `Autora${'sintética'.repeat(18)}`.slice(0, 190);

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Curva cerrada (o abierta) con forma distinta por ruta: `lat/lng` alrededor de un centro. */
function shape(n: number, points: number, loop: boolean): { lat: number; lng: number }[] {
  const cx = HOME.lat + ((n % 7) - 3) * 0.03;
  const cy = HOME.lng + ((n % 5) - 2) * 0.04;
  const r = 0.03 + (n % 6) * 0.012;
  return Array.from({ length: points }, (_, i) => {
    const t = (i / (points - 1)) * (loop ? 2 * Math.PI : Math.PI * (1 + (n % 3) * 0.4));
    const wobble = 1 + 0.35 * Math.sin(t * (2 + (n % 4)));
    return { lat: cx + r * wobble * Math.sin(t), lng: cy + (r * 1.3 * wobble * Math.cos(t)) };
  });
}

type Spec = { id: string; n: number; name: string; author: string; source: (typeof SOURCES)[number]; km: number; gain: number | null; loop: boolean };
const SPECS: Spec[] = Array.from({ length: 24 }, (_, i) => {
  const n = i + 1;
  return {
    id: uuid(n), n, name: n === 3 ? LONG_NAME : `${NAMES[i % NAMES.length]} ${n}`, author: n === 3 ? LONG_AUTHOR : `Autora ${n}`, source: SOURCES[i % SOURCES.length],
    km: 22 + ((n * 17) % 110), gain: n % 6 === 0 ? null : 150 + ((n * 211) % 1900), loop: n % 3 !== 0,
  };
});

const catalogItem = (s: Spec) => {
  const line = shape(s.n, 48, s.loop);
  return {
    id: s.id, source: s.source, url: `${SOURCE_URL[s.source]}${s.n}`, name: s.name, author: s.author, distanceM: s.km * 1000, elevGainM: s.gain, loop: s.loop,
    unpavedPct: s.n % 5 === 0 ? 12 : null, startLat: round(line[0].lat, 3), startLng: round(line[0].lng, 3), thumb: line.map(p => [round(p.lat, 4), round(p.lng, 4)]),
  };
};
const detail = (s: Spec) => ({
  id: s.id, source: s.source, url: `${SOURCE_URL[s.source]}${s.n}`, name: s.name, author: s.author, distanceM: s.km * 1000, elevGainM: s.gain, loop: s.loop,
  line: shape(s.n, 240, s.loop).map((p, i) => s.gain === null ? [round(p.lng, 5), round(p.lat, 5)] : [round(p.lng, 5), round(p.lat, 5), Math.round(620 + 140 * Math.sin(i / 17) + i * 0.8)]),
});

type Mode = 'ok' | 'empty' | 'error-once' | 'many';
async function mock(page: Page, mode: Mode = 'ok') {
  const calls: { kind: string; body: Record<string, unknown> }[] = [];
  let failed = false;
  await page.route('https://*.supabase.co/functions/v1/route-sources', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = route.request().postDataJSON() as { kind: string; id?: string };
    calls.push({ kind: body.kind, body });
    const json = (status: number, data: unknown) => route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(data) });
    if (mode === 'error-once' && !failed) { failed = true; return json(503, { error: { code: 'unavailable' } }); }
    if (body.kind === 'library-route') {
      const found = SPECS.find(s => s.id === body.id);
      return found ? json(200, { data: detail(found) }) : json(404, { error: { code: 'not_found' } });
    }
    if (mode === 'empty') return json(200, { data: { total: 0, routes: [] } });
    if (mode === 'many') {
      const routes = Array.from({ length: 300 }, (_, i) => catalogItem({ ...SPECS[i % SPECS.length], id: uuid(1000 + i), n: i + 1, name: `${SPECS[i % SPECS.length].name} · tramo ${i + 1}` }));
      return json(200, { data: { total: 412, routes } });
    }
    return json(200, { data: { total: SPECS.length, routes: SPECS.map(catalogItem) } });
  });
  return calls;
}

const noOverflow = (page: Page) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
const cards = (page: Page) => page.getByRole('list', { name: 'Rutas de la biblioteca común' }).getByRole('article');

async function open(page: Page, width: number, height = 900, theme = 'light') {
  await page.setViewportSize({ width, height });
  await page.addInitScript(t => localStorage.setItem('fbt-theme', t), theme);
  await seed(page, { settings: settings() });
  await page.goto('#/rutas/biblioteca');
}

for (const [width, height] of [[360, 800], [1440, 900]] as const) {
  test(`biblioteca común: lista sin desbordes a ${width}px`, async ({ page }) => {
    await mock(page);
    await open(page, width, height);
    await expect(cards(page)).toHaveCount(24);
    await expect(page.getByText('24 rutas', { exact: true })).toBeVisible();
    await noOverflow(page);
    const lefts = await cards(page).evaluateAll(els => [...new Set(els.slice(0, 6).map(e => Math.round(e.getBoundingClientRect().left)))]);
    expect(lefts.length).toBe(width >= 1024 ? 3 : 1);
    // Cada tarjeta enseña su origen con enlace seguro (la ruta del nombre larguísimo, también).
    const link = page.getByRole('link', { name: /Ride with GPS · Autora 1 \(se abre/ });
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('href', 'https://ridewithgps.com/routes/1');
    const box = await link.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await cards(page).nth(2).scrollIntoViewIfNeeded();
    await noOverflow(page);
  });
}

test('biblioteca común: los filtros cambian el recuento (móvil)', async ({ page }) => {
  await mock(page);
  await open(page, 360, 800);
  await expect(cards(page)).toHaveCount(24);
  await page.getByRole('searchbox', { name: 'Buscar por nombre o autor' }).fill('pantano');
  await expect(page.getByText(/^\d+ de 24 rutas$/)).toBeVisible();
  const afterText = await cards(page).count();
  expect(afterText).toBeGreaterThan(0); expect(afterText).toBeLessThan(24);
  await page.getByRole('searchbox', { name: 'Buscar por nombre o autor' }).fill('');
  await page.getByRole('button', { name: 'Filtrar y ordenar' }).click();
  const sheet = page.getByRole('dialog', { name: 'Filtrar y ordenar' });
  await sheet.getByRole('textbox', { name: 'Desde' }).first().fill('80');
  const far = await cards(page).count();
  expect(far).toBeLessThan(24);
  await sheet.getByRole('button', { name: 'Solo circulares' }).click();
  expect(await cards(page).count()).toBeLessThan(far);
  await sheet.getByRole('textbox', { name: 'Hasta' }).first().fill('5');
  await expect(page.getByRole('heading', { name: 'Ninguna ruta cumple los filtros' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Quitar filtros' }).click();
  await expect(cards(page)).toHaveCount(24);
  await noOverflow(page);
});

test('biblioteca común: filtros en línea y orden en escritorio', async ({ page }) => {
  await mock(page);
  await open(page, 1440, 900);
  await expect(cards(page)).toHaveCount(24);
  await expect(page.getByRole('button', { name: 'Filtrar y ordenar' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Komoot' }).click();
  await expect(cards(page)).toHaveCount(6);
  await page.getByRole('button', { name: 'Todas' }).click();
  await page.getByLabel('Ordenar por').selectOption('long');
  const km = await cards(page).first().getByRole('definition').first().innerText();
  expect(parseInt(km, 10)).toBeGreaterThanOrEqual(100);
  await page.getByRole('textbox', { name: 'Desde' }).nth(1).fill('1000');
  await expect(page.getByText(/^\d+ de 24 rutas$/)).toBeVisible();
  await noOverflow(page);
});

for (const width of [390, 1440]) {
  test(`biblioteca común: el detalle abre mapa, perfil, cifras y atribución a ${width}px`, async ({ page }) => {
    const calls = await mock(page);
    await open(page, width, width > 1000 ? 900 : 844);
    await page.getByRole('button', { name: 'Vuelta al pantano 1', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Vuelta al pantano 1', exact: true });
    await expect(dialog.locator('.leaflet-container')).toBeVisible();
    await expect(dialog.getByRole('link', { name: /Ride with GPS · Autora 1 \(se abre/ })).toHaveAttribute('href', 'https://ridewithgps.com/routes/1');
    await expect(dialog.getByRole('link', { name: 'CyclOSM' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: /OpenStreetMap/ })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Perfil' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Descargar GPX' })).toBeEnabled();
    expect(calls.filter(c => c.kind === 'library-route')).toHaveLength(1);
    await noOverflow(page);
    await dialog.getByRole('button', { name: 'Guardar en Mis rutas' }).click();
    await expect(dialog.getByRole('button', { name: 'Ya está en Mis rutas' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cerrar' }).click();
    await expect(page.getByText('En Mis rutas', { exact: true })).toBeVisible();
    // Quedó guardada en Mis rutas con su origen.
    await page.getByRole('button', { name: 'Mis rutas', exact: true }).click();
    await expect(page.getByRole('button', { name: /Vuelta al pantano 1/ })).toBeVisible();
    await page.getByRole('button', { name: /Vuelta al pantano 1/ }).click();
    await expect(page.getByRole('link', { name: /Origen: enlace · / })).toHaveAttribute('href', 'https://ridewithgps.com/routes/1');
  });
}

test('biblioteca común: una ruta sin altitud no enseña perfil y la descarga sigue disponible', async ({ page }) => {
  await mock(page);
  await open(page, 390, 844);
  // La ruta 6 («Autora 6») no tiene altitud.
  await page.getByRole('searchbox', { name: 'Buscar por nombre o autor' }).fill('Autora 6');
  await cards(page).first().getByRole('button').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Sin altitud').first()).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Perfil' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Descargar GPX' })).toBeEnabled();
});

test('biblioteca común: error con reintento, vacía y 300 rutas', async ({ page }) => {
  await mock(page, 'error-once');
  await open(page, 390, 844);
  await expect(page.getByRole('alert')).toContainText('No se pudo leer la biblioteca común');
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(cards(page)).toHaveCount(24);
});

test('biblioteca común: sin rutas en la zona', async ({ page }) => {
  await mock(page, 'empty');
  await open(page, 390, 844);
  await expect(page.getByRole('heading', { name: 'Aún no hay rutas cerca' })).toBeVisible();
  await noOverflow(page);
});

test('biblioteca común: 300 rutas no desbordan y avisan del total', async ({ page }) => {
  await mock(page, 'many');
  await open(page, 360, 800);
  await expect(cards(page)).toHaveCount(300);
  await expect(page.getByText(/las 300 más cercanas de 412/)).toBeVisible();
  await noOverflow(page);
});

test('biblioteca común: sin punto de salida pide fijarlo', async ({ page }) => {
  const calls = await mock(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, { settings: settings({ home: null }) });
  await page.goto('#/rutas/biblioteca');
  await expect(page.getByRole('heading', { name: 'Elige tu punto de salida' })).toBeVisible();
  expect(calls).toHaveLength(0);
});

for (const theme of ['light', 'dark']) {
  for (const [width, height] of [[390, 844], [1440, 900]] as const) {
    test(`biblioteca común: capturas ${theme} ${width}`, async ({ page }) => {
      mkdirSync(SHOTS, { recursive: true });
      await mock(page);
      await open(page, width, height, theme);
      await expect(cards(page)).toHaveCount(24);
      await page.waitForTimeout(7000); // espera a que se vaya el aviso de la comunidad, que no es de esta pantalla
      await page.screenshot({ path: `${SHOTS}/lista-${theme}-${width}.png` });
      if (width < 600) {
        await page.getByRole('button', { name: 'Filtrar y ordenar' }).click();
        await expect(page.getByRole('dialog', { name: 'Filtrar y ordenar' })).toBeVisible();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/filtros-${theme}-${width}.png` });
        await page.getByRole('button', { name: 'Cerrar' }).click();
      }
      await page.getByRole('button', { name: 'Vuelta al pantano 1', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Vuelta al pantano 1', exact: true });
      await expect(dialog.getByRole('heading', { name: 'Perfil' })).toBeVisible();
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${SHOTS}/detalle-${theme}-${width}.png` });
    });
  }
}
