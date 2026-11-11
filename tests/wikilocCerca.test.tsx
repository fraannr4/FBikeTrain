import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import { App } from '../src/App';
import { chatJson } from '../src/ai/llm';
import { db } from '../src/db/db';
import { saveActivity } from '../src/db/repo';
import type { LatLng, StoredActivity } from '../src/domain/types';
import {
  NEARBY_TTL_MS, loadWikilocRequest, saveNearby, saveReceivedTrack, wikilocSearchUrl, type WikilocCard,
} from '../src/routes/wikilocNearby';
import { DEFAULT_SETTINGS, saveSettings } from '../src/settings/settings';

// La IA nunca se llama de verdad y el mapa de Leaflet se sustituye por un doble.
vi.mock('../src/ai/llm', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/ai/llm')>()), chatJson: vi.fn() }));
vi.mock('../src/ui/components/StartPointCanvas', () => ({ StartPointCanvas: () => <div>Mapa sintético</div> }));
vi.mock('../src/ui/components/RideMap', () => ({ RideMap: ({ label }: { label: string }) => <div>{label}</div> }));

// Datos sintéticos: Casa en el mar, rutas, autores y enlaces inventados.
const HOME: LatLng = { lat: 41, lng: 2.5 };
const NOW = Date.parse('2026-11-11T10:00:00Z');
const DAY = 86_400_000;
const chat = chatJson as unknown as Mock;
const card = (id: string, nombre: string, km: number, desnivelM: number | null = 900): WikilocCard => ({
  id, nombre, km, desnivelM, dificultad: 'moderado', autor: `Autor ${id}`, url: `https://es.wikiloc.com/rutas-ciclismo/sintetica-${id}`,
});
const CARDS = [
  card('1', 'Vuelta larga sintética', 110),
  card('2', 'Vuelta justa sintética', 76),
  card('3', 'Vuelta corta sintética', 30),
  card('4', 'Vuelta media sintética', 70),
  card('5', 'Vuelta algo larga sintética', 85),
];

function ride(i: number): StoredActivity {
  return {
    id: `r-${i}`, startTime: NOW - (i + 1) * 3 * DAY, sport: 'cycling',
    totals: { distanceM: 70_000, movingTimeS: 10_000, elapsedTimeS: 11_000, elevGainM: 800, avgSpeedMs: 7, maxSpeedMs: 15 },
    hasTrack: false, source: 'gpx', importedAt: NOW,
  };
}

async function seed({ llmKey = '', rides = 5 }: { llmKey?: string; rides?: number } = {}) {
  await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), home: HOME, ors: { apiKey: 'test-key' }, llm: { ...DEFAULT_SETTINGS.llm, apiKey: llmKey, model: 'openai/gpt-oss-20b' } });
  for (let i = 0; i < rides; i++) await saveActivity(ride(i), []);
}

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

async function typeDistance(km: string) {
  const user = userEvent.setup();
  const field = await screen.findByLabelText('Distancia');
  await user.clear(field);
  await user.type(field, km);
  return user;
}

describe('Rutas de Wikiloc cerca', () => {
  let open: Mock;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    await Promise.all(db.tables.map((t) => t.clear()));
    chat.mockReset();
    open = vi.fn(() => null);
    window.open = open as unknown as typeof window.open;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Rutas lleva a «Rutas de Wikiloc cerca»', async () => {
    await seed();
    renderAt('#/rutas');
    const link = await screen.findByRole('link', { name: /Rutas de Wikiloc cerca/ });
    expect(link).toHaveAttribute('href', '#/rutas/wikiloc');
  });

  it('sin lista, explica qué hacer; «Buscar en Wikiloc» abre el mapa alrededor de Casa y guarda la petición', async () => {
    await seed();
    renderAt('#/rutas/wikiloc');
    expect(await screen.findByRole('heading', { name: 'Aún no has traído rutas de Wikiloc' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Instalar el marcador' })).toHaveAttribute('href', '/wikiloc-marcador.html');
    const user = await typeDistance('75');
    await user.type(screen.getByLabelText('Desnivel (opcional)'), '1200');
    await user.click(screen.getByRole('button', { name: 'Buscar en Wikiloc' }));
    expect(open).toHaveBeenCalledWith(wikilocSearchUrl(HOME), '_blank', 'noopener,noreferrer');
    await vi.waitFor(async () => expect(await loadWikilocRequest()).toEqual({ distanceKm: 75, elevGainM: 1200, start: HOME }));
  });

  it('sin distancia, no abre Wikiloc y dice qué falta', async () => {
    await seed();
    renderAt('#/rutas/wikiloc');
    await screen.findByRole('heading', { name: 'Aún no has traído rutas de Wikiloc' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Buscar en Wikiloc' }));
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Distancia')).toHaveAccessibleDescription(/Escribe la distancia en km/);
  });

  it('ordena la lista recibida por lo pedido, con su etiqueta y su motivo, y explica los descartes', async () => {
    await seed();
    await saveNearby(CARDS, NOW - DAY);
    renderAt('#/rutas/wikiloc');
    await typeDistance('75');
    const list = await screen.findByRole('list', { name: 'Rutas que encajan' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => within(li).getByRole('heading').textContent)).toEqual([
      'Vuelta justa sintética', 'Vuelta media sintética', 'Vuelta algo larga sintética', 'Vuelta larga sintética',
    ]);
    expect((items[0]).textContent).toMatch(/Encaja: 76 km frente a 75 km pedidos\./);
    expect((items[3]).textContent).toMatch(/Se recorta de 110 km a 75 km\./);
    // Con salidas importadas, cada ruta lleva su dificultad para el usuario.
    expect((items[0]).textContent).toMatch(/Suave|Media|Dura/);
    expect((screen.getByText(/1 ruta descartada/).closest('details')!).textContent).toMatch(/Vuelta corta sintética.*Demasiado corta/);
  });

  it('«Adaptar esta ruta» abre su ficha de Wikiloc en otra pestaña y guarda la petición', async () => {
    await seed();
    await saveNearby(CARDS, NOW);
    renderAt('#/rutas/wikiloc');
    const user = await typeDistance('75');
    const list = await screen.findByRole('list', { name: 'Rutas que encajan' });
    await user.click(within(list).getAllByRole('button', { name: /Adaptar esta ruta/ })[0]);
    expect(open).toHaveBeenCalledWith('https://es.wikiloc.com/rutas-ciclismo/sintetica-2', '_blank', 'noopener,noreferrer');
    await vi.waitFor(async () => expect(await loadWikilocRequest()).toEqual({ distanceKm: 75, elevGainM: null, start: HOME }));
  });

  it('una lista de hace más de 7 días ha caducado', async () => {
    await seed();
    await saveNearby(CARDS, NOW - NEARBY_TTL_MS - DAY);
    renderAt('#/rutas/wikiloc');
    expect(await screen.findByRole('heading', { name: 'La lista de Wikiloc ha caducado' })).toBeInTheDocument();
  });

  it('enseña la ruta recibida pendiente de adaptar', async () => {
    await seed();
    await saveReceivedTrack({ v: 1, kind: 'track', id: '2', url: 'https://es.wikiloc.com/x-2', nombre: 'Vuelta justa sintética', autor: null, gpx: '<gpx/>' }, NOW);
    renderAt('#/rutas/wikiloc');
    expect(await screen.findByRole('link', { name: /Ruta recibida: «Vuelta justa sintética»/ })).toHaveAttribute('href', '#/rutas/wikiloc/adaptar');
  });

  it('la IA recomienda de 3 a 5 rutas con su motivo', async () => {
    await seed({ llmKey: 'test-key' });
    await saveNearby(CARDS, NOW);
    chat.mockResolvedValueOnce({
      opciones: [
        { titulo: 'A', dimension: 'distancia', subidaPct: 10, distanciaKm: 76, desnivelM: null, motivo: 'La que mejor encaja.', referenciaId: 'ref1' },
        { titulo: 'B', dimension: 'distancia', subidaPct: 10, distanciaKm: 85, desnivelM: null, motivo: 'Un poco más larga.', referenciaId: 'ref3' },
        { titulo: 'C', dimension: 'distancia', subidaPct: 10, distanciaKm: 70, desnivelM: null, motivo: 'Para ir más suave.', referenciaId: 'ref2' },
      ],
    });
    renderAt('#/rutas/wikiloc');
    const user = await typeDistance('75');
    await user.click(await screen.findByRole('button', { name: 'Pedir recomendación a la IA' }));
    const picks = await screen.findByRole('list', { name: 'Recomendadas por la IA' });
    const items = within(picks).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect((items[0]).textContent).toMatch(/Vuelta justa sintética.*La que mejor encaja\./);
    expect((items[1]).textContent).toMatch(/Vuelta algo larga sintética.*Un poco más larga\./);
    // Lo que sale hacia la IA: sin enlaces, autores ni coordenadas.
    const sent = JSON.stringify(chat.mock.calls[0][1].messages);
    expect(sent).not.toMatch(/wikiloc\.com|Autor \d|"lat"|"lng"/);
    expect(sent).not.toContain(String(HOME.lat));
  });

  it('sin IA configurada, lo dice y deja el orden local', async () => {
    await seed();
    await saveNearby(CARDS, NOW);
    renderAt('#/rutas/wikiloc');
    await typeDistance('75');
    expect(await screen.findByText(/Sin IA configurada/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pedir recomendación a la IA' })).not.toBeInTheDocument();
  });

  it('cambiar lo pedido borra una recomendación que ya no vale', async () => {
    await seed({ llmKey: 'test-key' });
    await saveNearby(CARDS, NOW);
    chat.mockResolvedValueOnce({ opciones: [
      { titulo: 'A', dimension: 'distancia', subidaPct: 10, distanciaKm: 76, desnivelM: null, motivo: 'Uno.', referenciaId: 'ref1' },
      { titulo: 'B', dimension: 'distancia', subidaPct: 10, distanciaKm: 76, desnivelM: null, motivo: 'Dos.', referenciaId: 'ref2' },
      { titulo: 'C', dimension: 'distancia', subidaPct: 10, distanciaKm: 76, desnivelM: null, motivo: 'Tres.', referenciaId: 'ref3' },
    ] });
    renderAt('#/rutas/wikiloc');
    const user = await typeDistance('75');
    await user.click(await screen.findByRole('button', { name: 'Pedir recomendación a la IA' }));
    await screen.findByRole('list', { name: 'Recomendadas por la IA' });
    await act(async () => { await user.type(screen.getByLabelText('Distancia'), '0'); });
    expect(screen.queryByRole('list', { name: 'Recomendadas por la IA' })).not.toBeInTheDocument();
  });
});
