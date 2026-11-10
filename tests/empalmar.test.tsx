import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { saveGoal } from '../src/calendar/calendarRepo';
import { db } from '../src/db/db';
import { saveActivity } from '../src/db/repo';
import type { LatLng, StoredActivity, TrackPoint } from '../src/domain/types';
import { analyzeReferenceRoutePoints, type ReferenceRoute, type RoutePoint } from '../src/routes/library';
import { OrsError, type OrsFeature } from '../src/routes/ors';
import { DEFAULT_SETTINGS, saveSettings } from '../src/settings/settings';

// ORS nunca se llama: los conectores se simulan con rectas sintéticas en el mar (lat 41.0, lng 2.5).
// `spliceRoutes` y `adviseSplice` son los reales, envueltos para ver con qué se llaman.
const { connectors, splice, advise } = vi.hoisted(() => ({
  connectors: vi.fn<(from: LatLng, to: LatLng) => Promise<OrsFeature[]>>(),
  splice: vi.fn<typeof import('../src/routes/splice').spliceRoutes>(),
  advise: vi.fn<typeof import('../src/ai/spliceAdvisor').adviseSplice>(),
}));
vi.mock('../src/routes/splice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/routes/splice')>();
  splice.mockImplementation(actual.spliceRoutes);
  return { ...actual, orsConnectors: () => connectors, spliceRoutes: splice };
});
vi.mock('../src/ai/spliceAdvisor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ai/spliceAdvisor')>();
  advise.mockImplementation(actual.adviseSplice);
  return { ...actual, adviseSplice: advise };
});

const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((41 * Math.PI) / 180);
const at = (x: number): RoutePoint => ({ lat: 41, lng: 2.5 + x / M_LNG, ele: 100 });
const line = (x0: number, x1: number) => Array.from({ length: Math.abs(x1 - x0) / 10 + 1 }, (_, i) => at(x0 + Math.sign(x1 - x0) * i * 10));
function straight(from: LatLng, to: LatLng): OrsFeature {
  const pts = line(Math.round((from.lng - 2.5) * M_LNG / 10) * 10, Math.round((to.lng - 2.5) * M_LNG / 10) * 10);
  const n = pts.length - 1; const d = n * 10;
  const one = (value: number) => ({ values: [[0, n, value]] as [number, number, number][], summary: [{ value, distance: d, amount: 100 }] });
  return {
    geometry: { type: 'LineString', coordinates: pts.map(p => [p.lng, p.lat, 100]) },
    properties: { summary: { distance: d, duration: d / 6 }, extras: { surface: one(3), waytypes: one(2), steepness: one(0), waycategory: one(0) } },
  } as OrsFeature;
}
function stored(id: string, name: string, points: RoutePoint[]): ReferenceRoute {
  return { id, name, format: 'gpx', sourceFileName: `${id}.gpx`, originalXml: '<gpx/>', originalPoints: points, points, summary: analyzeReferenceRoutePoints(points), createdAt: 1, updatedAt: 1 };
}
const RIDE_AT = Date.parse('2026-11-06T09:00:00+01:00');
function ride(id: string, name: string | undefined, hasTrack: boolean): StoredActivity {
  return { id, name, startTime: RIDE_AT, sport: 'cycling', totals: { distanceM: 5000, movingTimeS: 900, elapsedTimeS: 950, elevGainM: 40, avgSpeedMs: 5.5, maxSpeedMs: 12 }, hasTrack, source: 'gpx', importedAt: RIDE_AT };
}
/** Track de la salida: una recta de `x0` a `x1`, con GPS en todos los puntos. */
const track = (x0: number, x1: number): TrackPoint[] => line(x0, x1).map((p, i) => ({ t: i, ...p }));

async function seed(key = 'test-key') {
  await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), ors: { apiKey: key } });
  await db.referenceRoutes.bulkPut([stored('a', 'Costa', line(0, 5000)), stored('b', 'Interior', line(7000, 12_000))]);
}
function renderPage(query = '') {
  window.location.hash = `#/rutas/empalmar${query}`;
  return render(<App />);
}
/** La biblioteca se lee aparte: hasta que llegan sus rutas, los desplegables están vacíos. */
async function loaded() {
  await screen.findAllByRole('option', { name: /Costa/ });
}
const combo = (name: string) => screen.getByRole('combobox', { name });
async function choose(user: ReturnType<typeof userEvent.setup>, third?: string) {
  await loaded();
  await user.selectOptions(combo('Primera ruta'), 'lib:a');
  await user.selectOptions(combo('Segunda ruta'), 'lib:b');
  if (third) await user.selectOptions(combo('Tercera ruta (opcional)'), third);
}
const optionsList = () => screen.findByRole('list', { name: 'Opciones de empalme' });

describe('Empalmar rutas', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map(t => t.clear()));
    connectors.mockReset();
    connectors.mockImplementation(async (from, to) => [straight(from, to)]);
    splice.mockClear();
  });
  afterEach(() => { window.location.hash = ''; });

  it('calcula las opciones con conectores por carretera y recomienda por cifras sin IA', async () => {
    await seed();
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Empalmar rutas', level: 1 })).toBeInTheDocument();
    await choose(user);
    await user.click(screen.getByRole('button', { name: 'Calcular empalme' }));
    const list = await optionsList();
    const cards = within(list).getAllByRole('listitem');
    expect(cards.length).toBeGreaterThan(0);
    expect(within(cards[0]).getByText('Recomendada')).toBeInTheDocument();
    expect(within(cards[0]).getByText(/La más corta sin vías principales/)).toBeInTheDocument();
    expect(within(cards[0]).getByText(/Primero «Costa», luego «Interior»/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Leyenda del mapa' })).toHaveTextContent(/Conector por carretera/);
    expect(connectors).toHaveBeenCalled();
    expect(splice.mock.calls[0][0]).toHaveLength(2);
  });

  it('exporta el GPX 1.1 de la opción elegida', async () => {
    await seed();
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    const create = vi.fn((b: Blob) => { blobs.push(b); return 'blob:empalme'; });
    // jsdom no implementa createObjectURL ni revokeObjectURL.
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    renderPage();
    await choose(user);
    await user.click(screen.getByRole('button', { name: 'Calcular empalme' }));
    await optionsList();
    await user.click(screen.getByRole('button', { name: 'Exportar GPX' }));
    const gpx = await blobs[0].text();
    expect(gpx).toContain('version="1.1"');
    expect(gpx).toMatch(/<trk>[\s\S]*<trkseg>/);
    expect(gpx).toContain('<ele>');
  });

  it('con la cuota de ORS agotada lo explica', async () => {
    await seed();
    connectors.mockRejectedValue(new OrsError('quota_day', 'Has gastado las 2.000 consultas diarias de ORS.'));
    const user = userEvent.setup();
    renderPage();
    await choose(user);
    await user.click(screen.getByRole('button', { name: 'Calcular empalme' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('2.000 consultas diarias');
  });

  it('sin conector posible dice por qué y no deja exportar', async () => {
    await seed();
    connectors.mockRejectedValue(new OrsError('no_route', 'sin ruta'));
    const user = userEvent.setup();
    renderPage();
    await choose(user);
    await user.click(screen.getByRole('button', { name: 'Calcular empalme' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/sin carretera/);
    expect(screen.queryByRole('button', { name: 'Exportar GPX' })).not.toBeInTheDocument();
  });

  it('no deja empalmar una ruta consigo misma', async () => {
    await seed();
    const user = userEvent.setup();
    renderPage();
    await loaded();
    await user.selectOptions(combo('Primera ruta'), 'lib:a');
    await user.selectOptions(combo('Segunda ruta'), 'lib:a');
    expect(screen.getByRole('button', { name: 'Calcular empalme' })).toBeDisabled();
  });

  it('sin clave ni servicio común manda a Ajustes', async () => {
    await seed('');
    renderPage();
    expect(await screen.findByRole('link', { name: 'Ir a Ajustes' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Calcular empalme' })).toBeDisabled());
  });

  it('con menos de dos tramos explica cómo guardar las generadas', async () => {
    await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), ors: { apiKey: 'test-key' } });
    renderPage();
    const help = await screen.findByText(/Guardar en la biblioteca/);
    expect(within(help).getByRole('link', { name: 'Rutas' })).toHaveAttribute('href', '#/rutas');
    expect(within(help).getByRole('link', { name: 'Rutas con IA' })).toHaveAttribute('href', '#/rutas/ia');
  });

  it('la biblioteca enlaza con el empalme', async () => {
    await seed();
    window.location.hash = '#/rutas/biblioteca';
    render(<App />);
    expect(await screen.findByRole('link', { name: /Empalmar rutas/ })).toHaveAttribute('href', '#/rutas/empalmar');
  });
});

describe('Empalmar: tres tramos, salidas del historial y guardado', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map(t => t.clear()));
    connectors.mockReset();
    connectors.mockImplementation(async (from, to) => [straight(from, to)]);
    splice.mockClear();
    advise.mockClear();
  });
  afterEach(() => { window.location.hash = ''; });

  it('pasa a la IA el volumen que falta del periodo, sin el nombre del objetivo', async () => {
    // Viernes 6 de noviembre de 2026: el mes tiene 25 días por delante y la salida sembrada suma 5 km.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-06T12:00:00Z') });
    try {
      await seed();
      await saveActivity(ride('r1', 'Mañana por la costa', true), track(14_000, 18_000));
      await saveGoal({ kind: 'volume', id: 'v1', title: 'Noviembre en Mallorca', period: 'month', start: '2026-11-01', distanceM: 400_000, createdAt: 1 });
      const user = userEvent.setup();
      renderPage();
      await choose(user);
      await user.click(screen.getByRole('button', { name: 'Calcular empalme' }));
      await optionsList();
      expect(advise).toHaveBeenCalledTimes(1);
      expect(advise.mock.calls[0][1].objetivo).toEqual({ tipo: 'volumen', diasRestantes: 25, distanciaRestanteKm: 395, desnivelRestanteM: null });
      expect(JSON.stringify(advise.mock.calls[0][1])).not.toContain('Mallorca');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sin objetivos, la IA recibe null', async () => {
    await seed();
    const user = userEvent.setup();
    renderPage();
    await choose(user);
    await user.click(screen.getByRole('button', { name: 'Calcular empalme' }));
    await optionsList();
    expect(advise.mock.calls[0][1].objetivo).toBeNull();
  });

  it('el desplegable agrupa la biblioteca y las salidas con track, con nombre, fecha y km', async () => {
    await seed();
    await saveActivity(ride('r1', 'Mañana por la costa', true), track(14_000, 18_000));
    await saveActivity(ride('r2', 'Sin GPS', false), []);
    renderPage();
    await loaded();
    const first = combo('Primera ruta');
    const library = within(first).getByRole('group', { name: 'Biblioteca' });
    expect(within(library).getAllByRole('option').map(o => o.getAttribute('value')).sort()).toEqual(['lib:a', 'lib:b']);
    const rides = within(first).getByRole('group', { name: 'Salidas' });
    const options = within(rides).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveAttribute('value', 'act:r1');
    expect(options[0]).toHaveTextContent(/^Mañana por la costa · 6 nov( 2026)? · 5,0 km$/);
    expect(screen.queryByRole('option', { name: /Sin GPS/ })).not.toBeInTheDocument();
  });

  it('con una tercera ruta empalma tres tramos en el orden elegido', async () => {
    await seed();
    await db.referenceRoutes.put(stored('c', 'Sierra', line(14_000, 18_000)));
    const user = userEvent.setup();
    renderPage();
    await choose(user, 'lib:c');
    await user.click(screen.getByRole('button', { name: 'Calcular empalme' }));
    const list = await optionsList();
    expect(splice.mock.calls[0][0].map(i => i.name)).toEqual(['Costa', 'Interior', 'Sierra']);
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Primero «Costa», luego «Interior» y después «Sierra»');
    expect(screen.getByRole('list', { name: 'Leyenda del mapa' })).toHaveTextContent('«Costa», «Interior» y «Sierra»');
  });

  it('una salida del historial se empalma con los puntos GPS de su track', async () => {
    await seed();
    await saveActivity(ride('r1', 'Mañana por la costa', true), [{ t: 0 }, ...track(14_000, 18_000)]);
    const user = userEvent.setup();
    renderPage();
    await choose(user, 'act:r1');
    await user.click(screen.getByRole('button', { name: 'Calcular empalme' }));
    await optionsList();
    const inputs = splice.mock.calls[0][0];
    expect(inputs[2]).toMatchObject({ id: 'r1', name: 'Mañana por la costa' });
    expect(inputs[2].points).toHaveLength(401);
    expect(screen.getByRole('list', { name: 'Leyenda del mapa' })).toHaveTextContent('«Mañana por la costa»');
  });

  it('una salida sin track válido avisa y no llama a ORS', async () => {
    await seed();
    await saveActivity(ride('r1', 'Solo un punto', true), [{ t: 0, lat: 41, lng: 2.5 }, { t: 1 }]);
    const user = userEvent.setup();
    renderPage();
    await choose(user, 'act:r1');
    await user.click(screen.getByRole('button', { name: 'Calcular empalme' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esa salida no tiene un track válido para empalmar.');
    expect(connectors).not.toHaveBeenCalled();
    expect(splice).not.toHaveBeenCalled();
  });

  it('?primera=lib:<id> preselecciona la primera ruta', async () => {
    await seed();
    renderPage('?primera=lib:b');
    await loaded();
    expect(combo('Primera ruta')).toHaveValue('lib:b');
    expect(combo('Segunda ruta')).toHaveValue('');
  });

  it('guarda el empalme calculado en la biblioteca', async () => {
    await seed();
    const user = userEvent.setup();
    renderPage();
    await choose(user);
    await user.click(screen.getByRole('button', { name: 'Calcular empalme' }));
    await optionsList();
    await user.click(screen.getByRole('button', { name: 'Guardar en la biblioteca' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Guardada en la biblioteca.');
    const saved = (await db.referenceRoutes.toArray()).find(r => r.sourceFileName === 'empalme.gpx');
    expect(saved).toMatchObject({ name: 'Empalme Costa y Interior', format: 'gpx' });
    expect(saved!.summary.distanceM).toBeGreaterThan(11_000);
    expect(screen.getByRole('button', { name: 'Exportar GPX' })).toBeInTheDocument();
    // La misma opción no se guarda dos veces.
    expect(screen.getByRole('button', { name: 'Guardada en la biblioteca' })).toBeDisabled();
  });
});
