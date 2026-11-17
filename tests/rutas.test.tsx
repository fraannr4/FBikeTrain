import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Mock } from 'vitest';
import { App } from '../src/App';
// La carga del fragmento se cubre en lazyPage; aquí se comprueba la búsqueda ya montada.
import '../src/ui/pages/Rutas';
import { AccountContext } from '../src/auth/AccountBoundary';
import { db } from '../src/db/db';
import type { Coord3, LatLng } from '../src/domain/types';
import { adaptRoute, type AdaptedRoute } from '../src/routes/adapt';
import type { GeneratedRoute } from '../src/routes/generator';
import {
  generateProposals,
  type GeneratorCard,
  type GeneratorDeps,
  type GeneratorResult,
  type GeneratorUpdate,
} from '../src/routes/library/generate';
import type { LibraryRoute } from '../src/routes/library/schema';
import { OrsError } from '../src/routes/ors';
import { DEFAULT_SETTINGS, saveSettings } from '../src/settings/settings';

// ORS, la biblioteca común y Ride with GPS nunca se llaman: el generador se simula. Leaflet se sustituye por un doble.
vi.mock('../src/routes/adapt', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/routes/adapt')>()), adaptRoute: vi.fn() }));
vi.mock('../src/routes/library/generate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/routes/library/generate')>()),
  generateProposals: vi.fn(),
}));
vi.mock('../src/ui/components/StartPointCanvas', () => ({ StartPointCanvas: () => <div>Mapa sintético</div> }));
vi.mock('../src/ui/components/RideMap', () => ({ RideMap: ({ label }: { label: string }) => <div>{label}</div> }));

const adapt = adaptRoute as unknown as Mock<typeof adaptRoute>;
const generate = generateProposals as unknown as Mock<typeof generateProposals>;
// Inicio sintético en el mar.
const HOME: LatLng = { lat: 41, lng: 2.5 };
const DEG_LAT_M = 111_195;
const line = (km: number, lng: number) => Array.from({ length: km * 10 + 1 }, (_, i) => ({ lat: 41 + (i * 100) / DEG_LAT_M, lng, ele: 10 + i }));
const adapted = (lng: number, km: number): AdaptedRoute => ({
  coords: line(km, lng), distanceM: km * 1000, elevGainM: 640, connectorM: 1_200, passesNearM: 300, rotated: false, warnings: [], requestsUsed: 0,
});
const account = { client: { auth: { getSession: async () => ({ data: { session: { access_token: 'sesion' } }, error: null }) } } as unknown as SupabaseClient, user: { id: 'u1' } as User };

/** Ruta de la biblioteca común, ya adaptada al inicio. */
function biblioteca(i: number): GeneratorCard {
  const points = line(60, 2.5 + i * 0.05);
  const route: LibraryRoute = {
    id: `ref-${i}`, source: 'rwgps', url: `https://ridewithgps.com/routes/${100 + i}`, name: `Vuelta sintética ${i}`, author: 'Autora sintética',
    distanceM: 60_000, elevGainM: 600, loop: true, passM: 0, line: points.map((p) => [p.lng, p.lat, p.ele]),
  };
  return { kind: 'biblioteca', id: `biblioteca-ref-${i}`, route, adapted: adapted(2.5 + i * 0.05, 61) };
}

/** Vuelta nueva: un rombo estrecho hacia el rumbo `deg` (0 norte, 90 este). */
function nueva(deg: number, over: Partial<GeneratedRoute> = {}): GeneratorCard {
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
  return { kind: 'nueva', id: `nueva-${deg}`, route };
}

const result = (cards: GeneratorCard[], warnings: string[] = []): GeneratorResult => ({
  cards, warnings, requestsUsed: 6, zone: { routes: 12, cells: 3_400, factor: 1.75, fill: 'none' },
});

async function open(opts: { account?: boolean; hash?: string; key?: string } = {}) {
  await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), home: HOME, ors: { apiKey: opts.key ?? 'test-key' } });
  window.location.hash = opts.hash ?? '#/rutas';
  render(opts.account === false ? <App /> : <AccountContext.Provider value={account}><App /></AccountContext.Provider>);
}

async function ask(user: ReturnType<typeof userEvent.setup>, km = '60') {
  await user.type(await screen.findByLabelText('Distancia', undefined, { timeout: 5000 }), km);
  await user.click(screen.getByRole('button', { name: 'Proponer rutas' }));
}

/** Búsqueda que se queda abierta: devuelve con qué avanzarla y con qué terminarla. */
function pending() {
  const ctl: { update: (u: GeneratorUpdate) => void; finish: (r: GeneratorResult) => void; deps?: GeneratorDeps } = { update: () => {}, finish: () => {} };
  generate.mockImplementation((_target, deps) => {
    ctl.deps = deps;
    ctl.update = (u) => act(() => deps.onUpdate?.(u));
    return new Promise((resolve, reject) => {
      ctl.finish = resolve;
      deps.signal?.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')));
    });
  });
  return ctl;
}

describe('Rutas', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    adapt.mockReset();
    adapt.mockImplementation(async (points) => adapted(points[0].lng, 60));
    generate.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('no busca nada al abrir: solo al pulsar «Proponer rutas», con el inicio, los km y el desnivel', async () => {
    generate.mockResolvedValue(result([nueva(90)]));
    await open();
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { level: 1, name: 'Rutas' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/Te proponemos de 3 a 5 vueltas de carretera hechas con rutas reales de ciclistas de la zona/)).toBeInTheDocument();
    expect(generate).not.toHaveBeenCalled();

    await user.type(await screen.findByLabelText('Distancia'), '60');
    await user.type(screen.getByLabelText('Desnivel (opcional)'), '800');
    expect(generate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Proponer rutas' }));
    await screen.findByRole('article', undefined, { timeout: 5000 });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0]).toEqual({ start: HOME, distanceKm: 60, elevGainM: 800 });
    const deps = generate.mock.calls[0][1];
    expect(deps.library).toBeTypeOf('function');
    expect(deps.visited).toBeInstanceOf(Set);
  });

  it('enseña primero las de la biblioteca y después las nuevas, cada una con su origen', async () => {
    generate.mockResolvedValue(result([biblioteca(0), biblioteca(1), nueva(90), nueva(200, { difficulty: null, estTimeS: null })]));
    await open();
    await ask(userEvent.setup());
    const cards = await screen.findAllByRole('article', undefined, { timeout: 5000 });
    expect(cards).toHaveLength(4);

    for (const card of cards.slice(0, 2)) expect(card.textContent).toContain('De la biblioteca · Ride with GPS · Autora sintética');
    expect(within(cards[0]).getByRole('heading', { name: 'Vuelta sintética 0' })).toBeInTheDocument();
    expect(within(cards[0]).getByRole('link', { name: /Ver en Ride with GPS/ })).toHaveAttribute('href', 'https://ridewithgps.com/routes/100');
    expect(within(cards[0]).getByRole('button', { name: 'Enviar al iGPSPORT' })).toBeInTheDocument();

    const fresh = within(cards[2]);
    expect(fresh.getByText('Nueva')).toBeInTheDocument();
    expect(cards[2].textContent).not.toContain('De la biblioteca');
    const heading = fresh.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('Vuelta por el este');
    expect(heading).toHaveAttribute('title', 'Vuelta por el este');
    expect(fresh.getByText('Mapa de Vuelta por el este')).toBeInTheDocument();
    expect(cards[2].textContent).toMatch(/Distancia\s*59 km/);
    expect(cards[2].textContent).toMatch(/Desnivel\s*720 m/);
    expect(cards[2].textContent).toContain('Media');
    expect(cards[2].textContent).toMatch(/Tiempo a tu ritmo\s*2 h/);
    expect(fresh.getByRole('button', { name: 'Exportar GPX' })).toBeInTheDocument();
    expect(fresh.getByRole('button', { name: 'Guardar en la biblioteca' })).toBeInTheDocument();
    // Sin historial no hay dificultad ni tiempo a tu ritmo.
    expect(cards[3].textContent).not.toMatch(/Dificultad|Tiempo/);
  });

  it('una vuelta nueva se guarda en la biblioteca', async () => {
    generate.mockResolvedValue(result([nueva(0)]));
    await open();
    const user = userEvent.setup();
    await ask(user);
    const card = await screen.findByRole('article', undefined, { timeout: 5000 });
    await user.click(within(card).getByRole('button', { name: 'Guardar en la biblioteca' }));
    expect(await within(card).findByRole('button', { name: 'Guardada en la biblioteca' })).toBeDisabled();
    expect(await db.table('referenceRoutes').count()).toBe(1);
    // El aviso ya no lleva a Empalmar: abre la biblioteca.
    expect(screen.queryByRole('button', { name: 'Empalmar' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ver biblioteca' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Biblioteca de rutas' })).toBeInTheDocument();
  });

  it('dice qué está haciendo, mide las consultas y cuenta atrás la espera por el límite', async () => {
    const run = pending();
    await open();
    await ask(userEvent.setup());
    const status = await screen.findByRole('region', { name: 'Progreso de la búsqueda' }, { timeout: 5000 });
    const scene = status.querySelector('svg');
    expect(scene).not.toBeNull();
    expect(within(status).getByRole('status')).not.toHaveTextContent('transcurridos');
    const bar = within(status).getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuemax', '20');
    // Sin consultas todavía, la barra es indeterminada: no anuncia un valor.
    expect(bar).not.toHaveAttribute('aria-valuenow');

    run.update({ kind: 'library' });
    expect(within(status).getByText('Cargando las rutas de la zona…')).toBeInTheDocument();
    run.update({ kind: 'library-ready', routes: 12, cells: 3_400, fill: 'none' });
    expect(within(status).getByText('12 rutas y 3400 tramos en la zona. Montando vueltas…')).toBeInTheDocument();
    run.update({ kind: 'trying', used: 6, budget: 20 });
    expect(within(status).getByText('Probando 6 de 20…')).toBeInTheDocument();
    expect(bar).toHaveAttribute('aria-valuenow', '6');
    expect(bar).toHaveAttribute('aria-valuetext', '6 de 20 consultas consumidas');
    // Los mensajes reales avanzan sin desmontar la escena ni reiniciar el pedaleo.
    expect(status.querySelector('svg')).toBe(scene);
    run.update({ kind: 'card', card: nueva(90) });
    expect(screen.getAllByRole('article')).toHaveLength(1);

    run.update({ kind: 'waiting', seconds: 3 });
    expect(within(status).getByText('Esperando 3 s por el límite de consultas…')).toBeInTheDocument();
    expect(await within(status).findByText('Esperando 2 s por el límite de consultas…', undefined, { timeout: 2500 })).toBeInTheDocument();
    run.update({ kind: 'trying', used: 7, budget: 20 });
    expect(within(status).getByText('Probando 7 de 20…')).toBeInTheDocument();

    run.finish(result([nueva(90), nueva(200), nueva(300)]));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Progreso de la búsqueda' })).toBeNull());
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('pasados 8 s sin respuesta de la biblioteca, explica que la primera búsqueda de una zona tarda más', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const run = pending();
    await open();
    await ask(userEvent.setup({ advanceTimers: vi.advanceTimersByTime }));
    const status = await screen.findByRole('region', { name: 'Progreso de la búsqueda' }, { timeout: 5000 });
    run.update({ kind: 'library' });
    expect(within(status).queryByText(/la primera búsqueda tarda más/)).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(9_000);
    });
    expect(within(status).getByText(/\d+ s transcurridos/)).toBeInTheDocument();
    expect(within(status).getByText('Si la zona es nueva, la primera búsqueda tarda más: estamos buscando rutas en Ride with GPS.')).toBeInTheDocument();
    run.update({ kind: 'library-ready', routes: 12, cells: 3_400, fill: 'imported' });
    expect(within(status).queryByText(/la primera búsqueda tarda más/)).toBeNull();
  });

  it('«Cancelar» corta al momento y conserva las tarjetas ya aceptadas', async () => {
    const run = pending();
    await open();
    const user = userEvent.setup();
    await ask(user);
    await screen.findByRole('region', { name: 'Progreso de la búsqueda' }, { timeout: 5000 });
    run.update({ kind: 'card', card: biblioteca(0) });
    run.update({ kind: 'card', card: nueva(90) });
    run.update({ kind: 'waiting', seconds: 60 });

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(run.deps?.signal?.aborted).toBe(true);
    // La búsqueda se corta al momento; el recuadro tarda lo que dura su animación de salida.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull());
    expect(screen.queryByText(/Esperando/)).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Proponer rutas' })).toBeEnabled();
  });

  it('reúne los avisos en una sola tarjeta informativa, sin tono de error', async () => {
    generate.mockResolvedValue(result([], ['No hay rutas de referencia en esta zona todavía. Sin ellas no proponemos vueltas, porque saldrían de mala calidad.']));
    await open();
    await ask(userEvent.setup());
    const notice = await screen.findByRole('region', { name: 'Avisos de la búsqueda' }, { timeout: 5000 });
    expect(notice.textContent).toContain('No hay rutas de referencia en esta zona todavía');
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('un error que corta la búsqueda se dice como error y conserva lo aceptado', async () => {
    generate.mockImplementation(async (_target, deps) => {
      deps.onUpdate?.({ kind: 'card', card: biblioteca(0) });
      throw new OrsError('session', 'Tu sesión ha caducado. Vuelve a iniciar sesión para calcular rutas.');
    });
    await open();
    await ask(userEvent.setup());
    expect(await screen.findByRole('alert', undefined, { timeout: 5000 })).toHaveTextContent('Tu sesión ha caducado');
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('sin acceso a ORS explica cómo activarlo y no ofrece proponer', async () => {
    await open({ key: '' });
    expect(await screen.findByRole('heading', { name: 'Falta tu clave de rutas' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Ajustes' })).toHaveAttribute('href', '#/ajustes?abrir=claves');
    expect(screen.queryByRole('button', { name: 'Proponer rutas' })).toBeNull();
  });

  it('sin sesión pide iniciarla y no ofrece proponer', async () => {
    await open({ account: false });
    expect(await screen.findByText(/Inicia sesión para proponer rutas/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Proponer rutas' })).toBeNull();
  });

  it('enlaza con la biblioteca de rutas y con una ruta de Ride with GPS Explore', async () => {
    await open();
    expect(await screen.findByRole('link', { name: /Biblioteca de rutas/ }, { timeout: 5000 })).toHaveAttribute('href', '#/rutas/biblioteca');
    expect(screen.getByRole('link', { name: /Ruta de Ride with GPS Explore/ })).toHaveAttribute('href', '#/rutas/compartida');
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
    expect(generate).not.toHaveBeenCalled();
  });

  it('Explore va plegado y se abre con km, desnivel y asfalto; la app no lo consulta', async () => {
    await open();
    const user = userEvent.setup();
    const win = vi.spyOn(window, 'open').mockReturnValue(null);
    await user.type(await screen.findByLabelText('Distancia', undefined, { timeout: 5000 }), '60');
    const fold = screen.getByText('¿Buscas en Ride with GPS Explore?');
    expect(fold.closest('details')).not.toHaveAttribute('open');
    await user.click(fold);
    await user.click(screen.getByRole('button', { name: /Abrir Explore con tus filtros/ }));
    expect(win).toHaveBeenCalledTimes(1);
    const url = String(win.mock.calls[0][0]);
    expect(url.startsWith('https://ridewithgps.com/explore?')).toBe(true);
    expect(url).toContain('s=paved');
    expect(generate).not.toHaveBeenCalled();
    win.mockRestore();
  });

  it.each(['#/rutas/ia', '#/rutas/cerca', '#/rutas/empalmar', '#/rutas/catalogo', '#/rutas/wikiloc/recibir'])('el enlace antiguo %s lleva a Rutas', async (hash) => {
    await open({ hash });
    expect(await screen.findByRole('heading', { level: 1, name: 'Rutas' }, { timeout: 5000 })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/rutas');
  });
});
