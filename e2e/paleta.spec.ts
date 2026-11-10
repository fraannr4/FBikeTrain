import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AUTH_KEY, expect, test, TEST_DATABASE, type Page } from './accountFixture';
import { auditContrast, type ContrastReport } from './contrast';
import { NOW, RIDES, seed, settings } from './seed';

// Solo datos inventados y servicios interceptados; no usa cuentas, claves o tracks reales.
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../tests/fixtures/${name}`, import.meta.url)), 'utf8');
const ORS_OK = fixture('ors/round-trip-ok.json');
const EXPLAIN_OK = fixture('llm/explain-ok.json');
const PLAN_OK = (() => {
  const response = JSON.parse(fixture('llm/plan-ok.json'));
  const plan = JSON.parse(response.choices[0].message.content);
  for (const option of plan.opciones) option.distanciaKm = 30;
  response.choices[0].message.content = JSON.stringify(plan);
  return JSON.stringify(response);
})();
const CORS = { 'access-control-allow-origin': '*' };
const VIEWPORTS = [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1440, height: 1000 }];

// Mínimos no redondeados de la tabla A, calculados a partir de sus valores aprobados.
const APPROVED = {
  dark: { bg: '#14221F', surface: '#1D3029', 'surface-2': '#233B30', 'surface-3': '#2A4035', ink: '#E5EDDF', 'ink-2': '#C3D0C0', 'ink-3': '#B0C0AF' },
  light: { bg: '#F7F4EA', surface: '#FFFDF5', 'surface-2': '#EDEFE3', 'surface-3': '#D8DFC5', ink: '#163B30', 'ink-2': '#3D5543', 'ink-3': '#4F604F' },
};
function ratio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/.{2}/g)!.map((c) => parseInt(c, 16) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

async function expectPaletteContrast(page: Page, theme: 'dark' | 'light') {
  const tokens = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return Object.fromEntries(['bg', 'surface', 'surface-2', 'surface-3', 'ink', 'ink-2', 'ink-3'].map((token) => [token, css.getPropertyValue(`--${token}`).trim()]));
  });
  const approved = APPROVED[theme];
  const backgrounds = ['bg', 'surface', 'surface-2', 'surface-3'] as const;
  for (const ink of ['ink', 'ink-2', 'ink-3'] as const) {
    const minimum = Math.min(...backgrounds.map((bg) => ratio(approved[ink], approved[bg])));
    for (const bg of backgrounds) {
      expect(tokens[ink], `--${ink}: valor resuelto`).toMatch(/^#[\da-f]{6}$/i);
      expect(tokens[bg], `--${bg}: valor resuelto`).toMatch(/^#[\da-f]{6}$/i);
      expect(ratio(tokens[ink], tokens[bg]) + 1e-10, `${theme}: --${ink} sobre --${bg}, mínimo tabla A`).toBeGreaterThanOrEqual(minimum);
    }
  }
}

async function populate(page: Page) {
  await seed(page, {
    activities: RIDES.map((r, i) => i === 0 ? { ...r, name: 'Vuelta al Alto del Pinar', hasTrack: true } : r),
    settings: { ...settings({ orsKey: 'synthetic-key', llmKey: 'synthetic-key' }), displayName: 'Alex' },
  });
  await page.evaluate(async ({ database, time }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(database);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['tracks', 'calendar', 'goals'], 'readwrite');
    // Circunferencia y altitud analíticas, sin geometrías de una actividad real.
    tx.objectStore('tracks').put({ activityId: 's0', points: Array.from({ length: 81 }, (_, i) => ({
      t: time - 2 * 86_400_000 + i * 60_000,
      lat: 40.45 + 0.025 * Math.sin(i * Math.PI / 40),
      lng: -3.70 + 0.035 * Math.cos(i * Math.PI / 40),
      ele: 600 + 120 * Math.sin(i * Math.PI / 40) ** 2,
      dist: i * 437.5,
    })) });
    tx.objectStore('calendar').put({ id: 'synthetic-workout', date: '2026-11-07', title: 'Fondo por el valle', distanceM: 60_000, elevGainM: 650, done: false, manual: true, createdAt: time });
    tx.objectStore('goals').put({ id: 'synthetic-goal', kind: 'volume', title: 'Objetivo de noviembre', period: 'month', start: '2026-11-01', distanceM: 400_000, createdAt: time });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  }, { database: TEST_DATABASE, time: NOW.getTime() });
  await page.reload();
}

for (const theme of ['dark', 'light'] as const) {
  for (const viewport of VIEWPORTS) {
    test(`A Fiel: ${theme} ${viewport.width}px, pantallas y contraste`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.clock.setFixedTime(NOW);
      await page.addInitScript((theme) => localStorage.setItem('fbt-theme', theme), theme);
      await page.route(/tile-cyclosm/, (route) => route.abort());
      await page.route('https://api.heigit.org/openrouteservice/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: ORS_OK }));
      let llmCalls = 0;
      await page.route('**/chat/completions', (route) => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
        return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: ++llmCalls === 1 ? PLAN_OK : EXPLAIN_OK });
      });
      await populate(page);
      const dir = `test-results/paleta-a/${theme}/${viewport.width}`;
      mkdirSync(dir, { recursive: true });
      const reports: Record<string, ContrastReport> = {};
      const capture = async (name: string, surface = page) => {
        await surface.evaluate(() => document.fonts.ready);
        // Las confirmaciones de generar una ruta no deben tapar el contenido de la siguiente captura.
        await surface.mouse.move(0, 0);
        await expect(surface.locator('.toast')).toHaveCount(0, { timeout: 10_000 });
        await expect.soft(surface.locator('html'), `${name}: tema`).toHaveAttribute('data-theme', theme);
        expect.soft(await surface.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${name}: sin desbordamiento`).toBe(true);
        await surface.evaluate(() => scrollTo(0, 0));
        await surface.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
        reports[name] = await auditContrast(surface, 4.5);
        expect.soft(reports[name].contrast, `${name}: texto ≥4,5:1`).toEqual([]);
        writeFileSync(`${dir}/contraste.json`, JSON.stringify(reports, null, 2));
      };

      await page.goto('#/');
      await expect(page.getByRole('region', { name: 'Esta semana' })).toBeVisible();
      await expect(page.locator('.kpi')).toHaveCount(4);
      for (const kpi of await page.locator('.kpi').all()) await expect(kpi).toBeVisible();
      const base = await page.evaluate(() => {
        const css = getComputedStyle(document.documentElement);
        return ['--bg', '--surface', '--ink'].map((token) => css.getPropertyValue(token).trim());
      });
      expect(base).toEqual(theme === 'dark' ? ['#14221F', '#1D3029', '#E5EDDF'] : ['#F7F4EA', '#FFFDF5', '#163B30']);
      await expectPaletteContrast(page, theme);
      await capture('inicio');
      await page.goto('#/historial');
      await expect(page.getByRole('heading', { name: 'Historial', exact: true }).first()).toBeVisible();
      await expect(page.getByText('Vuelta al Alto del Pinar').first()).toBeVisible();
      await capture('historial');
      await page.goto('#/historial/s0');
      await expect(page.getByRole('heading', { name: 'Vuelta al Alto del Pinar' })).toBeVisible();
      await expect(page.locator('.rmap .leaflet-overlay-pane svg').first()).toBeAttached();
      await capture('salida');

      await page.goto('#/rutas');
      const distance = page.getByRole('group', { name: 'Distancia' });
      await expect(distance).toBeVisible();
      await capture('rutas-formulario');
      const less = distance.getByRole('button', { name: 'Menos distancia' });
      await less.focus();
      for (let i = 0; i < 40 && !/^30\s?km/.test((await distance.locator('output').innerText()).trim()); i++) await page.keyboard.press('Enter');
      await page.getByRole('button', { name: /Generar 5 rutas/ }).click();
      await expect(page.getByRole('list', { name: 'Rutas generadas' })).toBeVisible({ timeout: 30_000 });
      await capture('rutas');

      await page.goto('#/rutas/ia');
      await expect(page.getByRole('radio', { name: /^Fondo/ })).toBeVisible();
      await capture('rutas-ia-formulario');
      for (const name of [/^Fondo/, /^2 h/, /^Casa/, /^Repetir zona/]) await page.getByRole('radio', { name }).click();
      await page.getByRole('button', { name: 'Pedir rutas a la IA' }).click();
      await expect(page.getByRole('list', { name: 'Propuestas de la IA' })).toBeVisible({ timeout: 40_000 });
      await capture('rutas-ia');
      await page.goto('#/plan');
      await page.getByRole('button', { name: 'Sábado 7 de noviembre: Fondo por el valle, pendiente', exact: true }).click();
      await expect(page.getByRole('article', { name: 'Fondo por el valle' })).toBeVisible();
      await capture('plan-calendario');
      await page.goto('#/ajustes');
      await expect(page.getByRole('heading', { name: 'Ajustes', exact: true }).first()).toBeVisible();
      await capture('ajustes');

      // Otra página sin la sesión del fixture, para probar el acceso real protegido.
      const login = await page.context().newPage();
      await login.setViewportSize(viewport);
      await login.emulateMedia({ reducedMotion: 'reduce' });
      await login.route('https://*.supabase.co/**', (route) => route.abort());
      await login.addInitScript(({ key, theme }) => { localStorage.removeItem(key); localStorage.setItem('fbt-theme', theme); }, { key: AUTH_KEY, theme });
      await login.goto('/');
      await expect(login.getByRole('heading', { name: 'Vuelve a tu ritmo' })).toBeVisible();
      const account = await login.locator('.account-page').evaluate((element) => {
        const css = getComputedStyle(element);
        return ['map', 'contour', 'route', 'paper'].map((token) => css.getPropertyValue(`--account-${token}`).trim().toUpperCase());
      });
      expect(account).toEqual(theme === 'dark' ? ['#233B30', '#829778', '#80B4F5', '#14221F'] : ['#D8DFC5', '#879D7D', '#2465D5', '#F7F4EA']);
      // Colores ya resueltos en los elementos, además de las propiedades personalizadas heredadas.
      await expect(login.locator('.account-landscape')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(35, 59, 48)' : 'rgb(216, 223, 197)');
      await expect(login.locator('.account-contour-lines')).toHaveCSS('stroke', theme === 'dark' ? 'rgb(130, 151, 120)' : 'rgb(135, 157, 125)');
      await expect(login.locator('.account-route-line')).toHaveCSS('stroke', theme === 'dark' ? 'rgb(128, 180, 245)' : 'rgb(36, 101, 213)');
      await expect(login.locator('.account-card')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(20, 34, 31)' : 'rgb(247, 244, 234)');
      await capture('login', login);
      await login.close();
    });
  }
}
