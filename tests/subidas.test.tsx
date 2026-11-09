import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { db } from '../src/db/db';
import { saveActivity } from '../src/db/repo';
import type { ClimbEffort, LatLng, StoredActivity, TrackPoint } from '../src/domain/types';
import { synthClimbTrack } from './helpers/synth';

// El análisis pendiente se simula: cada prueba elige su estado.
const analysis = vi.hoisted(() => ({
  state: { status: 'ready' } as { status: 'ready' } | { status: 'error' } | { status: 'running'; done: number; total: number },
}));
vi.mock('../src/ui/useAnalysis', () => ({ useAnalysis: () => analysis.state }));

// Viernes 6 de noviembre de 2026, 13:00 en Madrid.
const NOW = Date.parse('2026-11-06T12:00:00Z');

function ride(id: string, iso: string, name?: string, hasTrack = false): StoredActivity {
  return {
    id,
    startTime: Date.parse(iso),
    sport: 'cycling',
    name,
    totals: { distanceM: 40_000, movingTimeS: 6_000, elapsedTimeS: 6_500, elevGainM: 300, avgSpeedMs: 6.7, maxSpeedMs: 15 },
    hasTrack,
    source: 'gpx',
    importedAt: NOW,
  };
}

// Subida A: el track sintético sube del metro 1000 al 3000 al 5 % (índices 67 a 200, un punto cada 15 m).
const A = { start: { lat: 41.009, lng: 2.5 }, end: { lat: 41.027, lng: 2.5 } };
// Subida B: en otro sitio, 1,5 km al 6 %.
const B = { start: { lat: 41.3, lng: 2.7 }, end: { lat: 41.313, lng: 2.7 } };

function effort(
  activityId: string,
  iso: string,
  timeS: number,
  at: { start: LatLng; end: LatLng } = A,
  shape = { lengthM: 2000, gainM: 100, avgGradePct: 5 },
): ClimbEffort {
  return {
    id: `${activityId}_0`,
    activityId,
    activityStart: Date.parse(iso),
    startIdx: 67,
    endIdx: 200,
    start: at.start,
    end: at.end,
    startDistM: 1000,
    ...shape,
    timeS,
    avgSpeedMs: shape.lengthM / timeS,
    vamMh: shape.gainM / (timeS / 3600),
  };
}

const B_SHAPE = { lengthM: 1500, gainM: 90, avgGradePct: 6 };

// Tres pasadas por A: 10 min, 9 min (la mejor) y 11 min (la última). Una por B.
const rides = [
  ride('r1', '2026-01-04T08:00:00Z', 'Vuelta al pantano', true),
  ride('r2', '2026-03-01T08:00:00Z', 'Pantano otra vez'),
  ride('r3', '2026-10-25T08:00:00Z'),
  ride('r4', '2026-09-12T08:00:00Z', 'Por la costa'),
];
const efforts = [
  effort('r1', '2026-01-04T08:00:00Z', 600),
  effort('r2', '2026-03-01T08:00:00Z', 540),
  effort('r3', '2026-10-25T08:00:00Z', 660),
  effort('r4', '2026-09-12T08:00:00Z', 500, B, B_SHAPE),
];
// El nombre de la salida va aislado (FSI…PDI) para que las comillas aguanten un nombre en árabe.
const A_NAME = 'Subida del km 1 de «⁨Vuelta al pantano⁩»';

async function seed(acts: StoredActivity[], list: ClimbEffort[], tracks: Record<string, TrackPoint[]> = {}) {
  for (const a of acts) await saveActivity(a, tracks[a.id] ?? []);
  await db.climbEfforts.bulkPut(list);
}

const seedAll = () =>
  seed(rides, efforts, { r1: synthClimbTrack([{ lengthM: 1000, gradePct: 0 }, { lengthM: 2000, gradePct: 5 }, { lengthM: 1000, gradePct: 0 }]) });

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

describe('Subidas', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    analysis.state = { status: 'ready' };
    await Promise.all([db.activities.clear(), db.tracks.clear(), db.climbEfforts.clear(), db.routeSigs.clear()]);
  });
  afterEach(() => {
    vi.useRealTimers();
    window.location.hash = '';
  });

  it('lists climbs with pass count', async () => {
    await seedAll();
    renderAt('#/historial/subidas');
    const list = await screen.findByRole('region', { name: 'Las que repites' });
    const rows = within(list).getAllByRole('button', { name: /Subida del km/ });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent(A_NAME);
    expect(rows[0]).toHaveTextContent('2,0 km al 5,0 %');
    expect(rows[0]).toHaveTextContent('3 pasadas');
    expect(rows[0]).toHaveTextContent('VAM 667 m/h');
    expect(rows[0]).toHaveTextContent('9:00');
    expect(screen.getByText(/que repites, de 2\./)).toBeInTheDocument();

    // La de una sola pasada, tras su botón, con la fecha de la única vez.
    await userEvent.click(within(list).getByRole('button', { name: 'Ver la que has subido una vez' }));
    const once = within(list).getByRole('button', { name: /Por la costa/ });
    expect(once).toHaveTextContent('1,5 km al 6,0 %');
    expect(once).toHaveTextContent('Una pasada, el 12 de septiembre');
    expect(once).toHaveTextContent('8:20');
    // En ese orden: primero la que más repites.
    const all = within(list).getAllByRole('button', { name: /Subida del km/ });
    expect(all.indexOf(rows[0])).toBeLessThan(all.indexOf(once));
  });

  it('shows the last climb with its rank', async () => {
    await seedAll();
    renderAt('#/historial/subidas');
    const card = await screen.findByRole('article', { name: 'Tu última subida' });
    expect(card).toHaveTextContent(A_NAME);
    expect(card).toHaveTextContent('25 oct.');
    expect(card).toHaveTextContent('11:00');
    expect(card).toHaveTextContent('La más lenta de 3');
    expect(card).toHaveTextContent('a 2:00 de tu mejor, 9:00');
  });

  it('climb page shows all passes', async () => {
    await seedAll();
    renderAt('#/historial/subidas');
    const list = await screen.findByRole('region', { name: 'Las que repites' });
    await userEvent.click(within(list).getByRole('button', { name: new RegExp(A_NAME) }));
    const sheet = await screen.findByRole('dialog', { name: A_NAME });
    expect(sheet).toHaveTextContent('2,0 km al 5,0 %, 100 m de desnivel.');

    const passes = within(sheet).getByRole('region', { name: 'Pasadas' });
    const links = within(passes).getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveTextContent('Domingo 25 de octubre');
    expect(links[0]).toHaveTextContent('11:00');
    expect(links[0]).toHaveTextContent('10,9 km/h');
    expect(links[0]).toHaveTextContent('VAM 545 m/h');
    expect(links[2]).toHaveTextContent('Domingo 4 de enero');
    expect(within(passes).getAllByText('Tu mejor')).toHaveLength(1);
    expect(links[1]).toHaveTextContent('Tu mejor');

    expect(within(sheet).getByRole('img', { name: /^Tus 3 tiempos/ })).toBeInTheDocument();
    // Perfil suavizado del track: de unos 100 a unos 200 m, dos kilómetros cerca del 5 %.
    const profile = await within(sheet).findByRole('img', { name: /^Perfil de / });
    expect(profile).toHaveAccessibleName(/: 2,0 km de 1\d\d a 1\d\d m\. El kilómetro más duro es el [12], al [45],\d %\.$/);
    expect(within(sheet).getByText(/^cima/)).toHaveTextContent(/cima 1\d\d\s?m/);
  });

  it('back closes the sheet and keeps the list', async () => {
    await seedAll();
    renderAt('#/historial/subidas');
    const list = await screen.findByRole('region', { name: 'Las que repites' });
    await userEvent.click(within(list).getByRole('button', { name: new RegExp(A_NAME) }));
    await screen.findByRole('dialog', { name: A_NAME });
    expect(window.location.hash).toBe('#/historial/subidas/r1_0');

    act(() => window.history.back());
    await waitFor(() => expect(window.location.hash).toBe('#/historial/subidas'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 6000 });
    expect(screen.getByRole('region', { name: 'Las que repites' })).toBeInTheDocument();
  }, 30_000);

  it('closing a sheet opened from the list goes back to it', async () => {
    await seedAll();
    renderAt('#/historial/subidas');
    const list = await screen.findByRole('region', { name: 'Las que repites' });
    await userEvent.click(within(list).getByRole('button', { name: new RegExp(A_NAME) }));
    const sheet = await screen.findByRole('dialog', { name: A_NAME });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(window.location.hash).toBe('#/historial/subidas'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 6000 });
    // Volvió atrás en el historial: «adelante» abre otra vez la hoja.
    act(() => window.history.forward());
    expect(await screen.findByRole('dialog', { name: A_NAME }, { timeout: 6000 })).toBeInTheDocument();
  }, 30_000);

  it('says how many older passes the long list leaves out', async () => {
    const many = Array.from({ length: 205 }, (_, i) => ride(`m${i}`, new Date(Date.UTC(2020, 0, 1 + i * 7, 8)).toISOString(), 'Vuelta al pantano'));
    await seed(many, many.map((r, i) => effort(r.id, new Date(r.startTime).toISOString(), 600 + (i % 9) * 5)));
    renderAt('#/historial/subidas/m0_0');
    const sheet = await screen.findByRole('dialog', { name: A_NAME });
    const passes = within(sheet).getByRole('region', { name: 'Pasadas' });
    expect(within(passes).queryByText(/más antiguas/)).not.toBeInTheDocument();
    await userEvent.click(within(passes).getByRole('button', { name: 'Ver las 200 últimas, de 205' }));
    expect(within(passes).getAllByRole('link')).toHaveLength(200);
    expect(passes).toHaveTextContent('Faltan las 5 pasadas más antiguas: la gráfica «Todas, por meses» las resume.');
  }, 20_000);

  it('pass links to its ride', async () => {
    await seedAll();
    renderAt('#/historial/subidas/r1_0');
    const sheet = await screen.findByRole('dialog', { name: A_NAME });
    const links = within(within(sheet).getByRole('region', { name: 'Pasadas' })).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['#/historial/r3', '#/historial/r2', '#/historial/r1']);
  });

  it('unknown climb shows not found', async () => {
    await seedAll();
    renderAt('#/historial/subidas/nada');
    expect(await screen.findByText('No se encuentra la subida')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver todas las subidas' })).toHaveAttribute('href', '#/historial/subidas');
  });

  it('empty state', async () => {
    renderAt('#/historial/subidas');
    expect(await screen.findByText('Aún no hay subidas detectadas')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: /Importar salidas/ })).toHaveAttribute('href', '#/importar');
  });

  it('none repeated keeps the single ones at hand', async () => {
    await seed([rides[3]], [efforts[3]]);
    renderAt('#/historial/subidas');
    expect(await screen.findByText('Aún no repites ninguna subida')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver la que has subido una vez' })).toBeInTheDocument();
  });

  it('the climb chart tells mouse users how to explore it', async () => {
    await seedAll();
    renderAt('#/historial/subidas/r1_0');
    const sheet = await screen.findByRole('dialog', { name: A_NAME });
    // Una de las dos se oculta por CSS según el puntero: táctil o ratón.
    expect(within(sheet).getByText('Desliza el dedo por la gráfica')).toBeInTheDocument();
    expect(within(sheet).getByText('Pasa el ratón o usa las flechas')).toBeInTheDocument();
  });

  it('waits for analysis', async () => {
    analysis.state = { status: 'running', done: 3, total: 10 };
    await seedAll();
    renderAt('#/historial/subidas');
    expect(await screen.findByText('Analizando salidas: 3 de 10')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Las que repites' })).not.toBeInTheDocument();
  });
});

// 25 puertos de dos pasadas, cada uno en su sitio; el «Puerto i» tiene el i-ésimo más suave.
const MANY = 25;
function manyClimbs() {
  const acts: StoredActivity[] = [];
  const list: ClimbEffort[] = [];
  for (let i = 0; i < MANY; i++) {
    const at = { start: { lat: 40 + i * 0.1, lng: 2 }, end: { lat: 40.013 + i * 0.1, lng: 2 } };
    const grade = 3 + i * 0.2;
    const shape = { lengthM: 1500, gainM: Math.round(15 * grade), avgGradePct: grade };
    for (const [k, month] of [['a', 4], ['b', 6]] as const) {
      const iso = new Date(Date.UTC(2026, month, 1 + i, 8)).toISOString();
      acts.push(ride(`p${i}${k}`, iso, `Puerto ${i}`));
      list.push(effort(`p${i}${k}`, iso, 500 + i, at, shape));
    }
  }
  return { acts, list };
}
const portName = (i: number) => `Subida del km 1 de «⁨Puerto ${i}⁩»`;

describe('Subidas: la lista no pierde el sitio', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    analysis.state = { status: 'ready' };
    await Promise.all([db.activities.clear(), db.tracks.clear(), db.climbEfforts.clear(), db.routeSigs.clear()]);
    const { acts, list } = manyClimbs();
    await seed(acts, list);
  });
  afterEach(() => {
    vi.useRealTimers();
    window.location.hash = '';
  });

  const rowsOf = (list: HTMLElement) => within(list).getAllByRole('button', { name: /Subida del km/ });

  it('«Ver más» lleva el foco a la primera fila nueva', async () => {
    renderAt('#/historial/subidas');
    const list = await screen.findByRole('region', { name: 'Las que repites' });
    expect(rowsOf(list)).toHaveLength(20);
    await userEvent.click(within(list).getByRole('button', { name: /^Ver 5 más/ }));
    const rows = rowsOf(list);
    expect(rows).toHaveLength(MANY);
    await waitFor(() => expect(rows[20]).toHaveFocus());
  });

  it('cambiar el orden o cargar más filas no sube la página', async () => {
    renderAt('#/historial/subidas');
    const list = await screen.findByRole('region', { name: 'Las que repites' });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    await userEvent.click(within(list).getByRole('button', { name: 'Más duras' }));
    await userEvent.click(within(list).getByRole('button', { name: /^Ver 5 más/ }));
    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });

  it('el orden, la búsqueda y las filas cargadas viven en la dirección', async () => {
    renderAt('#/historial/subidas');
    const list = await screen.findByRole('region', { name: 'Las que repites' });
    await userEvent.click(within(list).getByRole('button', { name: 'Más duras' }));
    await userEvent.click(within(list).getByRole('button', { name: /^Ver 5 más/ }));
    expect(window.location.hash).toMatch(/orden=duras/);
    expect(window.location.hash).toMatch(/n=40/);
    await userEvent.type(within(list).getByLabelText('Buscar subida'), 'Puerto 1');
    expect(decodeURIComponent(window.location.hash)).toMatch(/q=Puerto\+1|q=Puerto 1/);
  });

  it('volver de una salida deja la lista como estaba y el foco en la fila abierta', async () => {
    renderAt('#/historial/subidas');
    let list = await screen.findByRole('region', { name: 'Las que repites' });
    await userEvent.click(within(list).getByRole('button', { name: 'Más duras' }));
    await userEvent.click(within(list).getByRole('button', { name: /^Ver 5 más/ }));
    // Más duras: del Puerto 24 al 0. La fila 22 es el Puerto 3.
    const row = rowsOf(list)[21];
    expect(row).toHaveTextContent(portName(3));
    await userEvent.click(row);
    const sheet = await screen.findByRole('dialog', { name: portName(3) });
    await userEvent.click(within(within(sheet).getByRole('region', { name: 'Pasadas' })).getAllByRole('link')[0]);
    await waitFor(() => expect(window.location.hash).toBe('#/historial/p3b'));

    act(() => window.history.back());
    expect(await screen.findByRole('dialog', { name: portName(3) }, { timeout: 6000 })).toBeInTheDocument();
    act(() => window.history.back());
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/historial\/subidas\?/));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 6000 });

    list = screen.getByRole('region', { name: 'Las que repites' });
    expect(within(list).getByRole('button', { name: 'Más duras' })).toHaveAttribute('aria-pressed', 'true');
    const rows = rowsOf(list);
    expect(rows).toHaveLength(MANY);
    expect(rows[21]).toHaveTextContent(portName(3));
    await waitFor(() => expect(rows[21]).toHaveFocus(), { timeout: 3000 });
  }, 30_000);
});
