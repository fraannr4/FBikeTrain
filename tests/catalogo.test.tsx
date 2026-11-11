import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import { App } from '../src/App';
import { db } from '../src/db/db';
import type { LatLng } from '../src/domain/types';
import { adaptRoute, type AdaptedRoute } from '../src/routes/adapt';
import { saveCatalogRoutes } from '../src/routes/library';
import { DEFAULT_SETTINGS, saveSettings } from '../src/settings/settings';

// ORS, Overpass y Open-Meteo nunca se llaman: la adaptación se simula. Leaflet se sustituye por un doble.
vi.mock('../src/routes/adapt', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/routes/adapt')>()), adaptRoute: vi.fn() }));
vi.mock('../src/ui/components/StartPointCanvas', () => ({ StartPointCanvas: () => <div>Mapa sintético</div> }));
vi.mock('../src/ui/components/RideMap', () => ({ RideMap: ({ label }: { label: string }) => <div>{label}</div> }));

const adapt = adaptRoute as unknown as Mock<typeof adaptRoute>;
const HOME: LatLng = { lat: 41, lng: 2.5 };
const DEG_LAT_M = 111_195;
// Rutas sintéticas en el mar, hacia el norte desde casa, separadas en longitud.
const line = (km: number, lng: number) => Array.from({ length: km * 10 + 1 }, (_, i) => ({ lat: 41 + (i * 100) / DEG_LAT_M, lng, ele: 10 + i }));
const adapted = (lng: number, km: number): AdaptedRoute => ({
  coords: line(km, lng), distanceM: km * 1000, elevGainM: 640, connectorM: 1_200, passesNearM: 300, rotated: false, warnings: [],
});

async function seed() {
  await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), home: HOME, ors: { apiKey: 'test-key' } });
  await saveCatalogRoutes([0, 1, 2, 3].map((i) => ({
    name: `Ruta sintética ${i}`, points: line(58 + i, 2.5 + i * 0.05), sourceUrl: `https://www.openstreetmap.org/relation/${i + 1}`,
    author: '© OpenStreetMap contributors', catalog: { kind: 'osm' as const, ref: `osm-relation-${i + 1}`, tipo: 'carretera' as const }, elevation: 'dem' as const,
  })));
}

describe('Rutas de tu catálogo', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    adapt.mockReset();
    adapt.mockImplementation(async (points) => adapted(points[0].lng, 60));
  });

  it('propone 3 rutas adaptadas desde casa con origen, desnivel estimado y acciones', async () => {
    await seed();
    window.location.hash = '#/rutas/catalogo';
    render(<App />);
    const user = userEvent.setup();
    expect(await screen.findByText(/4 rutas: 4 de OpenStreetMap, 0 a puertos, 0 de Ride with GPS y 0 tuyas./, undefined, { timeout: 5000 })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Distancia'), '60');
    await user.type(screen.getByLabelText('Desnivel (opcional)'), '600');
    await user.click(screen.getByRole('button', { name: 'Proponer 3 rutas' }));
    const cards = await screen.findAllByRole('article', undefined, { timeout: 5000 });
    expect(cards).toHaveLength(3);
    expect(adapt).toHaveBeenCalledTimes(3);
    expect(adapt.mock.calls[0][1]).toEqual({ start: HOME, mode: 'mi-inicio', targetKm: 60, targetGainM: 600 });
    const first = within(cards[0]);
    expect(first.getByRole('link', { name: /Ver en OpenStreetMap/ })).toHaveAttribute('href', 'https://www.openstreetmap.org/relation/3');
    expect(cards[0].textContent).toMatch(/Desnivel estimado\s*≈ 640 m/);
    expect(first.getByRole('button', { name: 'Enviar al iGPSPORT' })).toBeInTheDocument();
    await user.click(first.getByRole('button', { name: 'Guardar en la biblioteca' }));
    expect(await first.findByRole('button', { name: 'Guardada en la biblioteca' })).toBeDisabled();
    expect(await db.referenceRoutes.count()).toBe(5);
  });

  it('sin catálogo lo dice y ofrece cargar OpenStreetMap e importar', async () => {
    await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), home: HOME, ors: { apiKey: 'test-key' } });
    window.location.hash = '#/rutas/catalogo';
    render(<App />);
    expect(await screen.findByText(/Tu catálogo está vacío/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cargar rutas de OpenStreetMap' })).toBeInTheDocument();
    expect(screen.getByLabelText('Importar GPX, TCX o ZIP')).toHaveAttribute('multiple');
    expect(screen.queryByRole('button', { name: 'Proponer 3 rutas' })).toBeNull();
  });

  it('el GPX subido de Wikiloc se adapta al momento y se puede guardar', async () => {
    await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), home: HOME, ors: { apiKey: 'test-key' } });
    window.location.hash = '#/rutas/catalogo';
    render(<App />);
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
    expect(await screen.findByRole('heading', { level: 1, name: 'Rutas de tu catálogo' }, { timeout: 5000 })).toBeInTheDocument();
  });
});
