import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Mock } from 'vitest';
import { App } from '../src/App';
import { AccountContext } from '../src/auth/AccountBoundary';
import { db } from '../src/db/db';
import type { Coord3, LatLng } from '../src/domain/types';
import { adaptRoute, type AdaptedRoute } from '../src/routes/adapt';
import type { Proposal } from '../src/routes/catalog/recommend';
import type { GeneratedRoute } from '../src/routes/generator';
import { analyzeReferenceRoutePoints, routePointsToGpx, type ReferenceRoute } from '../src/routes/library';
import { proposeNearbyRoutes, type NearbyCard, type NearbyResult } from '../src/routes/nearby';
import { OrsError } from '../src/routes/ors';
import { DEFAULT_SETTINGS, saveSettings } from '../src/settings/settings';

// ORS, Ride with GPS, OSM y la IA nunca se llaman: la búsqueda se simula. Leaflet se sustituye por un doble.
vi.mock('../src/routes/adapt', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/routes/adapt')>()), adaptRoute: vi.fn() }));
vi.mock('../src/routes/nearby', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/routes/nearby')>()), proposeNearbyRoutes: vi.fn() }));
vi.mock('../src/ui/components/StartPointCanvas', () => ({ StartPointCanvas: () => <div>Mapa sintético</div> }));
vi.mock('../src/ui/components/RideMap', () => ({ RideMap: ({ label }: { label: string }) => <div>{label}</div> }));

const adapt = adaptRoute as unknown as Mock<typeof adaptRoute>;
const propose = proposeNearbyRoutes as unknown as Mock<typeof proposeNearbyRoutes>;
// Inicio sintético en el mar.
const HOME: LatLng = { lat: 41, lng: 2.5 };
const DEG_LAT_M = 111_195;
const line = (km: number, lng: number) => Array.from({ length: km * 10 + 1 }, (_, i) => ({ lat: 41 + (i * 100) / DEG_LAT_M, lng, ele: 10 + i }));
const adapted = (lng: number, km: number): AdaptedRoute => ({
  coords: line(km, lng), distanceM: km * 1000, elevGainM: 640, connectorM: 1_200, passesNearM: 300, rotated: false, warnings: [],
});
const account = { client: { auth: { getSession: async () => ({ data: { session: { access_token: 'sesion' } }, error: null }) } } as unknown as SupabaseClient, user: { id: 'u1' } as User };

function real(i: number): NearbyCard {
  const points = line(60, 2.5 + i * 0.05);
  const route: ReferenceRoute = {
    id: `rwgps-${100 + i}`, name: `Vuelta sintética ${i}`, format: 'gpx', sourceFileName: `rwgps-${100 + i}.gpx`, sourceUrl: `https://ridewithgps.com/routes/${100 + i}`,
    author: 'Autora sintética en Ride with GPS', originalXml: routePointsToGpx('x', points), originalPoints: points, points, summary: analyzeReferenceRoutePoints(points),
    catalog: { kind: 'rwgps', ref: `rwgps-${100 + i}`, tipo: 'carretera' }, createdAt: 0, updatedAt: 0,
  };
  const proposal: Proposal = { route, adapted: adapted(2.5 + i * 0.05, 61 + i), motivo: `A ${i} km de lo pedido.` };
  return { kind: 'real', source: 'rwgps', proposal };
}

/** Vuelta del motor: un rombo estrecho hacia el rumbo `deg` (0 norte, 90 este). */
function motor(deg: number, via: string[], combo: 'ia' | 'codigo' | 'vuelta', over: Partial<GeneratedRoute> = {}): NearbyCard {
  const a = (deg * Math.PI) / 180;
  const coords: Coord3[] = Array.from({ length: 101 }, (_, i) => {
    const t = i <= 50 ? i / 50 : (100 - i) / 50;
    const side = i <= 50 ? 0.02 : -0.02;
    const north = Math.cos(a) * t * 0.2 - Math.sin(a) * side * Math.sin(Math.PI * t);
    const east = Math.sin(a) * t * 0.2 + Math.cos(a) * side * Math.sin(Math.PI * t);
    return [HOME.lng + east, HOME.lat + north, 100 + 500 * t];
  });
  const route: GeneratedRoute = {
    id: `${deg}-60000`, seed: deg, coords, distanceM: 59_400, elevGainM: 720, unpavedM: 0, trackM: 0, mainRoadPct: 0, unknownSurfacePct: 0,
    motorway: false, steep: [], profile: coords.map(([, , ele], i) => ({ dM: i * 594, ele })), maxSteepCls: 0,
    newPct: 40, score: 0.8, difficulty: 'Media', estTimeS: 9_000, ...over,
  };
  return { kind: 'motor', route, via, combo };
}

const result = (cards: NearbyCard[], warnings: string[] = []): NearbyResult => ({ cards, warnings, requestsUsed: 6, usedAi: true });

async function open(withAccount = true, hash = '#/rutas/cerca') {
  await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), home: HOME, ors: { apiKey: 'test-key' } });
  window.location.hash = hash;
  render(withAccount ? <AccountContext.Provider value={account}><App /></AccountContext.Provider> : <App />);
}

async function ask(user: ReturnType<typeof userEvent.setup>, km = '60') {
  await user.type(await screen.findByLabelText('Distancia', undefined, { timeout: 5000 }), km);
  await user.click(screen.getByRole('button', { name: 'Proponer rutas' }));
}

describe('Rutas cerca', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    adapt.mockReset();
    adapt.mockImplementation(async (points) => adapted(points[0].lng, 60));
    propose.mockReset();
  });

  it('solo propone al pulsar «Proponer rutas»: las reales primero y después las del motor, cada una con su origen', async () => {
    propose.mockResolvedValue(result([
      real(0), real(1),
      motor(90, ['Coll sintètic', 'Poble sintètic amb un nom molt llarg'], 'ia'),
      motor(200, ['Turó sintètic'], 'codigo'),
      motor(290, [], 'vuelta', { difficulty: null, estTimeS: null }),
    ]));
    await open();
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { level: 1, name: 'Rutas cerca' }, { timeout: 5000 })).toBeInTheDocument();
    expect(propose).not.toHaveBeenCalled();

    await user.type(await screen.findByLabelText('Distancia'), '60');
    await user.type(screen.getByLabelText('Desnivel (opcional)'), '600');
    await user.click(screen.getByRole('button', { name: 'Proponer rutas' }));
    const cards = await screen.findAllByRole('article', undefined, { timeout: 5000 });
    expect(cards).toHaveLength(5);
    expect(propose.mock.calls[0][0]).toEqual({ start: HOME, distanceKm: 60, elevGainM: 600 });

    // Reales: «Ride with GPS · autora» y la tarjeta de siempre.
    for (const card of cards.slice(0, 2)) expect(card.textContent).toContain('Ride with GPS · Autora sintética');
    expect(within(cards[0]).getByRole('link', { name: /Ver en Ride with GPS/ })).toHaveAttribute('href', 'https://ridewithgps.com/routes/100');
    expect(within(cards[0]).getByRole('button', { name: 'Enviar al iGPSPORT' })).toBeInTheDocument();

    // Motor: origen, puntos de paso, marca de la IA, cifras, rumbo, dificultad y tiempo.
    const ia = within(cards[2]);
    expect(cards[2].textContent).toContain('Motor FBikeTrain');
    expect(ia.getByText('Combinada por la IA')).toBeInTheDocument();
    expect(ia.getByRole('heading', { level: 3 })).toHaveTextContent('Por Coll sintètic · Poble sintètic amb un nom molt llarg');
    expect(ia.getByRole('heading', { level: 3 })).toHaveAttribute('title', 'Por Coll sintètic · Poble sintètic amb un nom molt llarg');
    expect(cards[2].textContent).toMatch(/Distancia\s*59 km/);
    expect(cards[2].textContent).toMatch(/Desnivel\s*720 m/);
    expect(cards[2].textContent).toContain('Hacia el este');
    expect(cards[2].textContent).toContain('Media');
    expect(cards[2].textContent).toMatch(/2 h/);
    expect(ia.getByRole('button', { name: /Mapa/ })).toBeInTheDocument();
    expect(ia.getByRole('button', { name: 'Exportar GPX' })).toBeInTheDocument();
    expect(ia.getByRole('button', { name: 'Guardar en la biblioteca' })).toBeInTheDocument();

    expect(cards[3].textContent).toContain('Motor FBikeTrain');
    expect(within(cards[3]).queryByText('Combinada por la IA')).toBeNull();
    expect(cards[3].textContent).toContain('Hacia el sur');
    // La vuelta circular no pasa por puntos con nombre y, sin historial, no tiene dificultad ni tiempo.
    expect(within(cards[4]).getByRole('heading', { level: 3 })).toHaveTextContent('Vuelta circular');
    expect(cards[4].textContent).not.toMatch(/Dificultad|Tiempo/);
  });

  it('pasa a la búsqueda la IA común, los puntos de OSM y del historial', async () => {
    propose.mockResolvedValue(result([motor(0, ['Coll sintètic'], 'codigo')]));
    await open();
    await ask(userEvent.setup());
    await screen.findAllByRole('article', undefined, { timeout: 5000 });
    const deps = propose.mock.calls[0][1];
    expect(deps.ai).not.toBeNull();
    expect(deps.findWaypoints).toBeTypeOf('function');
    expect(deps.historyWaypoints).toBeTypeOf('function');
    expect(deps.rwgps).toBeDefined();
  });

  it('una vuelta del motor se abre en el mapa con su nombre completo y se guarda en la biblioteca', async () => {
    propose.mockResolvedValue(result([motor(0, ['Coll sintètic', 'Poble sintètic'], 'codigo')]));
    await open();
    const user = userEvent.setup();
    await ask(user);
    const card = await screen.findByRole('article', undefined, { timeout: 5000 });
    await user.click(within(card).getByRole('button', { name: /Mapa/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: 'Por Coll sintètic · Poble sintètic' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Cerrar el mapa' }));

    await user.click(within(card).getByRole('button', { name: 'Guardar en la biblioteca' }));
    expect(await within(card).findByRole('button', { name: 'Guardada en la biblioteca' })).toBeDisabled();
    expect(await db.table('referenceRoutes').count()).toBe(1);
  });

  it('enseña el progreso con la espera por el límite y «Cancelar» conserva las tarjetas ya aceptadas', async () => {
    let signal: AbortSignal | undefined;
    propose.mockImplementation((_target, deps) => {
      signal = deps.signal;
      deps.onUpdate?.({ kind: 'searching', radiusKm: 15 });
      deps.onUpdate?.({ kind: 'card', card: real(0) });
      deps.onUpdate?.({ kind: 'waypoints', count: 12 });
      deps.onUpdate?.({ kind: 'engine', tried: 4, accepted: 1, budget: 14 });
      deps.onUpdate?.({ kind: 'card', card: motor(90, ['Coll sintètic'], 'codigo') });
      deps.onUpdate?.({ kind: 'waiting', seconds: 60 });
      return new Promise((_resolve, reject) => deps.signal?.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError'))));
    });
    await open();
    const user = userEvent.setup();
    await ask(user);
    expect(await screen.findByText(/Esperando 60 s por el límite de consultas/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    expect(screen.queryByText(/Esperando/)).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Proponer rutas' })).toBeEnabled();
  });

  it('dice qué está haciendo en cada paso', async () => {
    let finish: (r: NearbyResult) => void = () => {};
    let update: Parameters<typeof proposeNearbyRoutes>[1]['onUpdate'];
    propose.mockImplementation((_target, deps) => {
      update = deps.onUpdate;
      return new Promise((resolve) => { finish = resolve; });
    });
    await open();
    const user = userEvent.setup();
    await ask(user);
    const status = await screen.findByRole('status', { name: 'Progreso de la búsqueda' }, { timeout: 5000 });
    const step = async (u: Parameters<NonNullable<typeof update>>[0], text: RegExp) => {
      update?.(u);
      expect(await within(status).findByText(text)).toBeInTheDocument();
    };
    await step({ kind: 'searching', radiusKm: 15 }, /Buscando rutas reales a 15 km/);
    await step({ kind: 'waypoints', count: 12 }, /12 puntos de paso/);
    await step({ kind: 'engine', tried: 4, accepted: 1, budget: 14 }, /Probando 4 de 14/);
    finish(result([motor(0, ['Coll sintètic'], 'codigo')]));
    expect(await screen.findByRole('article')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Progreso de la búsqueda' })).toBeNull();
  });

  it('reúne los avisos en una sola tarjeta informativa, sin tono de error', async () => {
    propose.mockResolvedValue(result([motor(0, ['Coll sintètic'], 'codigo')], [
      'No se han podido cargar los puertos, cimas y pueblos de la zona: se sigue con tu historial y con vueltas circulares.',
      'Solo 1 vuelta cumple 60 km ±10 % en direcciones distintas, de las 5 buscadas.',
    ]));
    await open();
    await ask(userEvent.setup());
    const notice = await screen.findByRole('region', { name: 'Avisos de la búsqueda' }, { timeout: 5000 });
    expect(notice.textContent).toContain('No se han podido cargar los puertos');
    expect(notice.textContent).toContain('Solo 1 vuelta cumple');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('un error que corta la búsqueda se dice como error y conserva lo aceptado', async () => {
    propose.mockImplementation(async (_target, deps) => {
      deps.onUpdate?.({ kind: 'card', card: real(0) });
      throw new OrsError('session', 'Tu sesión ha caducado. Vuelve a iniciar sesión para calcular rutas.');
    });
    await open();
    await ask(userEvent.setup());
    expect(await screen.findByRole('alert', undefined, { timeout: 5000 })).toHaveTextContent('Tu sesión ha caducado');
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('sin sesión pide iniciarla y no ofrece proponer', async () => {
    await open(false);
    expect(await screen.findByText(/Inicia sesión para buscar rutas cerca/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Proponer rutas' })).toBeNull();
  });

  it('Wikiloc va plegado debajo y el GPX subido se adapta al momento', async () => {
    await open();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Distancia', undefined, { timeout: 5000 }), '60');
    const fold = screen.getByText('¿Buscas en Wikiloc?');
    expect(fold.closest('details')).not.toHaveAttribute('open');
    await user.click(fold);
    expect(screen.getByRole('button', { name: /Buscar en Wikiloc/ })).toBeVisible();
    const gpx = '<gpx version="1.1"><metadata><link href="https://es.wikiloc.com/rutas-ciclismo/sintetica-1"/></metadata><trk><name>Vuelta de Wikiloc</name><trkseg><trkpt lat="41" lon="2.5"><ele>1</ele></trkpt><trkpt lat="41.01" lon="2.5"><ele>5</ele></trkpt></trkseg></trk></gpx>';
    await user.upload(screen.getByLabelText('Subir el GPX descargado'), new File([gpx], 'vuelta.gpx', { type: 'application/gpx+xml' }));
    const card = await screen.findByRole('article', undefined, { timeout: 5000 });
    expect(within(card).getByRole('heading', { name: 'Vuelta de Wikiloc' })).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /Ver en Wikiloc/ })).toBeInTheDocument();
    expect(adapt).toHaveBeenCalledTimes(1);
    expect(propose).not.toHaveBeenCalled();
  });

  it('Explore va plegado y se abre con km, desnivel y asfalto; la app no lo consulta', async () => {
    await open();
    const user = userEvent.setup();
    const win = vi.spyOn(window, 'open').mockReturnValue(null);
    await user.type(await screen.findByLabelText('Distancia', undefined, { timeout: 5000 }), '60');
    const fold = screen.getByText('¿Buscas en Ride with GPS Explore?');
    expect(fold.closest('details')).not.toHaveAttribute('open');
    await user.click(fold);
    expect(screen.getByRole('link', { name: /Pegar el enlace de una ruta/ })).toHaveAttribute('href', '#/rutas/compartida');
    await user.click(screen.getByRole('button', { name: /Abrir Explore con tus filtros/ }));
    expect(win).toHaveBeenCalledTimes(1);
    const url = String(win.mock.calls[0][0]);
    expect(url.startsWith('https://ridewithgps.com/explore?')).toBe(true);
    expect(url).toContain('length=54*66km');
    expect(url).toContain('s=paved');
    expect(propose).not.toHaveBeenCalled();
    win.mockRestore();
  });

  it.each(['#/rutas/catalogo', '#/rutas/wikiloc/recibir'])('el enlace antiguo %s lleva a Rutas cerca', async (hash) => {
    await open(true, hash);
    expect(await screen.findByRole('heading', { level: 1, name: 'Rutas cerca' }, { timeout: 5000 })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/rutas/cerca');
  });

  it('Rutas enlaza con Rutas cerca', async () => {
    await open(true, '#/rutas');
    const link = await screen.findByRole('link', { name: /Rutas cerca/ }, { timeout: 5000 });
    expect(link).toHaveAttribute('href', '#/rutas/cerca');
    expect(link.textContent).toContain('Al menos 5 vueltas de carretera desde donde salgas');
  });
});
