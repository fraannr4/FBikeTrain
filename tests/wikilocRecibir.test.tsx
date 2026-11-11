import { act, render, screen } from '@testing-library/react';
import { App } from '../src/App';
import { FBT_READY } from '../src/bookmarklet/protocol';
import { db } from '../src/db/db';
import { loadNearby, loadReceivedTrack, type WikilocCard } from '../src/routes/wikilocNearby';
import { DEFAULT_SETTINGS, saveSettings } from '../src/settings/settings';

vi.mock('../src/ui/components/StartPointCanvas', () => ({ StartPointCanvas: () => <div>Mapa sintético</div> }));
vi.mock('../src/ui/components/RideMap', () => ({ RideMap: ({ label }: { label: string }) => <div>{label}</div> }));

// Mensajes sintéticos del marcador: nada real de Wikiloc.
const CARD: WikilocCard = {
  id: '1001', nombre: 'Vuelta sintética', km: 75, desnivelM: 900, dificultad: 'moderado', autor: 'Autor de prueba',
  url: 'https://es.wikiloc.com/rutas-ciclismo/vuelta-sintetica-1001',
};
const LIST = { v: 1, kind: 'list', rutas: [CARD] };
const GPX = '<gpx version="1.1"><trk><name>Vuelta sintética</name><trkseg><trkpt lat="41" lon="2.5"><ele>10</ele></trkpt><trkpt lat="41.01" lon="2.5"><ele>20</ele></trkpt></trkseg></trk></gpx>';
const TRACK = { v: 1, kind: 'track', id: '1001', url: CARD.url, nombre: 'Vuelta sintética', autor: null, gpx: GPX };

let opener: Window;
let post: ReturnType<typeof vi.spyOn>;

/** La pestaña de Wikiloc que abrió la app: una ventana real de jsdom, para que `event.source` sea una ventana. */
function withOpener() {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  opener = frame.contentWindow!;
  post = vi.spyOn(opener, 'postMessage').mockImplementation(() => {});
  Object.defineProperty(window, 'opener', { value: opener, configurable: true, writable: true });
}

function send(data: unknown, origin = 'https://es.wikiloc.com', source: Window = opener) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
  });
}

function renderReceive() {
  window.location.hash = '#/rutas/wikiloc/recibir';
  return render(<App />);
}

describe('Recibir de Wikiloc', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), home: { lat: 41, lng: 2.5 } });
  });
  afterEach(() => {
    Object.defineProperty(window, 'opener', { value: null, configurable: true, writable: true });
  });

  it('sin la pestaña de Wikiloc que la abre, explica de dónde se usa', async () => {
    Object.defineProperty(window, 'opener', { value: null, configurable: true, writable: true });
    renderReceive();
    expect(await screen.findByRole('heading', { name: 'Abre esta pantalla desde el marcador' })).toBeInTheDocument();
  });

  it('avisa a Wikiloc de que está lista, guarda la lista recibida y lleva a la lista', async () => {
    withOpener();
    renderReceive();
    await screen.findByRole('heading', { name: 'Esperando los datos del marcador' });
    expect(post).toHaveBeenCalledWith(FBT_READY, '*');
    send(LIST);
    expect(await screen.findByRole('heading', { name: '¿Qué quieres hacer hoy?' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/rutas/wikiloc');
    expect(await loadNearby()).toMatchObject({ state: 'ok', rutas: [CARD] });
  });

  it('ignora los mensajes de otros orígenes, de otras ventanas o de dominios parecidos', async () => {
    withOpener();
    renderReceive();
    await screen.findByRole('heading', { name: 'Esperando los datos del marcador' });
    send(LIST, 'https://wikiloc.com.evil.io');
    send(LIST, 'http://es.wikiloc.com');
    send(LIST, 'https://es.wikiloc.com', window);
    expect(screen.getByRole('heading', { name: 'Esperando los datos del marcador' })).toBeInTheDocument();
    expect(await loadNearby()).toEqual({ state: 'none' });
  });

  it('rechaza un mensaje que no cumple el esquema y no guarda nada', async () => {
    withOpener();
    renderReceive();
    await screen.findByRole('heading', { name: 'Esperando los datos del marcador' });
    send({ ...LIST, extra: '<img src=x onerror=alert(1)>' });
    expect(await screen.findByRole('heading', { name: 'Los datos recibidos no son válidos' })).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(await loadNearby()).toEqual({ state: 'none' });
  });

  it('guarda la ruta recibida y abre la adaptación', async () => {
    withOpener();
    renderReceive();
    await screen.findByRole('heading', { name: 'Esperando los datos del marcador' });
    send(TRACK);
    expect(await screen.findByRole('heading', { name: 'Adaptar ruta de Wikiloc', level: 1 })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/rutas/wikiloc/adaptar');
    expect(await loadReceivedTrack()).toMatchObject({ state: 'ok', track: TRACK });
  });
});
