import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { App } from '../src/App';
import { AccountContext } from '../src/auth/AccountBoundary';
import { db } from '../src/db/db';
import { saveActivity } from '../src/db/repo';
import type { Coord3, LatLng, StoredActivity } from '../src/domain/types';
import { OrsError } from '../src/routes/ors';
import { generateRoutes, type GenerateResult, type GeneratedRoute } from '../src/routes/generator';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/settings/settings';
import { forgetRoutes } from '../src/ui/pages/Rutas';
import { fullText } from './helpers/text';

// ORS nunca se llama: la búsqueda se simula. El mapa de Leaflet se sustituye por un doble.
vi.mock('../src/routes/generator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/routes/generator')>()),
  generateRoutes: vi.fn(),
}));
vi.mock('../src/routes/history', () => ({ loadVisitedCells: vi.fn(async () => new Set<string>()) }));

// Puntos sintéticos y públicos: la Puerta del Sol como Casa y un punto cercano elegido «en el mapa».
const SOL: LatLng = { lat: 40.4168, lng: -3.7038 };
const PICKED: LatLng = { lat: 40.45, lng: -3.69 };

vi.mock('../src/ui/components/StartPointCanvas', () => ({
  StartPointCanvas: ({ onChange }: { onChange: (p: LatLng) => void }) => (
    <button type="button" onClick={() => onChange({ lat: 40.45, lng: -3.69 })}>
      Elegir un punto de prueba
    </button>
  ),
}));

const NOW = Date.parse('2026-11-06T12:00:00Z');
const DAY = 86_400_000;
const generate = generateRoutes as unknown as Mock<typeof generateRoutes>;

function ride(i: number, distanceM = 50_000, elevGainM = 800): StoredActivity {
  return {
    id: `r-${i}`,
    startTime: NOW - (i + 1) * 3 * DAY,
    sport: 'cycling',
    totals: { distanceM, movingTimeS: distanceM / 7, elapsedTimeS: distanceM / 6, elevGainM, avgSpeedMs: 7, maxSpeedMs: 15 },
    hasTrack: false,
    source: 'gpx',
    importedAt: NOW,
  };
}

async function seed({
  key = 'test-key',
  home = SOL as LatLng | null,
  rides = 5,
  rideKm = 50,
  usage = 16,
}: { key?: string; home?: LatLng | null; rides?: number; rideKm?: number; usage?: number } = {}) {
  await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), home, ors: { apiKey: key } });
  for (let i = 0; i < rides; i++) await saveActivity(ride(i, rideKm * 1000), []);
  if (usage > 0) await db.meta.put({ key: 'orsUsage', value: { count: usage, windowStart: NOW - 2 * 3600_000 } });
}

/** Lazo sintético alrededor de un centro desplazado `dy` km al norte de Sol. */
function coords(dyKm: number): Coord3[] {
  return Array.from({ length: 41 }, (_, i) => {
    const t = (i / 40) * Math.PI * 2;
    return [SOL.lng + (Math.sin(t) * 4) / 85, SOL.lat + (dyKm - Math.cos(t) * 4) / 111, 650 + 40 * Math.sin(t)];
  });
}

function route(i: number, over: Partial<GeneratedRoute> = {}): GeneratedRoute {
  return {
    id: `route-${i}`,
    seed: i,
    coords: coords(4 + i),
    distanceM: 62_400 + i * 1000,
    elevGainM: 849.6 + i * 10,
    unpavedM: 0,
    trackM: 0,
    mainRoadPct: 0,
    unknownSurfacePct: 0,
    steep: [{ fromM: 0, toM: 62_400, cls: 2 }],
    profile: Array.from({ length: 21 }, (_, k) => ({ dM: k * 3120, ele: 650 + 40 * Math.sin(k / 3) })),
    maxSteepCls: 2,
    newPct: 74,
    score: 0.9 - i / 10,
    difficulty: 'Media',
    estTimeS: 9000,
    ...over,
  };
}

function result(over: Partial<GenerateResult> = {}): GenerateResult {
  return { routes: [route(0), route(1), route(2)], rejected: [], requestsUsed: 8, stoppedBy: null, ...over };
}

function renderRutas() {
  window.location.hash = '#/rutas';
  return render(<App />);
}

async function generateButton() {
  return screen.findByRole('button', { name: /Generar 5 rutas/ });
}

describe('Rutas', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    generate.mockReset();
    forgetRoutes();
    await Promise.all([db.activities.clear(), db.tracks.clear(), db.settings.clear(), db.meta.clear(), db.referenceRoutes.clear()]);
    try {
      localStorage.clear();
    } catch {
      /* sin almacenamiento: da igual */
    }
  });
  afterEach(() => {
    vi.useRealTimers();
    window.location.hash = '';
  });

  it('asks for ors key when missing', async () => {
    await seed({ key: '' });
    renderRutas();
    expect(await screen.findByRole('heading', { name: 'Falta tu clave de rutas' })).toBeInTheDocument();
    expect(screen.getByText(/se calculan con OpenRouteService/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Ajustes' })).toHaveAttribute('href', '#/ajustes?abrir=claves');
    expect(screen.queryByRole('button', { name: /Generar 5 rutas/ })).not.toBeInTheDocument();
  });

  it('with the shared road service it does not ask for a key nor count this browser', async () => {
    await seed({ key: '', usage: 2000 });
    vi.stubEnv('VITE_SHARED_ORS_ENABLED', 'true');
    try {
      const quota = new OrsError('quota_day', 'Se ha llegado al límite diario del servicio común de rutas (150 consultas al día por persona).');
      generate.mockRejectedValue(quota);
      window.location.hash = '#/rutas';
      const account = { client: {} as SupabaseClient, user: { id: 'u1' } as User };
      render(<AccountContext.Provider value={account}><App /></AccountContext.Provider>);
      const btn = await generateButton();
      expect(screen.queryByRole('heading', { name: 'Falta tu clave de rutas' })).not.toBeInTheDocument();
      expect(screen.queryByText(/Consultas ORS hoy/)).not.toBeInTheDocument();
      await userEvent.click(btn);
      await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
      expect(generate.mock.calls[0][1].apiKey).toMatchObject({ kind: 'shared' });
      expect(await screen.findByText(/150 consultas al día por persona/)).toBeInTheDocument();
      expect(screen.queryByText(/Tu clave gratuita de OpenRouteService/)).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('explains how to get the ors key', async () => {
    await seed({ key: '' });
    renderRutas();
    await userEvent.click(await screen.findByRole('button', { name: 'Cómo conseguirla' }));
    const sheet = await screen.findByRole('dialog', { name: 'Tu clave de rutas' });
    expect(within(sheet).getByText(/openrouteservice\.org/)).toBeInTheDocument();
  });

  it('start defaults to Casa', async () => {
    await seed();
    renderRutas();
    const from = await screen.findByRole('group', { name: 'Sale de' });
    expect(within(from).getByRole('button', { name: 'Casa' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Tu punto guardado en Ajustes. La IA nunca lo ve.')).toBeInTheDocument();
    expect(await generateButton()).toBeEnabled();
  });

  it('asks to pick start when no home', async () => {
    await seed({ home: null });
    renderRutas();
    const from = await screen.findByRole('group', { name: 'Sale de' });
    expect(within(from).queryByRole('button', { name: 'Casa' })).not.toBeInTheDocument();
    // El dock dice qué falta en vez de quedarse apagado sin explicación.
    expect(screen.getByRole('button', { name: 'Elige el inicio en el mapa' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Generar 5 rutas/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Elegir un punto de prueba' }));
    expect(await generateButton()).toBeEnabled();
  });

  it('form defaults to reference plus 10 %', async () => {
    await seed({ rideKm: 50 });
    renderRutas();
    const km = await screen.findByRole('group', { name: 'Distancia' });
    expect(within(km).getByText('55')).toBeInTheDocument();
    expect(screen.getByText(fullText('Tu salida media: 50 km'))).toBeInTheDocument();
  });

  it('form validates range', async () => {
    await seed({ rideKm: 6 });
    renderRutas();
    const km = await screen.findByRole('group', { name: 'Distancia' });
    expect(within(km).getByText('10')).toBeInTheDocument();
    expect(within(km).getByRole('button', { name: 'Menos distancia' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Entre 10 y 200 km')).toBeInTheDocument();

    await userEvent.click(within(km).getByRole('button', { name: 'Más distancia' }));
    expect(within(km).getByText('15')).toBeInTheDocument();
    expect(screen.queryByText('Entre 10 y 200 km')).not.toBeInTheDocument();
  });

  it('choosing a difficulty sets the climbing', async () => {
    await seed();
    renderRutas();
    const level = await screen.findByRole('group', { name: 'Dificultad para ti' });
    expect(within(level).getByRole('button', { name: 'Media' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(level).getByRole('button', { name: 'Dura' }));
    const elev = screen.getByRole('group', { name: 'Desnivel' });
    expect(within(elev).getByText('1000')).toBeInTheDocument();
    expect(within(level).getByRole('button', { name: 'Dura' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('difficulty options carry their bars', async () => {
    await seed();
    renderRutas();
    const level = await screen.findByRole('group', { name: 'Dificultad para ti' });
    for (const name of ['Suave', 'Media', 'Dura']) {
      const bars = within(level).getByRole('button', { name }).querySelector('svg.bars');
      expect(bars).not.toBeNull();
      expect(bars).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('renders cards with figures and gpx button', async () => {
    await seed();
    generate.mockResolvedValue(result());
    renderRutas();
    await userEvent.click(await generateButton());

    const list = await screen.findByRole('list', { name: 'Rutas generadas' });
    const cards = within(list).getAllByRole('article');
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByText('La que mejor encaja')).toBeInTheDocument();
    expect(within(cards[0]).getByText(fullText('62,4 km'))).toBeInTheDocument();
    expect(within(cards[0]).getByText(fullText('850 m'))).toBeInTheDocument();
    expect(within(cards[0]).getByText('74 % carretera nueva')).toBeInTheDocument();
    expect(within(cards[0]).getByText('Media para ti')).toBeInTheDocument();
    expect(within(cards[0]).getByRole('heading', { name: /Vuelta por el norte/ })).toBeInTheDocument();
    expect(within(cards[0]).getByRole('button', { name: 'Exportar GPX' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '3 rutas para ti' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exportar GPX de Vuelta por el norte, ruta 1 de 3/ })).toBeInTheDocument();

    const [req, deps] = generate.mock.calls[0];
    expect(req).toMatchObject({ start: SOL, target: { distanceM: 55_000, elevGainM: 800, preferNew: true } });
    expect(deps.apiKey).toBe('test-key');
    expect(deps.reference?.avgDistanceM).toBe(50_000);

    // La petición queda resumida arriba y se cambia en una hoja.
    const recipe = screen.getByRole('button', { name: /Cambiar/ });
    expect(recipe).toHaveTextContent('Desde Casa, circular, carretera nueva');
    await userEvent.click(recipe);
    expect(await screen.findByRole('dialog', { name: 'Qué ruta quieres' })).toBeInTheDocument();
  });

  it('card without reference hides label', async () => {
    await seed({ rides: 0 });
    generate.mockResolvedValue(result({ routes: [route(0, { difficulty: null, estTimeS: null })] }));
    renderRutas();
    await userEvent.click(await generateButton());
    const card = await screen.findByRole('article');
    expect(within(card).queryByText(/para ti/)).not.toBeInTheDocument();
    expect(within(card).queryByText('A tu ritmo')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1 ruta' })).toBeInTheDocument();
  });

  it('shows why no route passed', async () => {
    await seed();
    const rejected = [
      ...[1, 2, 3, 4, 5].map((seed) => ({ seed, reason: 'sin asfaltar' as const })),
      ...[6, 7, 8].map((seed) => ({ seed, reason: 'carretera principal' as const })),
    ];
    generate.mockResolvedValue(result({ routes: [], rejected }));
    renderRutas();
    await userEvent.click(await generateButton());
    expect(
      await screen.findByText(
        'Ninguna candidata pasa el filtro de carretera: 5 sin asfaltar, 3 carretera principal. Prueba otra distancia u otro inicio.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Exportar GPX/ })).not.toBeInTheDocument();
  });

  it('shows ors error message', async () => {
    await seed();
    const msg = 'Has gastado las 2.000 consultas diarias de ORS. La cuota se renueva 24 h después de la primera consulta del día.';
    generate.mockRejectedValue(new OrsError('quota_day', msg));
    renderRutas();
    await userEvent.click(await generateButton());
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(msg)).toBeInTheDocument();
    expect(within(alert).getByRole('heading', { name: 'No se han podido generar las rutas' })).toBeInTheDocument();
  });

  it('retries after an error', async () => {
    await seed();
    generate.mockRejectedValueOnce(new OrsError('unreachable', 'ORS no responde.')).mockResolvedValueOnce(result());
    renderRutas();
    await userEvent.click(await generateButton());
    await userEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('list', { name: 'Rutas generadas' })).toBeInTheDocument();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('shows partial warning', async () => {
    await seed();
    const stop = new OrsError('rate_minute', 'Has pasado de 40 consultas por minuto en ORS. Espera un minuto y vuelve a probar.');
    generate.mockResolvedValue(result({ routes: [route(0), route(1)], stoppedBy: stop }));
    renderRutas();
    await userEvent.click(await generateButton());
    expect(await screen.findByRole('list', { name: 'Rutas generadas' })).toBeInTheDocument();
    expect(screen.getByText(/Has pasado de 40 consultas por minuto en ORS/)).toBeInTheDocument();
    expect(screen.getByText(/La búsqueda se ha cortado/)).toBeInTheDocument();
  });

  it('shows daily usage', async () => {
    await seed({ usage: 16 });
    renderRutas();
    expect(await screen.findByText('Consultas ORS hoy: 16 de 2000 (cuenta de este navegador)')).toBeInTheDocument();
  });

  it('daily quota spent disables generating and says when it comes back', async () => {
    await seed({ usage: 2000 });
    renderRutas();
    const btn = await screen.findByRole('button', { name: /Cuota agotada/ });
    expect(btn).toBeDisabled();
    // La ventana empezó a las 11:00 de Madrid: vuelve a las 11:00 del día siguiente, y lo dice.
    expect(btn).toHaveTextContent('Cuota agotada, vuelve mañana a las 11:00');
    expect(screen.getByText(/ha llegado al límite diario y se renueva mañana a las 11:00/)).toBeInTheDocument();
    expect(screen.getByText('Cuota agotada hasta mañana a las 11:00')).toBeInTheDocument();
  });

  it('save as home', async () => {
    await seed({ home: null });
    renderRutas();
    await userEvent.click(await screen.findByRole('button', { name: 'Elegir un punto de prueba' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar como Casa' }));
    await waitFor(async () => expect((await loadSettings()).home).toEqual(PICKED));
    // Ya hay Casa: la opción aparece y queda elegida.
    const from = screen.getByRole('group', { name: 'Sale de' });
    expect(within(from).getByRole('button', { name: 'Casa' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('first export explains how to take it to the iGPSPORT', async () => {
    const createObjectURL = vi.fn(() => 'blob:gpx');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await seed();
    generate.mockResolvedValue(result());
    renderRutas();
    await userEvent.click(await generateButton());
    await userEvent.click(await screen.findByRole('button', { name: /Exportar GPX de Vuelta por el norte, ruta 1 de 3/ }));

    const sheet = await screen.findByRole('dialog', { name: 'Llévala al iGPSPORT' });
    expect(within(sheet).getByText(/ruta-62km-850m\.gpx/)).toBeInTheDocument();
    expect(within(sheet).getByText(/«Vuelta por el norte»/)).toBeInTheDocument();
    expect(click).toHaveBeenCalledTimes(1);
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    const gpx = await blob.text();
    expect(gpx).toContain('<trkseg>');
    expect(gpx).toContain('<name>Vuelta por el norte</name>');
    click.mockRestore();
  });

  it('opens the route map with the full name and exports from it', async () => {
    const createObjectURL = vi.fn(() => 'blob:gpx');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await seed();
    generate.mockResolvedValue(result());
    renderRutas();
    await userEvent.click(await generateButton());
    const list = await screen.findByRole('list', { name: 'Rutas generadas' });
    const first = within(list).getAllByRole('article')[0];
    const name = within(first).getByRole('heading').getAttribute('title') ?? '';
    await userEvent.click(within(first).getByRole('button', { name: `Ver ${name} en el mapa` }));

    const sheet = await screen.findByRole('dialog', { name });
    expect(within(sheet).getByRole('heading', { name })).toHaveAttribute('dir', 'auto');
    expect(within(sheet).getByRole('region', { name: `Mapa de ${name}` })).toBeInTheDocument();
    expect(within(sheet).getByRole('img', { name: /^Perfil: 62,4 km/ })).toBeInTheDocument();
    expect(within(sheet).getByText('Perfil por pendiente')).toBeInTheDocument();

    await userEvent.click(within(sheet).getByRole('button', { name: 'Exportar GPX' }));
    expect(click).toHaveBeenCalledTimes(1);
    const gpx = await (createObjectURL.mock.calls[0] as unknown as [Blob])[0].text();
    expect(gpx).toContain(`<name>${name}</name>`);
    click.mockRestore();
  });

  it('saves the current route in the library to splice it', async () => {
    await seed();
    generate.mockResolvedValue(result());
    renderRutas();
    await userEvent.click(await generateButton());
    const save = await screen.findByRole('button', { name: 'Guardar «Vuelta por el norte» en la biblioteca' });
    await userEvent.click(save);
    await waitFor(async () => expect(await db.referenceRoutes.count()).toBe(1));
    const [saved] = await db.referenceRoutes.toArray();
    expect(saved).toMatchObject({ name: 'Vuelta por el norte', format: 'gpx', sourceFileName: 'ruta-62km-850m.gpx' });
    expect(saved.points).toHaveLength(41);
    // Pulsar otra vez no la duplica.
    await userEvent.click(save);
    expect(await screen.findByText('Ya está en la biblioteca')).toBeInTheDocument();
    expect(await db.referenceRoutes.count()).toBe(1);

    await userEvent.click(screen.getAllByRole('button', { name: 'Empalmar' })[0]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Empalmar dos rutas' })).toBeInTheDocument();
    expect(await screen.findAllByRole('option', { name: /Vuelta por el norte/ })).toHaveLength(2);
  });

  it('cancel goes back without routes', async () => {
    await seed();
    let finish: (r: GenerateResult) => void = () => {};
    generate.mockImplementation(() => new Promise<GenerateResult>((resolve) => (finish = resolve)));
    renderRutas();
    await userEvent.click(await generateButton());
    expect(await screen.findByRole('heading', { name: 'Generando rutas' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await generateButton()).toBeInTheDocument();
    await act(async () => finish(result()));
    expect(screen.queryByRole('list', { name: 'Rutas generadas' })).not.toBeInTheDocument();
  });

  it('keeps the link to Rutas con IA', async () => {
    await seed();
    renderRutas();
    const section = await screen.findByRole('region', { name: 'Rutas con IA' });
    const link = within(section).getByRole('link', { name: /Pregunta a la IA/ });
    expect(link).toHaveAttribute('href', '#/rutas/ia');
    // El flujo tiene cuatro preguntas y el resumen.
    expect(link).toHaveTextContent('Cuatro preguntas y te propone rutas explicadas');
  });

  it('shows a skeleton of the generator while it loads', async () => {
    await seed();
    renderRutas();
    // Se encuentra mientras carga; cuando llega el formulario, ya no está.
    await screen.findByText('Cargando el generador');
    expect(await generateButton()).toBeInTheDocument();
    expect(screen.queryByText('Cargando el generador')).not.toBeInTheDocument();
  });

  it('rides older than the reference window still count as imported', async () => {
    await seed({ rides: 0 });
    await saveActivity({ ...ride(0), startTime: NOW - 200 * DAY }, []);
    renderRutas();
    expect(await generateButton()).toBeInTheDocument();
    expect(screen.queryByText(/Importa tus salidas/)).not.toBeInTheDocument();
  });

  it('brings the location help into view when the location fails', async () => {
    await seed();
    const scrolled: Element[] = [];
    const geo = navigator.geolocation;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) => fail(null as never) },
    });
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      renderRutas();
      const from = await screen.findByRole('group', { name: 'Sale de' });
      await userEvent.click(within(from).getByRole('button', { name: 'Aquí' }));
      const again = await screen.findByRole('button', { name: 'Volver a intentarlo' });
      expect(screen.getByText(/No se ha podido leer tu ubicación/)).toBeInTheDocument();
      await waitFor(() => expect(scrolled).toContain(again));
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geo });
    }
  });
});
