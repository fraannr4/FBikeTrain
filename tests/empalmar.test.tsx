import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { db } from '../src/db/db';
import type { LatLng } from '../src/domain/types';
import { analyzeReferenceRoutePoints, type ReferenceRoute, type RoutePoint } from '../src/routes/library';
import { OrsError, type OrsFeature } from '../src/routes/ors';
import { DEFAULT_SETTINGS, saveSettings } from '../src/settings/settings';

// ORS nunca se llama: los conectores se simulan con rectas sintéticas en el mar (lat 41.0, lng 2.5).
const connectors = vi.fn<(from: LatLng, to: LatLng) => Promise<OrsFeature[]>>();
vi.mock('../src/routes/splice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/routes/splice')>()),
  orsConnectors: () => connectors,
}));

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

async function seed(key = 'test-key') {
  await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), ors: { apiKey: key } });
  await db.referenceRoutes.bulkPut([stored('a', 'Costa', line(0, 5000)), stored('b', 'Interior', line(7000, 12_000))]);
}
function renderPage() {
  window.location.hash = '#/rutas/empalmar';
  return render(<App />);
}
/** La biblioteca se lee aparte: hasta que llegan sus rutas, los desplegables están vacíos. */
async function loaded() {
  await screen.findAllByRole('option', { name: /Costa/ });
}
async function choose(user: ReturnType<typeof userEvent.setup>) {
  await loaded();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Primera ruta' }), 'a');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Segunda ruta' }), 'b');
}

describe('Empalmar dos rutas', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map(t => t.clear()));
    connectors.mockReset();
    connectors.mockImplementation(async (from, to) => [straight(from, to)]);
  });
  afterEach(() => { window.location.hash = ''; });

  it('calcula las opciones con conectores por carretera y recomienda por cifras sin IA', async () => {
    await seed();
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Empalmar dos rutas', level: 1 })).toBeInTheDocument();
    await choose(user);
    await user.click(screen.getByRole('button', { name: 'Calcular empalme' }));
    const list = await screen.findByRole('list', { name: 'Opciones de empalme' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards.length).toBeGreaterThan(0);
    expect(within(cards[0]).getByText('Recomendada')).toBeInTheDocument();
    expect(within(cards[0]).getByText(/La más corta sin vías principales/)).toBeInTheDocument();
    expect(within(cards[0]).getByText(/Primero «Costa», luego «Interior»/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Leyenda del mapa' })).toHaveTextContent(/Conector por carretera/);
    expect(connectors).toHaveBeenCalled();
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
    await screen.findByRole('list', { name: 'Opciones de empalme' });
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
    await user.selectOptions(screen.getByRole('combobox', { name: 'Primera ruta' }), 'a');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Segunda ruta' }), 'a');
    expect(screen.getByRole('button', { name: 'Calcular empalme' })).toBeDisabled();
  });

  it('sin clave ni servicio común manda a Ajustes', async () => {
    await seed('');
    renderPage();
    expect(await screen.findByRole('link', { name: 'Ir a Ajustes' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Calcular empalme' })).toBeDisabled());
  });

  it('con menos de dos rutas explica cómo guardar las generadas', async () => {
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
    expect(await screen.findByRole('link', { name: /Empalmar dos rutas/ })).toHaveAttribute('href', '#/rutas/empalmar');
  });
});
