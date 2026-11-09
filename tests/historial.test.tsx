import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { db } from '../src/db/db';
import { saveActivity } from '../src/db/repo';
import type { ActivityTotals, StoredActivity } from '../src/domain/types';

// Con la máquina cargada, montar la app la primera vez pasa de los 5 s por defecto.
vi.setConfig({ testTimeout: 15_000 });

// Con muchas salidas el render diferido de la búsqueda tarda: aquí se puede congelar para simularlo.
const deferred = vi.hoisted(() => ({ frozen: false }));
vi.mock('react', async (importOriginal) => {
  const React = await importOriginal<typeof import('react')>();
  function useDeferredValue<T>(value: T): T {
    const first = React.useRef(value);
    const live = React.useDeferredValue(value);
    return deferred.frozen ? first.current : live;
  }
  return { ...React, default: React, useDeferredValue };
});

// Viernes 6 de noviembre de 2026, 13:00 en Madrid.
const NOW = Date.parse('2026-11-06T12:00:00Z');
const DAY = 86_400_000;

function ride(iso: string, totals: Partial<ActivityTotals>, extra: Partial<StoredActivity> = {}): StoredActivity {
  const startTime = Date.parse(iso);
  const t = { distanceM: 0, movingTimeS: 0, elapsedTimeS: 0, elevGainM: 0, avgSpeedMs: 0, maxSpeedMs: 0, ...totals };
  if (!t.avgSpeedMs && t.movingTimeS) t.avgSpeedMs = t.distanceM / t.movingTimeS;
  return {
    id: `r-${startTime}`,
    startTime,
    sport: 'cycling',
    name: 'Salida',
    totals: t,
    hasTrack: true,
    source: 'fit',
    importedAt: NOW,
    ...extra,
  };
}

const moia = ride(
  '2026-11-05T08:00:00Z',
  { distanceM: 87_600, elevGainM: 1542, movingTimeS: 11_520 },
  { id: 'moia', name: 'Collsuspina y Moià' },
);
const bracons = ride(
  '2026-11-03T08:00:00Z',
  { distanceM: 72_100, elevGainM: 1180, movingTimeS: 10_560 },
  { id: 'bracons', name: 'Coll de Bracons' },
);
const plana = ride(
  '2026-10-29T08:00:00Z',
  { distanceM: 52_400, elevGainM: 380, movingTimeS: 6_960 },
  { id: 'plana', name: 'Rodaje por la Plana de Vic' },
);
const rupit = ride(
  '2026-10-20T08:00:00Z',
  { distanceM: 104_000, elevGainM: 1860, movingTimeS: 14_880 },
  { id: 'rupit', name: 'Rupit por el Collsacabra' },
);

async function seed(acts: StoredActivity[]) {
  for (const a of acts) await saveActivity(a, []);
}

function renderAt(hash = '#/historial') {
  window.location.hash = hash;
  return render(<App />);
}

/** Enlaces a una salida (no a las otras vistas del historial). */
function rideLinks(): HTMLElement[] {
  return screen
    .queryAllByRole('link')
    .filter((a) => /^#\/historial\/(?!subidas$|repetidas$)/.test(a.getAttribute('href') ?? ''));
}

async function waitRides(n: number) {
  await screen.findAllByText(/km/, undefined, { timeout: 5000 });
  await vi.waitFor(() => expect(rideLinks()).toHaveLength(n), { timeout: 5000 });
}

async function openFilters() {
  await userEvent.click(screen.getByRole('button', { name: /^Filtrar y ordenar/ }));
  return screen.findByRole('dialog', { name: 'Filtrar y ordenar' });
}

describe('Historial', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    if (!db.isOpen()) await db.open(); // la prueba de error lo cierra
    await Promise.all([db.activities.clear(), db.tracks.clear(), db.routeSigs.clear(), db.meta.clear()]);
  });
  afterEach(() => {
    vi.useRealTimers();
    deferred.frozen = false;
    window.location.hash = '';
  });

  it('sidebar links to historial', () => {
    renderAt('#/');
    const nav = screen.getByRole('navigation', { name: 'Menú principal' });
    expect(within(nav).getByRole('link', { name: 'Historial' })).toHaveAttribute('href', '#/historial');
  });

  it('lists rides newest first', async () => {
    await seed([plana, moia, bracons]);
    renderAt();
    await waitRides(3);
    const links = rideLinks();
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#/historial/moia', '#/historial/bracons', '#/historial/plana']);
    const first = links[0];
    expect(first).toHaveTextContent('Collsuspina y Moià');
    expect(first).toHaveTextContent('Ayer');
    expect(first).toHaveTextContent('jue 5 nov 2026');
    expect(first).toHaveTextContent(/87,6\s?km/);
    expect(first).toHaveTextContent('1542 m');
    expect(first).toHaveTextContent('3 h 12');
    expect(links[1]).toHaveTextContent('Martes 3');
  });

  it('groups rides by month with the month figures and a strip of days', async () => {
    await seed([plana, moia, bracons]);
    renderAt();
    const nov = await screen.findByRole('region', { name: 'Noviembre hasta hoy' });
    expect(nov).toHaveTextContent(/159,7\s?km/);
    expect(nov).toHaveTextContent(/2722\s?m/);
    expect(nov).toHaveTextContent(/6\s?h\s?08/);
    expect(nov).toHaveTextContent(/2\s?salidas/);
    expect(
      within(nov).getByRole('img', {
        name: 'Salidas por día de noviembre: 2 salidas; la más larga, el jueves 5 con 87,6 km.',
      }),
    ).toBeInTheDocument();
    const oct = screen.getByRole('region', { name: 'Octubre' });
    expect(oct).toHaveTextContent(/52,4\s?km/);
    expect(within(oct).getAllByRole('link')).toHaveLength(1);
  });

  it('compares the month with your monthly average', async () => {
    const past = ['2026-08-01', '2026-09-01', '2026-10-01'].map((d, i) =>
      ride(`${d}T08:00:00Z`, { distanceM: 100_000, movingTimeS: 14_400 }, { id: `p${i}` }),
    );
    await seed([...past, ride('2026-11-05T08:00:00Z', { distanceM: 50_000, movingTimeS: 7_200 }, { id: 'n' })]);
    renderAt();
    const nov = await screen.findByRole('region', { name: 'Noviembre hasta hoy' });
    // Media de los meses anteriores: 100 km; a día 6 de 30, 20 km. 50 km es +150 %.
    expect(nov).toHaveTextContent('+150 % de km');
    expect(nov).toHaveTextContent('frente a tu media a día 6');
    // Octubre solo tiene dos meses detrás: sin comparación.
    expect(screen.getByRole('region', { name: 'Octubre' })).not.toHaveTextContent('frente a tu media');
  });

  it('shows 50 and loads more', async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      ride(new Date(Date.parse('2026-11-05T08:00:00Z') - i * DAY).toISOString(), { distanceM: 40_000, movingTimeS: 5_400 }, {
        id: `m${i}`,
      }),
    );
    await db.activities.bulkAdd(many);
    renderAt();
    await waitRides(50);
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar más' }));
    await vi.waitFor(() => expect(rideLinks()).toHaveLength(100));
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar más' }));
    await vi.waitFor(() => expect(rideLinks()).toHaveLength(120));
    expect(screen.queryByRole('button', { name: 'Mostrar más' })).not.toBeInTheDocument();
    expect(screen.getByText(/Tu primera salida importada es del/)).toBeInTheDocument();
  }, 20_000);

  it('row links to detail', async () => {
    await seed([{ ...moia, id: 'strava/42 b' }]);
    renderAt();
    await waitRides(1);
    expect(rideLinks()[0]).toHaveAttribute('href', `#/historial/${encodeURIComponent('strava/42 b')}`);
  });

  it('untitled ride shows fallback', async () => {
    await seed([{ ...moia, name: undefined }]);
    renderAt();
    await waitRides(1);
    expect(rideLinks()[0]).toHaveTextContent('Salida sin nombre');
  });

  it('ride without gps is tagged', async () => {
    await seed([{ ...moia, hasTrack: false }, bracons]);
    renderAt();
    await waitRides(2);
    expect(rideLinks()[0]).toHaveTextContent('Sin GPS');
    expect(rideLinks()[1]).not.toHaveTextContent('Sin GPS');
  });

  it('empty state invites import', async () => {
    renderAt();
    expect(await screen.findByRole('heading', { name: 'Aún no hay salidas' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Importar salidas' })).toHaveAttribute('href', '#/importar');
    expect(screen.queryByRole('searchbox', { name: 'Buscar salidas' })).not.toBeInTheDocument();
  });

  it('error state offers a retry', async () => {
    await seed([moia]);
    db.close();
    renderAt();
    expect(await screen.findByRole('heading', { name: 'No se han podido abrir tus salidas' })).toBeInTheDocument();
    await db.open();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitRides(1);
  });

  it('search filters by name ignoring accents and case', async () => {
    await seed([plana, moia, bracons]);
    renderAt();
    await waitRides(3);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar salidas' }), 'MOIA');
    await vi.waitFor(() => expect(rideLinks()).toHaveLength(1));
    expect(rideLinks()[0]).toHaveTextContent('Collsuspina y Moià');
    expect(screen.getByRole('status')).toHaveTextContent('1 de 3 salidas');
    expect(rideLinks()[0].querySelector('mark')).toHaveTextContent('Moià');
  });

  it('search without results offers to clear it', async () => {
    await seed([plana, moia]);
    renderAt();
    await waitRides(2);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar salidas' }), 'zzz');
    expect(await screen.findByRole('heading', { name: 'Ninguna salida con «zzz»' })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Borrar la búsqueda' }).at(-1)!);
    await vi.waitFor(() => expect(rideLinks()).toHaveLength(2));
  });

  it('keeps the search in the address', async () => {
    await seed([plana, moia, bracons]);
    renderAt('#/historial?q=plana');
    await waitRides(1);
    expect(screen.getByRole('searchbox', { name: 'Buscar salidas' })).toHaveValue('plana');
  });

  it('sorts by distance in a flat list', async () => {
    await seed([plana, moia, bracons, rupit]);
    renderAt();
    await waitRides(4);
    const sheet = await openFilters();
    await userEvent.click(within(within(sheet).getByRole('group', { name: 'Ordenar por' })).getByRole('button', { name: 'Distancia' }));
    await vi.waitFor(() =>
      expect(rideLinks().map((a) => a.getAttribute('href'))).toEqual([
        '#/historial/rupit',
        '#/historial/moia',
        '#/historial/bracons',
        '#/historial/plana',
      ]),
    );
    expect(screen.queryByRole('region', { name: 'Octubre' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('4 de 4 salidas, de más a menos distancia');
  });

  it('sorting by speed shows each speed', async () => {
    await seed([plana, moia]);
    renderAt();
    await waitRides(2);
    const sheet = await openFilters();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Velocidad' }));
    // Moià: 87,6 km en 3 h 12 = 27,4 km/h; Plana: 52,4 km en 1 h 56 = 27,1 km/h.
    await vi.waitFor(() => expect(rideLinks()[0]).toHaveTextContent('27,4 km/h'));
    expect(rideLinks()[1]).toHaveTextContent('27,1 km/h');
  });

  it('distance filter shows a removable chip', async () => {
    await seed([plana, moia, bracons, rupit]);
    renderAt();
    await waitRides(4);
    const sheet = await openFilters();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Más de 90 km' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Ver 1 salida' }));
    await vi.waitFor(() => expect(rideLinks()).toHaveLength(1));
    expect(screen.getByRole('status')).toHaveTextContent('1 de 4 salidas');
    expect(screen.getByRole('button', { name: 'Filtrar y ordenar, 1 filtro activo' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Quitar el filtro Más de 90 km' }));
    await vi.waitFor(() => expect(rideLinks()).toHaveLength(4));
  });

  it('difficulty filter keeps the rides of that level', async () => {
    // Referencia: 5 salidas en 8 semanas, media de 60 km y 500 m. 100 km es Dura; 50 km, Suave.
    const acts = [0, 1, 2, 3].map((i) =>
      ride(`2026-10-0${i + 1}T08:00:00Z`, { distanceM: 50_000, elevGainM: 500, movingTimeS: 7_200 }, { id: `s${i}` }),
    );
    acts.push(ride('2026-11-02T08:00:00Z', { distanceM: 100_000, elevGainM: 500, movingTimeS: 14_400 }, { id: 'dura' }));
    await seed(acts);
    renderAt();
    await waitRides(5);
    expect(rideLinks()[0]).toHaveTextContent('dura para ti');
    const sheet = await openFilters();
    await userEvent.click(within(within(sheet).getByRole('group', { name: 'Dificultad para ti' })).getByRole('button', { name: 'Dura' }));
    await vi.waitFor(() => expect(rideLinks()).toHaveLength(1));
    expect(rideLinks()[0]).toHaveAttribute('href', '#/historial/dura');
  });

  it('marks repeated routes and filters by them', async () => {
    await seed([plana, moia, bracons]);
    const cells = ['a', 'b', 'c', 'd'];
    await db.routeSigs.bulkPut([
      { activityId: 'moia', activityStart: moia.startTime, distanceM: 87_600, cells, analysisVersion: 1 },
      { activityId: 'bracons', activityStart: bracons.startTime, distanceM: 87_000, cells, analysisVersion: 1 },
      { activityId: 'plana', activityStart: plana.startTime, distanceM: 52_400, cells: ['x', 'y'], analysisVersion: 1 },
    ]);
    renderAt();
    await waitRides(3);
    await vi.waitFor(() => expect(rideLinks()[0]).toHaveTextContent('Ruta repetida'));
    expect(rideLinks()[2]).not.toHaveTextContent('Ruta repetida');
    const sheet = await openFilters();
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Solo rutas repetidas' }));
    await vi.waitFor(() => expect(rideLinks()).toHaveLength(2));
  });
  it('announces the result count without the clear-filters button', async () => {
    await seed([plana, moia, bracons, rupit]);
    renderAt();
    await waitRides(4);
    const sheet = await openFilters();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Más de 90 km' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Ver 1 salida' }));
    await vi.waitFor(() => expect(rideLinks()).toHaveLength(1));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('1 de 4 salidas');
    expect(within(status).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar filtros' })).toBeInTheDocument();
  });

  it('keeps the sheet filters in the address', async () => {
    await seed([plana, moia, bracons, rupit]);
    renderAt();
    await waitRides(4);
    const sheet = await openFilters();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Más de 90 km' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Ver 1 salida' }));
    await vi.waitFor(() => expect(rideLinks()).toHaveLength(1));
    expect(window.location.hash).toBe('#/historial?dist=gt90');
  });

  it('reads distance, difficulty and repeated filters from the address', async () => {
    const acts = [0, 1, 2, 3].map((i) =>
      ride(`2026-10-0${i + 1}T08:00:00Z`, { distanceM: 50_000, elevGainM: 500, movingTimeS: 7_200 }, { id: `s${i}` }),
    );
    acts.push(ride('2026-11-02T08:00:00Z', { distanceM: 100_000, elevGainM: 500, movingTimeS: 14_400 }, { id: 'dura' }));
    await seed(acts);
    await db.routeSigs.bulkPut(
      ['dura', 's0'].map((id) => ({ activityId: id, activityStart: 0, distanceM: 60_000, cells: ['a', 'b', 'c'], analysisVersion: 1 })),
    );
    renderAt('#/historial?dist=gt90&dif=Dura,Media&rep=1');
    await waitRides(1);
    const applied = screen.getByRole('group', { name: 'Filtros aplicados' });
    expect(within(applied).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Más de 90 km',
      'Dura',
      'Media',
      'Solo repetidas',
    ]);
    expect(rideLinks()[0]).toHaveAttribute('href', '#/historial/dura');
  });

  it('ignores unknown filter values in the address', async () => {
    await seed([plana, moia]);
    renderAt('#/historial?dist=200&dif=Facil&rep=si&orden=x');
    await waitRides(2);
    expect(screen.queryByRole('group', { name: 'Filtros aplicados' })).not.toBeInTheDocument();
  });

  it('coming back from a ride keeps the sheet filters', async () => {
    await seed([plana, moia, bracons, rupit]);
    renderAt();
    await waitRides(4);
    const sheet = await openFilters();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Más de 90 km' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Ver 1 salida' }));
    await vi.waitFor(() => expect(rideLinks()).toHaveLength(1));
    await userEvent.click(rideLinks()[0]);
    await userEvent.click(await screen.findByRole('link', { name: 'Volver al historial' }));
    await waitRides(1);
    expect(screen.getByRole('button', { name: 'Quitar el filtro Más de 90 km' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 de 4 salidas');
  });

  it('coming back from a ride keeps the rows shown and focuses the ride opened', async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      ride(new Date(Date.parse('2026-11-05T08:00:00Z') - i * DAY).toISOString(), { distanceM: 40_000, movingTimeS: 5_400 }, {
        id: `m${i}`,
        hasTrack: false,
      }),
    );
    await db.activities.bulkAdd(many);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    renderAt('#/');
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Menú principal' })).getByRole('link', { name: 'Historial' }));
    await waitRides(50);
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar más' }));
    await vi.waitFor(() => expect(rideLinks()).toHaveLength(100));
    await userEvent.click(rideLinks()[80]);
    await userEvent.click(await screen.findByRole('link', { name: 'Volver al historial' }));
    await waitRides(100);
    expect(document.activeElement).toBe(rideLinks()[80]);
    scrollTo.mockRestore();
  }, 20_000);

  it('coming back to the tab shows the rides at once, without loading them again', async () => {
    await seed([plana, moia]);
    renderAt();
    await waitRides(2);
    const nav = screen.getByRole('navigation', { name: 'Menú principal' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Inicio' }));
    await vi.waitFor(() => expect(window.location.hash).toBe('#/'));
    // Clic síncrono: sin dar tiempo a leer la base, la lista ya tiene que estar.
    fireEvent.click(within(nav).getByRole('link', { name: 'Historial' }));
    expect(rideLinks()).toHaveLength(2);
    expect(screen.queryByText('Cargando tus salidas…')).not.toBeInTheDocument();
  });

  it('after an address change outside the app, back names the screen it returns to', async () => {
    await seed([moia]);
    renderAt('#/historial/subidas');
    await screen.findByRole('heading', { level: 1 });
    window.location.hash = '#/historial';
    await waitRides(1);
    await userEvent.click(rideLinks()[0]);
    expect(await screen.findByRole('link', { name: 'Volver al historial' })).toBeInTheDocument();
  });

  it('a cleared search does not come back when sorting before the list catches up', async () => {
    await seed([plana, moia, bracons, rupit]);
    deferred.frozen = true;
    renderAt('#/historial?q=moia');
    await waitRides(1);
    await userEvent.click(screen.getAllByRole('button', { name: 'Borrar la búsqueda' })[0]);
    expect(window.location.hash).toBe('#/historial');
    const sheet = await openFilters();
    await userEvent.click(within(within(sheet).getByRole('group', { name: 'Ordenar por' })).getByRole('button', { name: 'Distancia' }));
    expect(window.location.hash).toBe('#/historial?orden=km');
  });
});
