import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Mock } from 'vitest';
import { App } from '../src/App';
import { AccountContext } from '../src/auth/AccountBoundary';
import { db } from '../src/db/db';
import type { LatLng } from '../src/domain/types';
import { adaptRoute, type AdaptedRoute } from '../src/routes/adapt';
import type { Proposal } from '../src/routes/catalog/recommend';
import { analyzeReferenceRoutePoints, routePointsToGpx, type ReferenceRoute } from '../src/routes/library';
import { proposeRwgpsRoutes } from '../src/routes/sources/rwgpsProposals';
import { DEFAULT_SETTINGS, saveSettings } from '../src/settings/settings';

// ORS y la función `rwgps` nunca se llaman: la búsqueda y la adaptación se simulan. Leaflet se sustituye por un doble.
vi.mock('../src/routes/adapt', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/routes/adapt')>()), adaptRoute: vi.fn() }));
vi.mock('../src/routes/sources/rwgpsProposals', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/routes/sources/rwgpsProposals')>()), proposeRwgpsRoutes: vi.fn() }));
vi.mock('../src/ui/components/StartPointCanvas', () => ({ StartPointCanvas: () => <div>Mapa sintético</div> }));
vi.mock('../src/ui/components/RideMap', () => ({ RideMap: ({ label }: { label: string }) => <div>{label}</div> }));

const adapt = adaptRoute as unknown as Mock<typeof adaptRoute>;
const propose = proposeRwgpsRoutes as unknown as Mock<typeof proposeRwgpsRoutes>;
const HOME: LatLng = { lat: 41, lng: 2.5 };
const DEG_LAT_M = 111_195;
// Rutas sintéticas en el mar, hacia el norte desde casa, separadas en longitud.
const line = (km: number, lng: number) => Array.from({ length: km * 10 + 1 }, (_, i) => ({ lat: 41 + (i * 100) / DEG_LAT_M, lng, ele: 10 + i }));
const adapted = (lng: number, km: number): AdaptedRoute => ({
  coords: line(km, lng), distanceM: km * 1000, elevGainM: 640, connectorM: 1_200, passesNearM: 300, rotated: false, warnings: [],
});
const account = { client: { auth: { getSession: async () => ({ data: { session: { access_token: 'sesion' } }, error: null }) } } as unknown as SupabaseClient, user: { id: 'u1' } as User };

function proposal(i: number): Proposal {
  const points = line(60, 2.5 + i * 0.05);
  const route: ReferenceRoute = {
    id: `rwgps-${100 + i}`, name: `Vuelta sintética ${i}`, format: 'gpx', sourceFileName: `rwgps-${100 + i}.gpx`, sourceUrl: `https://ridewithgps.com/routes/${100 + i}`,
    author: 'Autora sintética en Ride with GPS', originalXml: routePointsToGpx('x', points), originalPoints: points, points, summary: analyzeReferenceRoutePoints(points),
    catalog: { kind: 'rwgps', ref: `rwgps-${100 + i}`, tipo: 'carretera' }, createdAt: 0, updatedAt: 0,
  };
  return { route, adapted: adapted(2.5 + i * 0.05, 61 + i), motivo: `A ${i} km de lo pedido.` };
}

async function open(withAccount = true) {
  await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), home: HOME, ors: { apiKey: 'test-key' } });
  window.location.hash = '#/rutas/catalogo';
  render(withAccount ? <AccountContext.Provider value={account}><App /></AccountContext.Provider> : <App />);
}

describe('Rutas de Ride with GPS', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    adapt.mockReset();
    adapt.mockImplementation(async (points) => adapted(points[0].lng, 60));
    propose.mockReset();
  });

  it('solo propone al pulsar «Proponer rutas» y enseña 5 tarjetas con los km adaptados y el enlace de origen', async () => {
    propose.mockImplementation(async (_target, deps) => {
      const proposals = [0, 1, 2, 3, 4].map(proposal);
      deps.onUpdate?.({ kind: 'searching', radiusKm: 5 });
      return { proposals, rejected: [], nearby: 9, candidates: 9, radiusKm: 15 };
    });
    await open();
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { level: 1, name: 'Rutas de Ride with GPS' }, { timeout: 5000 })).toBeInTheDocument();
    const distance = await screen.findByLabelText('Distancia', undefined, { timeout: 5000 });
    // Lo retirado del catálogo antiguo no aparece.
    expect(screen.queryByRole('button', { name: /OpenStreetMap/ })).toBeNull();
    expect(screen.queryByLabelText('Importar GPX, TCX o ZIP')).toBeNull();
    expect(screen.queryByLabelText('Enlaces de rutas o colecciones')).toBeNull();
    expect(propose).not.toHaveBeenCalled();

    await user.type(distance, '60');
    await user.type(screen.getByLabelText('Desnivel (opcional)'), '600');
    await user.click(screen.getByRole('button', { name: 'Proponer rutas' }));
    const cards = await screen.findAllByRole('article', undefined, { timeout: 5000 });
    expect(cards).toHaveLength(5);
    expect(propose.mock.calls[0][0]).toEqual({ start: HOME, distanceKm: 60, elevGainM: 600 });
    const first = within(cards[0]);
    expect(first.getByRole('link', { name: /Ver en Ride with GPS/ })).toHaveAttribute('href', 'https://ridewithgps.com/routes/100');
    expect(cards[0].textContent).toContain('Autora sintética en Ride with GPS');
    expect(cards[0].textContent).toMatch(/Distancia\s*61 km/);
    expect(first.getByRole('button', { name: 'Enviar al iGPSPORT' })).toBeInTheDocument();
    await user.click(first.getByRole('button', { name: 'Guardar en la biblioteca' }));
    expect(await first.findByRole('button', { name: 'Guardada en la biblioteca' })).toBeDisabled();
  });

  it('sin rutas de la colección cerca lo explica', async () => {
    propose.mockResolvedValue({ proposals: [], rejected: [], nearby: 0, candidates: 0, radiusKm: 30 });
    await open();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Distancia', undefined, { timeout: 5000 }), '60');
    await user.click(screen.getByRole('button', { name: 'Proponer rutas' }));
    expect(await screen.findByText(/Aún no hay rutas de Ride with GPS a menos de 30 km/)).toBeInTheDocument();
  });

  it('sin sesión pide iniciarla y no ofrece proponer', async () => {
    await open(false);
    expect(await screen.findByText(/Inicia sesión para buscar rutas de Ride with GPS/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Proponer rutas' })).toBeNull();
  });

  it('el GPX subido de Wikiloc se adapta al momento y se puede guardar', async () => {
    await open();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Distancia', undefined, { timeout: 5000 }), '60');
    const gpx = '<gpx version="1.1"><metadata><link href="https://es.wikiloc.com/rutas-ciclismo/sintetica-1"/></metadata><trk><name>Vuelta de Wikiloc</name><trkseg><trkpt lat="41" lon="2.5"><ele>1</ele></trkpt><trkpt lat="41.01" lon="2.5"><ele>5</ele></trkpt></trkseg></trk></gpx>';
    await user.upload(screen.getByLabelText('Subir el GPX descargado'), new File([gpx], 'vuelta.gpx', { type: 'application/gpx+xml' }));
    const card = await screen.findByRole('article', undefined, { timeout: 5000 });
    expect(within(card).getByRole('heading', { name: 'Vuelta de Wikiloc' })).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /Ver en Wikiloc/ })).toBeInTheDocument();
    expect(adapt).toHaveBeenCalledTimes(1);
  });

  it('los enlaces antiguos de Wikiloc llevan al catálogo', async () => {
    await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), home: HOME });
    window.location.hash = '#/rutas/wikiloc/recibir';
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Rutas de Ride with GPS' }, { timeout: 5000 })).toBeInTheDocument();
  });
});
