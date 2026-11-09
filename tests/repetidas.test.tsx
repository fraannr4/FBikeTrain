import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { db } from '../src/db/db';
import { saveActivity } from '../src/db/repo';
import { ANALYSIS_VERSION } from '../src/analysis/analysis';
import type { RouteSigRow } from '../src/db/db';
import type { StoredActivity } from '../src/domain/types';

// El análisis pendiente se simula: cada prueba elige su estado.
const analysis = vi.hoisted(() => ({
  state: { status: 'ready' } as { status: 'ready' } | { status: 'error' } | { status: 'running'; done: number; total: number },
}));
vi.mock('../src/ui/useAnalysis', () => ({ useAnalysis: () => analysis.state }));

// Viernes 6 de noviembre de 2026, 13:00 en Madrid.
const NOW = Date.parse('2026-11-06T12:00:00Z');

function ride(id: string, iso: string, km: number, elevM: number, movingS: number, name?: string): StoredActivity {
  const distanceM = km * 1000;
  return {
    id,
    startTime: Date.parse(iso),
    sport: 'cycling',
    name,
    totals: {
      distanceM,
      movingTimeS: movingS,
      elapsedTimeS: movingS + 300,
      elevGainM: elevM,
      avgSpeedMs: distanceM / movingS,
      maxSpeedMs: 15,
    },
    hasTrack: true,
    source: 'gpx',
    importedAt: NOW,
  };
}

const cells = (p: string) => [1, 2, 3, 4, 5].map((i) => `${p}:${i}`);
const sig = (a: StoredActivity, p: string): RouteSigRow => ({
  activityId: a.id,
  activityStart: a.startTime,
  distanceM: a.totals.distanceM,
  cells: cells(p),
  analysisVersion: ANALYSIS_VERSION,
});

// Ruta A, 3 veces: la mejor es la de marzo (1 h 30) y la última, la de octubre (1 h 45).
const a1 = ride('r1', '2026-01-04T08:00:00Z', 40, 300, 6000, 'Vuelta al pantano');
const a2 = ride('r2', '2026-03-01T08:00:00Z', 40.4, 320, 5400, 'Pantano otra vez');
const a3 = ride('r3', '2026-10-25T08:00:00Z', 40.8, 310, 6300, 'Pantano en otoño');
// Ruta B, 2 veces y sin nombre: la última, ayer, es la mejor.
const b1 = ride('r4', '2026-09-12T08:00:00Z', 60, 900, 9000);
const b2 = ride('r5', '2026-11-05T08:00:00Z', 60, 900, 8800, '  ');
// Una salida que no se repite.
const solo = ride('r6', '2026-06-01T08:00:00Z', 90, 1500, 12_000, 'Una sola vez');

async function seed(list: [StoredActivity, string][]) {
  for (const [a] of list) await saveActivity(a, []);
  await db.routeSigs.bulkPut(list.map(([a, p]) => sig(a, p)));
}

const seedAll = () =>
  seed([
    [a1, 'a'],
    [a2, 'a'],
    [a3, 'a'],
    [b1, 'b'],
    [b2, 'b'],
    [solo, 'c'],
  ]);

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

describe('Repetidas', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    analysis.state = { status: 'ready' };
    await Promise.all([db.activities.clear(), db.tracks.clear(), db.climbEfforts.clear(), db.routeSigs.clear()]);
  });
  afterEach(() => {
    vi.useRealTimers();
    window.location.hash = '';
  });

  it('lists repeated routes', async () => {
    await seedAll();
    renderAt('#/historial/repetidas');
    const list = await screen.findByRole('region', { name: 'Tus rutas de siempre' });
    const cards = within(list).getAllByRole('button', { name: /Pantano|Ruta sin nombre/ });
    expect(cards).toHaveLength(2);

    // Primero la que más repites; el nombre es el de la salida más reciente; las cifras, del representante.
    const a = cards[0];
    expect(a).toHaveTextContent('Pantano en otoño');
    expect(a).toHaveTextContent('40,0 km, 300 m');
    expect(a).toHaveTextContent('3 veces · última, 25 oct.');
    expect(a).toHaveTextContent(/Mejor\s*1h30/);
    expect(a).toHaveTextContent(/Última\s*1h45/);
    expect(a).toHaveTextContent(/Tendencia\s*\+0,7 km\/h/);

    // Sin nombre: «Ruta sin nombre»; con dos vueltas aún no hay tendencia.
    const b = cards[1];
    expect(b).toHaveTextContent('Ruta sin nombre');
    expect(b).toHaveTextContent('60,0 km, 900 m');
    expect(b).toHaveTextContent('2 veces · última, ayer');
    expect(b).toHaveTextContent('Mejor tiempo en la última');
    expect(b).toHaveTextContent('Falta 1 vuelta');

    expect(screen.getByText(/que repites\. En 1 vas más rápido que antes\./)).toBeInTheDocument();
    expect(screen.queryByText('Una sola vez')).not.toBeInTheDocument();
  });

  it('shows the last repeated route with its rank', async () => {
    await seedAll();
    renderAt('#/historial/repetidas');
    const card = await screen.findByRole('article', { name: 'Tu última repetida' });
    expect(card).toHaveTextContent('Ruta sin nombre');
    expect(card).toHaveTextContent('Ayer');
    expect(card).toHaveTextContent('60,0 km, 900 m, a 24,5 km/h');
    expect(card).toHaveTextContent('2h27');
    expect(card).toHaveTextContent('Tu mejor tiempo');
  });

  it('route page lists all rides with best marked', async () => {
    await seedAll();
    renderAt('#/historial/repetidas');
    const list = await screen.findByRole('region', { name: 'Tus rutas de siempre' });
    await userEvent.click(within(list).getByRole('button', { name: /Pantano en otoño/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Pantano en otoño' });
    expect(sheet).toHaveTextContent('40,0 km, 300 m de desnivel. Tiempos en movimiento.');
    expect(sheet).toHaveTextContent(/Tiempo a batir\s*1h30/);

    const laps = within(sheet).getByRole('region', { name: 'Vueltas' });
    const links = within(laps).getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['#/historial/r3', '#/historial/r2', '#/historial/r1']);
    expect(links[0]).toHaveTextContent('Domingo 25 de octubre');
    expect(links[0]).toHaveTextContent('40,8 km, 310 m, a 23,3 km/h');
    expect(links[0]).toHaveTextContent('1h45');
    expect(links[2]).toHaveTextContent('Domingo 4 de enero');
    expect(within(laps).getAllByText('Tu mejor')).toHaveLength(1);
    expect(links[1]).toHaveTextContent('Tu mejor');
    expect(links[1]).toHaveTextContent('1h30');

    expect(within(sheet).getByRole('img', { name: /^Tus 3 tiempos en Pantano en otoño/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('img', { name: 'Forma de Pantano en otoño' })).toBeInTheDocument();
  });

  it('back closes the sheet and keeps the list', async () => {
    await seedAll();
    renderAt('#/historial/repetidas');
    const list = await screen.findByRole('region', { name: 'Tus rutas de siempre' });
    await userEvent.click(within(list).getByRole('button', { name: /Pantano en otoño/ }));
    await screen.findByRole('dialog', { name: 'Pantano en otoño' });
    expect(window.location.hash).toBe('#/historial/repetidas/r1');

    act(() => window.history.back());
    await waitFor(() => expect(window.location.hash).toBe('#/historial/repetidas'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 6000 });
    expect(screen.getByRole('region', { name: 'Tus rutas de siempre' })).toBeInTheDocument();
  }, 30_000);

  it('closing a sheet opened from the list goes back to it', async () => {
    await seedAll();
    renderAt('#/historial/repetidas');
    const list = await screen.findByRole('region', { name: 'Tus rutas de siempre' });
    await userEvent.click(within(list).getByRole('button', { name: /Pantano en otoño/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Pantano en otoño' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(window.location.hash).toBe('#/historial/repetidas'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 6000 });
    act(() => window.history.forward());
    expect(await screen.findByRole('dialog', { name: 'Pantano en otoño' }, { timeout: 6000 })).toBeInTheDocument();
  }, 30_000);

  it('opens a route from its address', async () => {
    await seedAll();
    renderAt('#/historial/repetidas/r1');
    expect(await screen.findByRole('dialog', { name: 'Pantano en otoño' })).toBeInTheDocument();
  });

  it('unknown route shows not found', async () => {
    await seedAll();
    renderAt('#/historial/repetidas/nada');
    expect(await screen.findByText('No se encuentra la ruta')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver todas las repetidas' })).toHaveAttribute('href', '#/historial/repetidas');
  });

  it('empty state', async () => {
    await seed([[solo, 'c']]);
    renderAt('#/historial/repetidas');
    expect(await screen.findByText('Aún no repites ninguna ruta')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: /Importar salidas/ })).toHaveAttribute('href', '#/importar');
  });

  it('waits for analysis', async () => {
    analysis.state = { status: 'running', done: 3, total: 10 };
    await seedAll();
    renderAt('#/historial/repetidas');
    expect(await screen.findByText('Analizando salidas: 3 de 10')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tus rutas de siempre' })).not.toBeInTheDocument();
  });
});
