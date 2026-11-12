import type { LatLng } from '../src/domain/types';
import type { AdaptedRoute } from '../src/routes/adapt';
import { OrsError } from '../src/routes/ors';
import { bearingDeg, proposeRwgpsRoutes, type RwgpsProposalUpdate } from '../src/routes/sources/rwgpsProposals';
import { fetchRwgpsNearby } from '../src/routes/sources/rwgpsImport';

// Respuestas sintéticas de la función `rwgps` (op `nearby` y `route`): circuitos inventados en el mar.
const START: LatLng = { lat: 41, lng: 2.5 };
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((START.lat * Math.PI) / 180);

/** Circuito de `km` que sale y vuelve a `START`, con su punto más lejano hacia `deg` (0 norte, 90 este). */
function circuit(km: number, deg: number, n = 120): LatLng[] {
  const r = (km * 1000) / (2 * Math.PI);
  const a = (deg * Math.PI) / 180;
  const cx = Math.sin(a) * r;
  const cy = Math.cos(a) * r;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = Math.atan2(-cy, -cx) + (i / n) * 2 * Math.PI;
    return { lat: START.lat + (cy + r * Math.sin(t)) / M_LAT, lng: START.lng + (cx + r * Math.cos(t)) / M_LNG };
  });
}

type Fake = { id: string; km: number; deg: number; gain?: number | null; radius?: number };
const nearbyRoute = (f: Fake) => ({
  id: f.id, name: `Vuelta sintética ${f.id}`, author: 'Autora sintética', distanceM: f.km * 1000, elevGainM: f.gain === undefined ? 500 : f.gain,
  start: { lat: START.lat, lng: START.lng }, line: circuit(f.km, f.deg).map((p) => [p.lng, p.lat]), passM: 50,
});
const trackOf = (f: Fake) => ({
  route: { name: `Vuelta sintética ${f.id}`, user: { name: 'Autora sintética' }, track_points: circuit(f.km, f.deg, 360).map((p, i) => ({ x: p.lng, y: p.lat, e: 100 + (i % 20) })) },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Función `rwgps` simulada: `byRadius` dice qué rutas hay a cada radio. */
function fakeShared(byRadius: (radiusKm: number) => Fake[], onTrack?: (id: string) => Response | null) {
  const asked: { op?: string; kind?: string; id?: string; radiusKm?: number; lat?: number; lng?: number; distanceKm?: number }[] = [];
  const all = new Map<string, Fake>();
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    asked.push(body);
    if (body.op === 'nearby') {
      const routes = byRadius(body.radiusKm);
      routes.forEach((f) => all.set(f.id, f));
      return json({ data: { routes: routes.map(nearbyRoute), total: routes.length } });
    }
    const custom = onTrack?.(body.id);
    if (custom) return custom;
    return json({ data: trackOf(all.get(body.id)!) });
  });
  return { asked, access: { getToken: async () => 'sesion-sintetica', fetch: fetchImpl as unknown as typeof fetch } };
}

/** Adaptación simulada: devuelve la ruta tal cual, como un circuito que ya pasa por el inicio. */
const keep = vi.fn(async (points: { lat: number; lng: number }[], _opts?: unknown, _deps?: unknown): Promise<AdaptedRoute> => ({
  coords: points.map((p) => ({ lat: p.lat, lng: p.lng })), distanceM: 60_000, elevGainM: 500, connectorM: 0, passesNearM: 0, rotated: false, warnings: [],
}));
const target = { start: START, distanceKm: 60, elevGainM: null };
const circularGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const farBearing = (pts: LatLng[]) => {
  let best = pts[0];
  let far = -1;
  for (const p of pts) {
    const d = Math.hypot((p.lat - START.lat) * M_LAT, (p.lng - START.lng) * M_LNG);
    if (d > far) { far = d; best = p; }
  }
  return bearingDeg(START, best);
};

beforeEach(() => { keep.mockClear(); });

describe('fetchRwgpsNearby', () => {
  it('pide la zona a la función compartida con el punto redondeado y valida la respuesta', async () => {
    const { asked, access } = fakeShared(() => [{ id: '11', km: 60, deg: 0 }]);
    const out = await fetchRwgpsNearby(access, { start: { lat: 41.23456, lng: 2.34567 }, radiusKm: 5, distanceKm: 60 });
    expect(asked).toEqual([{ op: 'nearby', lat: 41.23, lng: 2.35, radiusKm: 5, distanceKm: 60 }]);
    expect(out.total).toBe(1);
    expect(out.routes[0]).toMatchObject({ id: '11', name: 'Vuelta sintética 11', author: 'Autora sintética', distanceM: 60_000, elevGainM: 500, passM: 50 });
    // La línea llega como [lng, lat] y se devuelve como puntos.
    expect(out.routes[0].line[0]).toEqual({ lat: expect.closeTo(START.lat, 6), lng: expect.closeTo(START.lng, 6) });
  });

  it('descarta las rutas mal formadas sin tirar el resto', async () => {
    const good = nearbyRoute({ id: '1', km: 60, deg: 0 });
    const fetchImpl = async () => json({ data: { routes: [good, { ...good, id: '../2' }, { ...good, id: '3', line: [] }], total: 3 } });
    const out = await fetchRwgpsNearby({ getToken: async () => 't', fetch: fetchImpl as unknown as typeof fetch }, { start: START, radiusKm: 5 });
    expect(out.routes.map((r) => r.id)).toEqual(['1']);
  });

  it('una respuesta sin forma de lista es un error claro', async () => {
    const fetchImpl = async () => json({ data: { nada: true } });
    await expect(fetchRwgpsNearby({ getToken: async () => 't', fetch: fetchImpl as unknown as typeof fetch }, { start: START, radiusKm: 5 })).rejects.toThrow('Ride with GPS no ha devuelto datos válidos.');
  });

  it('traduce cuota, saturación, servicio caído y sesión como el resto de lecturas', async () => {
    const call = (status: number, body: unknown) => fetchRwgpsNearby({ getToken: async () => 't', fetch: (async () => json(body, status)) as unknown as typeof fetch }, { start: START, radiusKm: 5 });
    await expect(call(429, { error: { code: 'quota_exceeded' }, retryAfterS: 7200 })).rejects.toMatchObject({ fatal: true, message: expect.stringMatching(/300 rutas al día.*unas 2 h/) });
    await expect(call(429, { error: { code: 'provider_busy' } })).rejects.toThrow(/limita las peticiones/);
    await expect(call(503, { error: { code: 'unavailable' } })).rejects.toThrow(/no está disponible/);
    await expect(call(401, { error: { code: 'unauthorized' } })).rejects.toThrow(/sesión/);
    await expect(fetchRwgpsNearby({ getToken: async () => null }, { start: START, radiusKm: 5 })).rejects.toThrow(/sesión/);
  });
});

describe('proposeRwgpsRoutes', () => {
  const eight = (km = 60): Fake[] => [0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => ({ id: String(100 + i), km: km + i * 0.5, deg }));

  it('amplía la zona de 5 a 15 km cuando hay pocas candidatas y se para al tener bastantes', async () => {
    const { asked, access } = fakeShared((r) => (r === 5 ? eight().slice(0, 3) : [...eight(), { id: '200', km: 61, deg: 20 }, { id: '201', km: 59, deg: 200 }]));
    const result = await proposeRwgpsRoutes(target, { rwgps: access, ors: 'clave', adapt: keep as never });
    expect(asked.filter((a) => a.op === 'nearby').map((a) => [a.radiusKm, a.distanceKm])).toEqual([[5, 60], [15, 60]]);
    expect(result.radiusKm).toBe(15);
    expect(result.nearby).toBe(10);
  });

  it('propone entre 5 y 6 rutas en direcciones distintas, sin repetidas ni solapadas', async () => {
    // Las 8 direcciones y dos copias: una con otro id y la misma línea, otra casi en la misma dirección.
    const routes = [...eight(), { id: '300', km: 60, deg: 0 }, { id: '301', km: 60.2, deg: 10 }];
    const { asked, access } = fakeShared(() => routes);
    const result = await proposeRwgpsRoutes(target, { rwgps: access, ors: 'clave', adapt: keep as never });
    const ids = result.proposals.map((p) => p.route.id);
    expect(result.proposals.length).toBeGreaterThanOrEqual(5);
    expect(result.proposals.length).toBeLessThanOrEqual(6);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('rwgps-300');
    const bearings = result.proposals.map((p) => farBearing(p.adapted.coords));
    for (let i = 0; i < bearings.length; i++) for (let j = i + 1; j < bearings.length; j++) expect(circularGap(bearings[i], bearings[j])).toBeGreaterThanOrEqual(44);
    // Solo se descarga el track de las que se adaptan.
    expect(asked.filter((a) => a.kind === 'route').length).toBe(result.proposals.length);
    expect(result.proposals[0].route).toMatchObject({ sourceUrl: expect.stringMatching(/^https:\/\/ridewithgps\.com\/routes\/\d+$/), author: 'Autora sintética en Ride with GPS', catalog: { kind: 'rwgps' } });
    expect(keep.mock.calls[0][1]).toEqual({ start: START, mode: 'mi-inicio', targetKm: 60 });
  });

  it('si no llegan a 5 con 45°, relaja a 25° antes de rendirse', async () => {
    const fan: Fake[] = [0, 30, 60, 90, 120].map((deg, i) => ({ id: String(400 + i), km: 60, deg }));
    const { access } = fakeShared(() => fan);
    const result = await proposeRwgpsRoutes(target, { rwgps: access, ors: 'clave', adapt: keep as never });
    expect(result.proposals.map((p) => p.route.id).sort()).toEqual(['rwgps-400', 'rwgps-401', 'rwgps-402', 'rwgps-403', 'rwgps-404']);
  });

  it('usa las de reserva cuando una adaptación falla o la ruta ya no es pública', async () => {
    const { access } = fakeShared(() => eight(), (id) => (id === '101' ? json({ error: { code: 'not_visible' } }, 403) : null));
    let calls = 0;
    const adapt = vi.fn(async (points: { lat: number; lng: number }[], opts: unknown, deps: unknown) => {
      calls++;
      if (calls === 1) return { ...(await keep(points)), rejected: 'Demasiada carretera principal.' };
      if (calls === 2) throw new OrsError('no_route', 'Sin carretera.');
      return keep(points, opts as never, deps as never);
    });
    const result = await proposeRwgpsRoutes(target, { rwgps: access, ors: 'clave', adapt: adapt as never });
    expect(result.proposals.length).toBeGreaterThanOrEqual(5);
    expect(result.rejected.map((r) => r.motivo)).toEqual(expect.arrayContaining(['Demasiada carretera principal.', 'Sin carretera.', expect.stringMatching(/No es pública/)]));
  });

  it('espera por el límite por minuto de ORS y sigue', async () => {
    const { access } = fakeShared(() => eight());
    let hit = false;
    const adapt = vi.fn(async (points: { lat: number; lng: number }[]) => {
      if (!hit) { hit = true; throw new OrsError('rate_minute', 'límite'); }
      return keep(points);
    });
    const waits: number[] = [];
    const updates: RwgpsProposalUpdate['kind'][] = [];
    const result = await proposeRwgpsRoutes(target, { rwgps: access, ors: 'clave', adapt: adapt as never, wait: async (ms) => { waits.push(ms); }, onUpdate: (u) => updates.push(u.kind) });
    expect(waits).toEqual([60_000]);
    expect(result.proposals.length).toBeGreaterThanOrEqual(5);
    expect(updates).toEqual(expect.arrayContaining(['searching', 'trying', 'waiting', 'proposal']));
  });

  it('sin rutas en la colección alrededor lo dice tras probar hasta 30 km', async () => {
    const { asked, access } = fakeShared(() => []);
    const result = await proposeRwgpsRoutes(target, { rwgps: access, ors: 'clave', adapt: keep as never });
    expect(asked.map((a) => a.radiusKm)).toEqual([5, 15, 30]);
    expect(result).toMatchObject({ proposals: [], nearby: 0, candidates: 0 });
    expect(keep).not.toHaveBeenCalled();
  });

  it('un error de cuota de Ride with GPS para la búsqueda', async () => {
    const { access } = fakeShared(() => eight(), () => json({ error: { code: 'quota_exceeded' }, retryAfterS: 3600 }, 429));
    await expect(proposeRwgpsRoutes(target, { rwgps: access, ors: 'clave', adapt: keep as never })).rejects.toMatchObject({ fatal: true });
  });

  it('se puede parar: no adapta nada más', async () => {
    const { access } = fakeShared(() => eight());
    const controller = new AbortController();
    const adapt = vi.fn(async (points: { lat: number; lng: number }[]) => {
      controller.abort();
      return keep(points);
    });
    await expect(proposeRwgpsRoutes(target, { rwgps: access, ors: 'clave', adapt: adapt as never, signal: controller.signal })).rejects.toThrow();
    expect(adapt).toHaveBeenCalledTimes(1);
  });
});
