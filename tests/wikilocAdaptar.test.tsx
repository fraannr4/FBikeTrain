import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import { App } from '../src/App';
import { db } from '../src/db/db';
import type { LatLng } from '../src/domain/types';
import { adaptRoute, type AdaptedRoute } from '../src/routes/adapt';
import { OrsError } from '../src/routes/ors';
import { saveReceivedTrack, saveWikilocRequest, type WikilocTrackMessage } from '../src/routes/wikilocNearby';
import { DEFAULT_SETTINGS, saveSettings } from '../src/settings/settings';

// ORS nunca se llama: la adaptación se simula. El mapa de Leaflet se sustituye por un doble.
vi.mock('../src/routes/adapt', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/routes/adapt')>()), adaptRoute: vi.fn() }));
vi.mock('../src/ui/components/StartPointCanvas', () => ({ StartPointCanvas: () => <div>Mapa sintético</div> }));
vi.mock('../src/ui/components/RideMap', () => ({ RideMap: ({ label }: { label: string }) => <div>{label}</div> }));

const adapt = adaptRoute as unknown as Mock<typeof adaptRoute>;
const HOME: LatLng = { lat: 41, lng: 2.5 };
// Track sintético en el mar.
const GPX = '<gpx version="1.1"><trk><name>Vuelta sintética</name><trkseg><trkpt lat="41" lon="2.5"><ele>10</ele></trkpt><trkpt lat="41.01" lon="2.5"><ele>20</ele></trkpt><trkpt lat="41.01" lon="2.51"><ele>30</ele></trkpt></trkseg></trk></gpx>';
const TRACK: WikilocTrackMessage = {
  v: 1, kind: 'track', id: '1001', url: 'https://es.wikiloc.com/rutas-ciclismo/vuelta-sintetica-1001', nombre: 'Vuelta sintética', autor: 'Autor de prueba', gpx: GPX,
};
const COORDS = [{ lat: 41, lng: 2.5, ele: 10 }, { lat: 41.01, lng: 2.5, ele: 20 }, { lat: 41, lng: 2.5, ele: 10 }];
const adapted = (over: Partial<AdaptedRoute> = {}): AdaptedRoute => ({
  coords: COORDS, distanceM: 74_600, elevGainM: 1180, connectorM: 3_200, passesNearM: 240, rotated: true, warnings: ['Se recorta en el km 61 y se vuelve al inicio por carretera.'], ...over,
});

async function seed({ orsKey = 'test-key', track = true, request = true } = {}) {
  await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), home: HOME, ors: { apiKey: orsKey } });
  if (track) await saveReceivedTrack(TRACK);
  if (request) await saveWikilocRequest({ distanceKm: 75, elevGainM: 1200, start: HOME });
}

function renderAdapt() {
  window.location.hash = '#/rutas/wikiloc/adaptar';
  return render(<App />);
}

describe('Adaptar ruta de Wikiloc', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    adapt.mockReset();
    adapt.mockImplementation(async () => adapted());
  });

  it('adapta la ruta desde mi inicio a lo pedido y enseña mapa, cifras y avisos', async () => {
    await seed();
    renderAdapt();
    const figures = await screen.findByRole('region', { name: 'Ruta adaptada' }, { timeout: 5000 });
    expect(adapt).toHaveBeenCalledTimes(1);
    const [points, opts] = adapt.mock.calls[0];
    expect(points).toEqual([{ lat: 41, lng: 2.5, ele: 10 }, { lat: 41.01, lng: 2.5, ele: 20 }, { lat: 41.01, lng: 2.51, ele: 30 }]);
    expect(opts).toEqual({ start: HOME, mode: 'mi-inicio', targetKm: 75, targetGainM: 1200 });
    expect(within(figures).getByText('Mapa de la ruta adaptada')).toBeInTheDocument();
    const text = figures.textContent;
    expect(text).toMatch(/Distancia\s*75 km/);
    expect(text).toMatch(/Desnivel\s*1180 m/);
    expect(text).toMatch(/Conectores\s*3 km/);
    expect(text).toMatch(/Pasa a\s*240 m/);
    expect(text).toMatch(/Se recorta en el km 61/);
    expect(text).toMatch(/empezar y acabar en tu inicio/);
    expect(screen.getByRole('link', { name: /Ver en Wikiloc · Autor de prueba/ })).toHaveAttribute('href', TRACK.url);
  });

  it('cambia a «Desde el inicio de la ruta» y vuelve a adaptar', async () => {
    await seed();
    renderAdapt();
    await screen.findByRole('region', { name: 'Ruta adaptada' }, { timeout: 5000 });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Desde el inicio de la ruta' }));
    await vi.waitFor(() => expect(adapt).toHaveBeenCalledTimes(2));
    expect(adapt.mock.calls[1][1]).toMatchObject({ mode: 'inicio-ruta' });
    expect(screen.getByRole('button', { name: 'Desde el inicio de la ruta' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('guarda la ruta adaptada en la biblioteca con su autor y su enlace', async () => {
    await seed();
    renderAdapt();
    await screen.findByRole('region', { name: 'Ruta adaptada' }, { timeout: 5000 });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Guardar en la biblioteca' }));
    await vi.waitFor(async () => expect(await db.referenceRoutes.count()).toBe(1));
    const [saved] = await db.referenceRoutes.toArray();
    expect(saved).toMatchObject({ name: 'Vuelta sintética', author: 'Autor de prueba', sourceUrl: TRACK.url, points: COORDS });
  });

  it('«Enviar al iGPSPORT» descarga el GPX 1.1 en el ordenador', async () => {
    await seed();
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return 'blob:sintetico'; });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderAdapt();
    await screen.findByRole('region', { name: 'Ruta adaptada' }, { timeout: 5000 });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Enviar al iGPSPORT' }));
    expect(click).toHaveBeenCalled();
    const gpx = await blobs[0].text();
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain('<name>Vuelta sintética</name>');
    expect(gpx.match(/<trkpt /g)).toHaveLength(3);
    click.mockRestore();
  });

  it('una adaptación que no cumple no se presenta como buena: sin guardar ni enviar', async () => {
    await seed();
    adapt.mockImplementation(async () => adapted({ rejected: 'Repite 12 km en sentido contrario.' }));
    renderAdapt();
    expect(await screen.findByText(/No se puede usar esta adaptación/)).toBeInTheDocument();
    expect(screen.getByText(/Repite 12 km en sentido contrario\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar en la biblioteca' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar al iGPSPORT' })).not.toBeInTheDocument();
  });

  it('un error de ORS se dice con su mensaje y se puede reintentar', async () => {
    await seed();
    adapt.mockRejectedValueOnce(new OrsError('quota_day', 'Tu clave ha llegado al límite diario.'));
    renderAdapt();
    expect(await screen.findByText('Tu clave ha llegado al límite diario.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('region', { name: 'Ruta adaptada' }, { timeout: 5000 })).toBeInTheDocument();
  });

  it('sin ruta recibida, lo dice', async () => {
    await seed({ track: false });
    renderAdapt();
    expect(await screen.findByRole('heading', { name: 'No hay ninguna ruta recibida' })).toBeInTheDocument();
    expect(adapt).not.toHaveBeenCalled();
  });

  it('sin petición guardada, pide lo que quieres hacer hoy', async () => {
    await seed({ request: false });
    renderAdapt();
    expect(await screen.findByRole('heading', { name: 'Falta lo que quieres hacer hoy' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Rutas de Wikiloc cerca' })).toHaveAttribute('href', '#/rutas/wikiloc');
    expect(adapt).not.toHaveBeenCalled();
  });

  it('sin clave de rutas, lleva a Ajustes', async () => {
    await seed({ orsKey: '' });
    renderAdapt();
    expect(await screen.findByRole('heading', { name: 'Falta tu clave de rutas' })).toBeInTheDocument();
    expect(adapt).not.toHaveBeenCalled();
  });

  it('un GPX que no se puede leer se dice sin adaptar', async () => {
    await seed({ track: false });
    await saveReceivedTrack({ ...TRACK, gpx: '<gpx/>' });
    renderAdapt();
    expect(await screen.findByRole('heading', { name: 'El GPX recibido no se puede usar' })).toBeInTheDocument();
    expect(adapt).not.toHaveBeenCalled();
  });
});
