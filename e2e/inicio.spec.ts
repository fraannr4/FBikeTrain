import { expect, test, type Page } from './accountFixture';

// Inicio en el móvil (auditoría, ronda 2): volver atrás sin perder el sitio, foco tras los datos de
// ejemplo, vacío en apaisado, cifras de la semana a la misma altura, texto bidireccional y la
// atribución del mapa. Datos sintéticos metidos en la base IndexedDB «ciclismo».

const NOW = new Date('2026-11-06T12:00:00+01:00'); // viernes
const DAY = 86_400_000;
const SHOTS = 'test-results/movil/inicio';

type Seed = { activities?: unknown[]; calendar?: unknown[] };

/** Abre la app para que Dexie cree la base, escribe los datos y recarga. */
async function seed(page: Page, data: Seed) {
  await page.goto('#/');
  await expect(page.getByText('Aún no hay salidas')).toBeVisible();
  await page.evaluate(async ({ activities = [], calendar = [] }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ciclismo-user-00000000-0000-0000-0000-000000000011');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['activities', 'calendar'], 'readwrite');
    for (const a of activities) tx.objectStore('activities').put(a);
    for (const w of calendar) tx.objectStore('calendar').put(w);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, data);
  await page.reload();
}

function ride(id: string, startTime: number, over: { distanceM?: number; elevGainM?: number; avgSpeedMs?: number } = {}) {
  const distanceM = over.distanceM ?? 60_000;
  const avgSpeedMs = over.avgSpeedMs ?? 7;
  const movingTimeS = Math.round(distanceM / avgSpeedMs);
  return {
    id,
    startTime,
    sport: 'cycling',
    name: `Salida ${id}`,
    totals: { distanceM, movingTimeS, elapsedTimeS: movingTimeS + 300, elevGainM: over.elevGainM ?? 800, avgSpeedMs, maxSpeedMs: 16 },
    hasTrack: false,
    source: 'gpx',
    importedAt: NOW.getTime(),
  };
}

/** Cuatro semanas anteriores con dos salidas cada una: hay referencia y diferencias en las cifras. */
const history = (elevGainM = 800) =>
  Array.from({ length: 8 }, (_, i) => ride(`h${i}`, NOW.getTime() - (8 + i * 3.5) * DAY, { elevGainM }));
const HISTORY = history();

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

test.describe('Inicio en el móvil', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await page.route(/tile-cyclosm/, (r) => r.abort());
  });

  test('datos de ejemplo con el teclado, volver de «Ver salida» a la misma altura y atribución del mapa', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('#/');

    await test.step('el foco va al título y se anuncia la carga', async () => {
      const demo = page.getByRole('button', { name: 'Ver con datos de ejemplo' });
      await demo.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('region', { name: 'Esta semana' })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeFocused();
      await expect(page.getByText('Datos de ejemplo cargados')).toBeAttached();
    });

    await test.step('la cifra de partida no lleva el borde de elegida', async () => {
      const dist = page.locator('.kpi').first();
      await expect(dist).toHaveAttribute('aria-pressed', 'true');
      await expect(dist).toHaveAttribute('data-quiet', '');
      await page.locator('.kpi').nth(1).click();
      await expect(page.locator('.kpi[aria-pressed="true"]')).not.toHaveAttribute('data-quiet', '');
    });

    await test.step('atribución con enlaces de 24 px y trazado oculto a los lectores', async () => {
      const attribution = page.locator('.lastride-map .leaflet-control-attribution');
      await expect(attribution).toBeVisible({ timeout: 15_000 });
      for (const link of await attribution.locator('a').all()) {
        const box = await link.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
      }
      await expect(page.locator('.lastride-map .leaflet-overlay-pane svg')).toHaveAttribute('aria-hidden', 'true');
      await page.locator('.lastride').scrollIntoViewIfNeeded();
      await page.locator('.lastride-map').screenshot({ path: `${SHOTS}/r2-atribucion-360-oscuro.png` });
    });

    await test.step('vuelve a la misma altura', async () => {
      await page.evaluate(() => document.querySelector('.lastride')?.scrollIntoView());
      const y0 = await page.evaluate(() => window.scrollY);
      expect(y0).toBeGreaterThan(600);
      await page.locator('.lastride').getByRole('link', { name: 'Ver salida' }).click();
      await expect(page).toHaveURL(/#\/historial\/[^/]+$/);
      await page.goBack();
      await expect(page.locator('.lastride')).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y0 - 40);
      expect(await page.evaluate(() => window.scrollY)).toBeLessThan(y0 + 40);
      await page.screenshot({ path: `${SHOTS}/r2-vuelta-360-oscuro.png` });
    });
  });

  test('vacío en apaisado: la frase y la nota del ejemplo se quedan', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('#/');
    await expect(page.getByText(/Aún no hay salidas\. Importa el archivo de Strava/)).toBeVisible();
    await expect(page.getByText(/Salidas inventadas para ver la app llena/)).toBeVisible();
    for (const t of ['light', 'dark'] as const) {
      await setTheme(page, t);
      await page.screenshot({ path: `${SHOTS}/vacio-844x390-${t === 'dark' ? 'oscuro' : 'claro'}.png` });
    }
  });

  for (const c of [
    // 11.810 m de desnivel en dos salidas (con «+64 %»): la cifra más ancha en 360 px.
    { width: 360, height: 780, elev: 3_000, week: [{ elevGainM: 5_905 }, { elevGainM: 5_905 }], name: 'desnivel-11810-360' },
    // 23,7 km/h: la que bajaba de línea a 1280 px.
    { width: 1280, height: 800, elev: 800, week: [{ avgSpeedMs: 23.7 / 3.6 }, { avgSpeedMs: 23.7 / 3.6 }], name: 'velocidad-1280' },
  ])
    test(`cifras de la semana en una línea y a la misma altura: ${c.name}`, async ({ page }) => {
      await page.setViewportSize({ width: c.width, height: c.height });
      await seed(page, {
        activities: [...history(c.elev), ...c.week.map((o, i) => ride(`w${i}`, NOW.getTime() - (i + 1) * DAY, o))],
      });
      await expect(page.locator('.kpi .delta')).toHaveCount(4);
      // Libro de ruta: la distancia es la cifra titular, con su diferencia al lado, a cualquier ancho.
      // Por debajo de 900 px las otras tres forman una ficha de tres columnas con la diferencia
      // debajo; en escritorio, una ficha de una línea con la diferencia al lado.
      const ficha = c.width < 900;
      // La cifra encoge al medir: se espera a que no quede ninguna diferencia en una segunda línea.
      await expect
        .poll(() =>
          page.evaluate(
            (stacked) =>
              [...document.querySelectorAll('.kpi-row')].every((r, i) => {
                const [v, d] = [...r.children].map((e) => e.getBoundingClientRect());
                if (!stacked || i === 0) return d.top < v.bottom - 4;
                // En la ficha: la cifra en una sola línea, dentro de su columna, y la diferencia debajo.
                const row = r.getBoundingClientRect();
                return v.height < 48 && v.right <= row.right + 0.5 && d.top >= v.bottom - 4;
              }),
            ficha,
          ),
        )
        .toBe(true);
      // La cifra encogida es un poco más baja, pero ninguna fila gana una línea. Se comparan las
      // tres columnas de la ficha entre sí: la titular mide otra cosa a propósito, a cualquier ancho.
      const rows = await page.evaluate(
        () => [...document.querySelectorAll('.kpi-row')].slice(1).map((r) => { const b = r.getBoundingClientRect(); return { h: b.height, top: b.top }; }),
      );
      expect(rows).toHaveLength(3);
      expect(Math.max(...rows.map((r) => r.h)) - Math.min(...rows.map((r) => r.h))).toBeLessThan(3);
      expect(Math.max(...rows.map((r) => r.top)) - Math.min(...rows.map((r) => r.top))).toBeLessThan(3);
      for (const t of ['dark', 'light'] as const) {
        await setTheme(page, t);
        await page.locator('.week').screenshot({ path: `${SHOTS}/r2-kpi-${c.name}-${t === 'dark' ? 'oscuro' : 'claro'}.png` });
      }
    });

  test('un nombre en árabe no arrastra las cifras de «Hoy» ni desborda', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    const name = '東京サイクリング 早朝ライド — رحلة الدراجة الصباحية الطويلة جدا';
    await seed(page, {
      activities: HISTORY,
      calendar: [{ id: 'sab', date: '2026-11-07', title: name, distanceM: 55_000, done: false, manual: true, createdAt: 1 }],
    });
    const today = page.locator('.today');
    const title = today.locator('.today-title');
    await expect(title).toHaveText(name);
    await expect(title).toHaveAttribute('dir', 'auto');
    // Las cifras van en su propia línea, debajo del nombre (dos líneas como mucho), y el botón cabe.
    const [t, meta, btn] = await Promise.all([title.boundingBox(), today.locator('.route-meta').boundingBox(), today.getByRole('link', { name: 'Ruta y GPX' }).boundingBox()]);
    expect(meta!.y).toBeGreaterThanOrEqual(t!.y + t!.height - 1);
    expect(btn!.x + btn!.width).toBeLessThanOrEqual(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    for (const th of ['dark', 'light'] as const) {
      await setTheme(page, th);
      await today.screenshot({ path: `${SHOTS}/r2-bidi-360-${th === 'dark' ? 'oscuro' : 'claro'}.png` });
    }
  });
});

// Distribución (2026-11-19): con cuenta registrada, la primera pantalla del móvil enseña el saludo,
// «Hoy», «Tu gente» y el arranque de la semana. RPC simuladas; nombres inventados.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const at = (hhmm: string) => new Date(`2026-11-06T${hhmm}:00+01:00`).toISOString();
const PENDING = {
  chat_unread_count: 2,
  chat_list_conversations: [{
    id: 'c1', kind: 'direct', title: null, peer_id: 'p1', peer_name: 'Ana Ruta', peer_avatar_version: 0, peer_last_read_at: null,
    last_kind: 'text', last_preview: '¿Quedamos a las 8:15 mejor?', last_sender_id: 'p1', last_message_at: at('10:42'), unread: 2,
    muted: false, can_send: true, last_deleted: false,
  }],
  list_community_challenges: [{
    id: 'r1', title: 'Más kilómetros esta semana', kind: 'distance', created_at: at('09:15'), deadline: new Date(NOW.getTime() + 5 * DAY).toISOString(),
    creator_id: 'p2', target_value: null, distance_m: null, segment_key: null, status: 'active', winner_ids: [],
    members: [
      { id: 'p2', username: 'martapuig', display_name: 'Marta Puig', status: 'accepted', accepted_at: null, score: null, updated_at: null },
      { id: '00000000-0000-0000-0000-000000000011', username: 'yo', display_name: 'Yo', status: 'pending', accepted_at: null, score: null, updated_at: null },
    ],
  }],
  list_friends: ['Pol Serra', 'Eva Mas'].map((n, i) => ({
    friendship_id: `f${i}`, status: 'pending', direction: 'received',
    profile: { id: `u${i}`, username: `u${i}`, display_name: n, locality: null, distance_km: null },
  })),
};
const CALM = { chat_unread_count: 0, chat_list_conversations: [], list_community_challenges: [], list_friends: [] };

async function fakeRpc(page: Page, data: Record<string, unknown>) {
  await page.routeWebSocket(/supabase\.co/, () => {});
  await page.route('https://*.supabase.co/rest/v1/rpc/*', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const fn = new URL(r.request().url()).pathname.split('/').pop()!;
    if (fn in data) return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(data[fn]) });
    return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: fn.startsWith('list_') ? '[]' : 'null' });
  });
}

const WEEK = [ride('w1', NOW.getTime() - 2 * DAY), ride('w2', NOW.getTime() - DAY)];
const TODAY = [{ id: 'hoy', date: '2026-11-06', title: 'Vuelta al embalse', distanceM: 64_000, elevGainM: 820, done: false, manual: true, createdAt: 1 }];
const bottomOf = async (page: Page, selector: string) => { const b = (await page.locator(selector).first().boundingBox())!; return b.y + b.height; };

test.describe('Inicio en el móvil, primera pantalla con cuenta', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await page.route(/tile-cyclosm/, (r) => r.abort());
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('con pendientes: saludo, «Hoy», «Tu gente» con tres filas y el arranque de la semana', async ({ page }) => {
    await fakeRpc(page, PENDING);
    await seed(page, { activities: [...HISTORY, ...WEEK], calendar: TODAY });
    const people = page.getByRole('region', { name: 'Tu gente' });
    await expect(people.getByRole('list', { name: 'Pendiente con tu gente' }).getByRole('link')).toHaveCount(3);
    await expect(people.getByRole('link', { name: 'Ver todo lo pendiente con tu gente, 4' })).toHaveAttribute('href', '#/gente');
    // El saludo se encoge (era de 367 px a este ancho).
    const hero = (await page.locator('.hero').boundingBox())!;
    expect(hero.height).toBeLessThan(300);
    const dock = (await page.getByRole('navigation', { name: 'Menú principal' }).boundingBox())!.y;
    for (const s of ['.today', '.people', '.week-title']) expect(await bottomOf(page, s)).toBeLessThanOrEqual(dock);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    for (const t of ['dark', 'light'] as const) {
      await setTheme(page, t);
      await page.screenshot({ path: `${SHOTS}/distribucion-390-pendientes-${t === 'dark' ? 'oscuro' : 'claro'}.png` });
    }
  });

  test('sin pendientes: una fila «Todo al día» y la semana entera en la primera pantalla', async ({ page }) => {
    await fakeRpc(page, CALM);
    await seed(page, { activities: [...HISTORY, ...WEEK], calendar: TODAY });
    await expect(page.getByRole('link', { name: 'Tu gente: todo al día. Abrir Gente' })).toHaveAttribute('href', '#/gente');
    const dock = (await page.getByRole('navigation', { name: 'Menú principal' }).boundingBox())!.y;
    expect(await bottomOf(page, '.kpis')).toBeLessThanOrEqual(dock);
    for (const t of ['dark', 'light'] as const) {
      await setTheme(page, t);
      await page.screenshot({ path: `${SHOTS}/distribucion-390-aldia-${t === 'dark' ? 'oscuro' : 'claro'}.png` });
    }
  });
});
