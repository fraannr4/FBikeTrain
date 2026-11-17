import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { db } from '../src/db/db';
import { DEFAULT_SETTINGS, saveSettings } from '../src/settings/settings';
import { buildLibraryCatalog, toLibraryDetail } from '../src/routes/library/catalog';
import { BibliotecaRutas } from '../src/ui/pages/BibliotecaRutas';
import { squareRow } from './fixtures/libraryZone';
import { clearCatalogCache } from '../src/ui/library/CommonLibrary';
import { clearDetailCache } from '../src/ui/library/CatalogDetail';

vi.mock('../src/ui/components/RideMap', () => ({ RideMap: () => <div>Mapa sintético</div> }));
vi.mock('../src/ui/components/ElevationProfile', () => ({ ElevationProfile: () => <div>Perfil sintético</div> }));
vi.mock('../src/ui/components/StartPointCanvas', () => ({ StartPointCanvas: () => <div>Punto sintético</div> }));

const HOME = { lat: 40, lng: -3 };
const rows = [
  { ...squareRow(1, { km: 40, eastKm: 2, elevGainM: 300 }), name: 'Vuelta al pantano', author: 'Ana', line: [[-3, 40, 100], [-3.01, 40.01, 130], [-3.02, 40.02, 120]] as [number, number, number][] },
  { ...squareRow(2, { km: 90, eastKm: 4, elevGainM: 1900, loop: false }), name: 'Puerto largo', author: 'Luis', source: 'komoot' as const, url: 'https://www.komoot.com/tour/1' },
  { ...squareRow(3, { km: 60, eastKm: 6 }), name: 'N'.repeat(280), author: 'A'.repeat(150) },
];
const catalog = JSON.parse(JSON.stringify(buildLibraryCatalog({ lat: 40, lon: -3, radiusM: 100_000 }, rows)));

function account(invoke: ReturnType<typeof vi.fn>, anonymous = false) {
  return { client: { get functions() { return { invoke }; } } as unknown as SupabaseClient, user: { id: 'u1', is_anonymous: anonymous } as User };
}
function renderCommon(invoke: ReturnType<typeof vi.fn>, anonymous = false) {
  return render(<AccountContext.Provider value={account(invoke, anonymous)}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><BibliotecaRutas /></MemoryRouter></AccountContext.Provider>);
}
const respond = (kind: string) => kind === 'library-list' ? { data: { data: catalog }, error: null }
  : { data: { data: JSON.parse(JSON.stringify(toLibraryDetail(rows[0]))) }, error: null };
const okInvoke = () => vi.fn().mockImplementation(async (_name: string, o: { body: { kind: string } }) => respond(o.body.kind));

beforeEach(async () => {
  clearCatalogCache(); clearDetailCache();
  await db.referenceRoutes.clear();
  await saveSettings({ ...DEFAULT_SETTINGS, home: HOME });
});

describe('Biblioteca común', () => {
  it('sin rutas propias abre la biblioteca común y enseña cada ruta con su origen', async () => {
    renderCommon(okInvoke());
    const list = await screen.findByRole('list', { name: 'Rutas de la biblioteca común' });
    expect(within(list).getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('status', { name: '' })).toBeDefined();
    expect(screen.getByText('3 rutas')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Ride with GPS · Ana/ });
    expect(link).toHaveAttribute('href', rows[0].url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: 'Biblioteca común', pressed: true })).toBeInTheDocument();
  });

  it('pide al servidor solo el punto redondeado a 3 decimales y el radio', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, home: { lat: 40.123456, lng: -3.654321 } });
    const invoke = okInvoke();
    renderCommon(invoke);
    await screen.findByRole('list', { name: 'Rutas de la biblioteca común' });
    expect(invoke).toHaveBeenCalledWith('route-sources', expect.objectContaining({ body: { source: 'library', kind: 'library-list', lat: 40.123, lon: -3.654, radiusM: 100_000 } }));
  });

  it('con rutas propias abre Mis rutas', async () => {
    const { parseReferenceRoute } = await import('../src/routes/library');
    const parsed = parseReferenceRoute('<gpx><trk><name>Mi vuelta</name><trkseg><trkpt lat="41" lon="2.5"><ele>10</ele></trkpt><trkpt lat="41.001" lon="2.501"><ele>20</ele></trkpt></trkseg></trk></gpx>', 'mia.gpx');
    await db.referenceRoutes.put({ ...parsed, id: 'mia', createdAt: 0, updatedAt: 0 });
    renderCommon(okInvoke());
    expect(await screen.findByRole('button', { name: /Mi vuelta/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mis rutas', pressed: true })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Biblioteca común' }));
    expect(await screen.findByRole('list', { name: 'Rutas de la biblioteca común' })).toBeInTheDocument();
  });

  it('filtra por texto y por circulares, cuenta los resultados y explica cuando no hay ninguno', async () => {
    const user = userEvent.setup();
    renderCommon(okInvoke());
    await screen.findByRole('list', { name: 'Rutas de la biblioteca común' });
    await user.type(screen.getByRole('searchbox', { name: 'Buscar por nombre o autor' }), 'pantano');
    expect(screen.getByText('1 de 3 rutas')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Buscar por nombre o autor' }));
    await user.type(screen.getByRole('searchbox', { name: 'Buscar por nombre o autor' }), 'zzz');
    expect(screen.getByRole('heading', { name: 'Ninguna ruta cumple los filtros' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(screen.getByText('3 rutas')).toBeInTheDocument();
  });

  it('con los filtros en la hoja del móvil, el rango de distancia cambia el recuento', async () => {
    const user = userEvent.setup();
    renderCommon(okInvoke());
    await screen.findByRole('list', { name: 'Rutas de la biblioteca común' });
    await user.click(screen.getByRole('button', { name: 'Filtrar y ordenar' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filtrar y ordenar' });
    await user.type(within(sheet).getAllByRole('textbox', { name: 'Desde' })[0], '50');
    expect(await screen.findByText('2 de 3 rutas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filtrar y ordenar (1)' })).toBeInTheDocument();
  });

  it('nombres y autores larguísimos siguen en la tarjeta sin romper la lista', async () => {
    renderCommon(okInvoke());
    const button = await screen.findByRole('button', { name: 'N'.repeat(280) });
    expect(button).toBeInTheDocument();
  });

  it('abre el detalle con mapa, perfil, cifras, atribución y las acciones de guardar y descargar', async () => {
    const user = userEvent.setup();
    const invoke = okInvoke();
    renderCommon(invoke);
    await user.click(await screen.findByRole('button', { name: 'Vuelta al pantano' }));
    const dialog = await screen.findByRole('dialog', { name: 'Vuelta al pantano' });
    expect(await within(dialog).findByText('Mapa sintético')).toBeInTheDocument();
    expect(within(dialog).getByText('Perfil sintético')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Ride with GPS · Ana/ })).toHaveAttribute('href', rows[0].url);
    expect(invoke).toHaveBeenCalledWith('route-sources', expect.objectContaining({ body: { source: 'library', kind: 'library-route', id: rows[0].id } }));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar en Mis rutas' }));
    expect(await within(dialog).findByRole('button', { name: 'Ya está en Mis rutas' })).toBeDisabled();
    const saved = await db.referenceRoutes.toArray();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Vuelta al pantano', sourceUrl: rows[0].url });
    expect(saved[0].author).toContain('Ana');
    expect(within(dialog).getByRole('button', { name: 'Descargar GPX' })).toBeEnabled();
  });

  it('una ruta ya guardada aparece marcada y no se guarda dos veces', async () => {
    const user = userEvent.setup();
    renderCommon(okInvoke());
    await user.click(await screen.findByRole('button', { name: 'Vuelta al pantano' }));
    const dialog = await screen.findByRole('dialog', { name: 'Vuelta al pantano' });
    await user.click(await within(dialog).findByRole('button', { name: 'Guardar en Mis rutas' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    expect(await screen.findByText('En Mis rutas')).toBeInTheDocument();
  });

  it('con un error de red ofrece reintentar y recupera la lista', async () => {
    const user = userEvent.setup();
    const invoke = vi.fn().mockResolvedValueOnce({ data: null, error: new Error('red') }).mockImplementation(async (_n: string, o: { body: { kind: string } }) => respond(o.body.kind));
    renderCommon(invoke);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo leer la biblioteca común');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('list', { name: 'Rutas de la biblioteca común' })).toBeInTheDocument();
  });

  it('sin rutas en la zona lo dice y propone un radio mayor', async () => {
    const empty = vi.fn().mockResolvedValue({ data: { data: { total: 0, routes: [] } }, error: null });
    renderCommon(empty);
    expect(await screen.findByRole('heading', { name: 'Aún no hay rutas cerca' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar a 150 km' })).toBeInTheDocument();
  });

  it('sin punto de salida pide fijarlo en Rutas, sin llamar al servidor', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, home: null });
    const invoke = okInvoke();
    renderCommon(invoke);
    expect(await screen.findByRole('heading', { name: 'Elige tu punto de salida' })).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('sin cuenta registrada no consulta la biblioteca', async () => {
    const invoke = okInvoke();
    renderCommon(invoke, true);
    expect(await screen.findByRole('heading', { name: 'Entra con tu cuenta' })).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
});
