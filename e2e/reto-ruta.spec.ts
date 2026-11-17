import { mkdirSync } from 'node:fs';
import { test, expect, TEST_USER_ID, type Page } from './accountFixture';
import type { CommunityChallenge } from '../src/social/communityChallenges';

// Reto de ruta a 390 px: crear desde un GPX sintético (en el mar, lat 41.0 y lng 2.5) y ver el detalle.
test.setTimeout(90_000);
const SHOTS = 'docs/design/2026-11-17-reto-ruta';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const RIVAL = '00000000-0000-0000-0000-000000000022';
const cyclist = (id: string, display_name: string) => ({ id, display_name, username: `ciclista_${id.slice(-2)}`, bio: '', riding_style: 'explorar', avatar_version: 0, locality: null, distance_km: null, last_active_at: null });
const GPX = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<gpx version="1.1" creator="sintetico" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Faro sintético</name><trkseg>',
  ...Array.from({ length: 101 }, (_, i) => `<trkpt lat="${(41 + i * 0.001).toFixed(4)}" lon="2.5000"><ele>${(i % 20) * 2}</ele></trkpt>`),
  '</trkseg></trk></gpx>',
].join('\n');

function routeChallenge(over: Partial<CommunityChallenge> = {}): CommunityChallenge {
  return {
    id: 'created', title: 'Faro sintético', kind: 'route', created_at: new Date().toISOString(), deadline: '2099-12-15T08:00:00Z', creator_id: TEST_USER_ID,
    target_value: null, distance_m: null, segment_key: null, route_distance_m: 10_120, status: 'active', winner_ids: [],
    members: [
      { ...cyclist(TEST_USER_ID, 'Fran'), status: 'accepted', accepted_at: new Date().toISOString(), score: null, updated_at: null },
      { ...cyclist(RIVAL, 'Ana Ruta'), status: 'pending', accepted_at: null, score: null, updated_at: null },
    ], ...over,
  };
}

async function mockRouteChallenges(page: Page) {
  const state = { create: [] as Record<string, unknown>[], row: null as CommunityChallenge | null, points: [] as unknown[] };
  await page.route(/tile-cyclosm/, r => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>' }));
  await page.route('https://*.supabase.co/rest/v1/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const name = new URL(req.url()).pathname.split('/').pop();
    const args = req.postDataJSON() ?? {};
    const json = (body: unknown) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (name === 'list_cyclists') return json([cyclist(RIVAL, 'Ana Ruta')]);
    if (name === 'create_route_challenge') {
      state.create.push(args); state.points = args.route_points; state.row = routeChallenge({ title: args.title });
      return json('created');
    }
    if (name === 'get_community_challenge') return json(state.row);
    if (name === 'list_community_challenges') return json(state.row ? [state.row] : []);
    if (name === 'community_route_challenges') return json({ points: state.points, distance_m: 10_120 });
    return json([]);
  });
  return state;
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('crear un reto de ruta desde un GPX y ver el detalle con el marcador a 390 px', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await mockRouteChallenges(page);
  await page.goto('./#/retos/nuevo');
  await page.getByLabel(/Ana Ruta/).check();
  await page.getByLabel('Tipo de reto').selectOption('route');
  await page.getByRole('button', { name: 'Subir GPX' }).click();
  await page.getByLabel('Archivo GPX de la ruta').setInputFiles({ name: 'faro.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(GPX) });
  await expect(page.getByRole('region', { name: 'Mapa de la ruta del reto' })).toBeVisible();
  await expect(page.getByText(/recortan 500 m/)).toBeVisible();
  await expect(page.getByLabel('Nombre del reto')).toHaveValue('Faro sintético');
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/nuevo-reto-ruta-390.png`, fullPage: true });

  await page.getByRole('button', { name: 'Lanzar duelo' }).click();
  await expect(page).toHaveURL(/#\/retos\/comunidad\/created$/);
  const sent = state.create[0] as { route_points: number[][]; distance_m: number; invited_ids: string[]; duration_days: number };
  expect(sent.invited_ids).toEqual([RIVAL]);
  expect(sent.route_points.length).toBeLessThanOrEqual(2000);
  // Recortados 500 m de cada extremo: la ruta del rival no empieza ni acaba en el primer o último punto del GPX.
  expect(sent.route_points[0][0]).toBeGreaterThan(41.004);
  expect(sent.route_points[sent.route_points.length - 1][0]).toBeLessThan(41.096);
  expect(sent.distance_m).toBeGreaterThan(10_000);
  expect(sent.distance_m).toBeLessThan(10_200);

  await expect(page.getByText('Tú contra Ana Ruta')).toBeVisible();
  await expect(page.getByText('Pendiente de salida')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mapa de la ruta del reto' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar GPX' })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/reto-ruta-pendiente-390.png`, fullPage: true });

  state.row = routeChallenge({
    members: [
      { ...cyclist(TEST_USER_ID, 'Fran'), status: 'accepted', accepted_at: new Date().toISOString(), score: 1502, updated_at: new Date().toISOString() },
      { ...cyclist(RIVAL, 'Ana Ruta'), status: 'accepted', accepted_at: new Date().toISOString(), score: 1490, updated_at: new Date().toISOString() },
    ],
  });
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  const duel = page.getByRole('group', { name: 'Comparativa del duelo' });
  await expect(duel.getByText('0:25:02')).toBeVisible();
  await expect(duel.getByText('0:24:50')).toBeVisible();
  await expect(page.getByText('Pendiente de salida')).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar GPX' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.gpx$/);
  await page.screenshot({ path: `${SHOTS}/reto-ruta-marcador-390.png`, fullPage: true });
});
