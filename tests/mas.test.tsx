import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Mas } from '../src/ui/pages/Mas';
import { masSummary, type MasData } from '../src/ui/mas/masSummary';
import { db } from '../src/db/db';
import { clearAllData, setLastImportAt } from '../src/db/repo';
import { localDay } from '../src/metrics/calendar';
import { setTheme } from '../src/ui/theme/theme';
import type { ClimbEffort, Goal, PlannedWorkout, RouteSig, StoredActivity } from '../src/domain/types';

const DAY = 86_400_000;
// Viernes 6 de noviembre de 2026, 12:00 en Madrid.
const NOW = Date.UTC(2026, 10, 6, 11, 0, 0);

function ride(id: string, startTime: number, km = 40): StoredActivity {
  return {
    id,
    startTime,
    sport: 'cycling',
    totals: { distanceM: km * 1000, movingTimeS: 5400, elapsedTimeS: 5600, elevGainM: 300, avgSpeedMs: 7.4, maxSpeedMs: 14 },
    hasTrack: true,
    source: 'gpx',
    importedAt: startTime,
  };
}

/** Pasada sintética en el mar (lat 41,0; lng 2,5): `k` separa una subida de otra. */
function effort(id: string, k: number, activityStart: number): ClimbEffort {
  const start = { lat: 41.0 + k * 0.05, lng: 2.5 };
  const end = { lat: 41.02 + k * 0.05, lng: 2.5 };
  return {
    id,
    activityId: `a-${id}`,
    activityStart,
    startIdx: 0,
    endIdx: 10,
    start,
    end,
    startDistM: 0,
    lengthM: 2000,
    gainM: 100,
    avgGradePct: 5,
    timeS: 600,
    avgSpeedMs: 3.3,
    vamMh: 600,
  };
}

const sig = (activityId: string, cells: string[], distanceM = 40_000): RouteSig => ({
  activityId,
  activityStart: NOW - DAY,
  distanceM,
  cells,
});

function data(over: Partial<MasData> = {}): MasData {
  return { activities: [], efforts: [], sigs: [], workouts: [], goals: [], ...over };
}

describe('masSummary', () => {
  it('counts climbs and the ones you repeat', () => {
    const s = masSummary(
      data({
        activities: [ride('r', NOW - DAY)],
        efforts: [effort('a', 0, NOW - 3 * DAY), effort('b', 0, NOW - 2 * DAY), effort('c', 1, NOW - DAY)],
      }),
      NOW,
    );
    expect(s.climbs).toBe('2 subidas · 1 la repites');
  });

  it('counts the routes you repeat', () => {
    const cells = ['a', 'b', 'c', 'd', 'e'];
    const s = masSummary(
      data({ activities: [ride('r', NOW - DAY)], sigs: [sig('x', cells), sig('y', cells), sig('z', ['q', 'r', 's'])] }),
      NOW,
    );
    expect(s.routes).toBe('1 ruta que repites');
  });

  it('without rides, climbs and routes say they come with the import', () => {
    const s = masSummary(data(), NOW);
    expect(s.climbs).toBe('Aparecen al importar tus salidas');
    expect(s.routes).toBe('Aparecen al importar tus salidas');
    expect(s.calendar).toBe('Nada planificado');
    expect(s.goal).toEqual({ text: 'Sin objetivos en curso' });
  });

  it('next workout is tomorrow', () => {
    const workouts: PlannedWorkout[] = [
      { id: 'w2', date: localDay(NOW + 3 * DAY), title: 'Rodaje suave', done: false, manual: false, createdAt: NOW },
      { id: 'w1', date: localDay(NOW + DAY), title: 'Lluçanès por Prats', done: false, manual: false, createdAt: NOW },
      { id: 'w0', date: localDay(NOW - DAY), title: 'Ya pasado', done: false, manual: false, createdAt: NOW },
    ];
    expect(masSummary(data({ workouts }), NOW).calendar).toBe('Mañana: Lluçanès por Prats');
  });

  it('a later workout says its weekday and day', () => {
    const workouts: PlannedWorkout[] = [
      { id: 'w', date: localDay(NOW + 2 * DAY), title: 'Rodaje suave', done: false, manual: false, createdAt: NOW },
    ];
    expect(masSummary(data({ workouts }), NOW).calendar).toBe('Domingo 8: Rodaje suave');
  });

  it('month goal shows value, target and percent', () => {
    const goals: Goal[] = [
      { kind: 'volume', id: 'g', title: 'Noviembre', period: 'month', start: '2026-11-01', distanceM: 800_000, createdAt: NOW },
    ];
    const activities = [ride('a', NOW - 2 * DAY, 120), ride('b', NOW - DAY, 81)];
    expect(masSummary(data({ activities, goals }), NOW).goal).toEqual({ text: '201 de 800 km este mes', pct: 25 });
  });

  it('import says when it was', () => {
    expect(masSummary(data({ lastImportAt: NOW - DAY }), NOW).import).toBe('La última, ayer');
    expect(masSummary(data(), NOW).import).toBe('Aún no has importado');
  });

  it('backup warns when there are changes after the last copy', () => {
    const lastBackupAt = Date.UTC(2026, 9, 25, 10);
    expect(masSummary(data({ lastBackupAt, calendarChangedAt: NOW - DAY }), NOW).backup).toEqual({
      text: 'Sin copiar desde el 25 oct',
      warn: true,
    });
    expect(masSummary(data({ lastBackupAt }), NOW).backup).toEqual({ text: 'La última, hace 12 días', warn: false });
    expect(masSummary(data(), NOW).backup).toEqual({ text: 'Aún no has hecho ninguna', warn: false });
  });
});

function renderMas() {
  return render(
    <MemoryRouter initialEntries={['/mas']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Mas />
    </MemoryRouter>,
  );
}

describe('Más', () => {
  beforeEach(async () => {
    await clearAllData();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists Explorar and Datos y ajustes with their screens', async () => {
    await db.activities.add(ride('r1', Date.now() - DAY));
    renderMas();
    const explorar = await screen.findByRole('region', { name: 'Explorar' });
    const hrefs = within(explorar)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/historial/subidas', '/historial/repetidas', '/plan', '/plan/objetivos']);
    const datos = screen.getByRole('region', { name: 'Datos y ajustes' });
    expect(within(datos).getByRole('link', { name: /^Ajustes/ })).toHaveAttribute('href', '/ajustes');
    expect(within(datos).getByRole('link', { name: /^Importar salidas/ })).toHaveAttribute('href', '/importar');
    expect(within(datos).getByRole('link', { name: /^Copia de seguridad/ })).toHaveAttribute('href', '/ajustes?abrir=copia');
  });

  it('with rides, the lead counts rides and km', async () => {
    await db.activities.bulkAdd([ride('r1', Date.now() - DAY, 40), ride('r2', Date.now() - 2 * DAY, 47.6)]);
    await setLastImportAt(Date.now() - DAY);
    renderMas();
    expect(await screen.findByText('2 salidas')).toBeInTheDocument();
    expect(screen.getByText('88 km')).toBeInTheDocument();
    expect(screen.getByText('La última, ayer')).toBeInTheDocument();
  });

  it('without rides, invites to import first', async () => {
    renderMas();
    expect(await screen.findByText('Empieza por tu archivo de Strava')).toBeInTheDocument();
    expect(screen.getByText('Aún no hay salidas en este navegador.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '¿Vienes de otro teléfono? Restaurar una copia' })).toHaveAttribute(
      'href',
      '/ajustes?abrir=restaurar',
    );
    const datos = screen.getByRole('region', { name: 'Datos y ajustes' });
    const explorar = screen.getByRole('region', { name: 'Explorar' });
    expect(datos.compareDocumentPosition(explorar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('explains a storage error and retries', async () => {
    vi.spyOn(db.activities, 'orderBy').mockImplementationOnce(() => {
      throw new Error('SecurityError');
    });
    const user = userEvent.setup();
    renderMas();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pueden leer tus datos.');
    const explorar = screen.getByRole('region', { name: 'Explorar' });
    expect(within(explorar).queryAllByRole('link')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Empieza por tu archivo de Strava')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('theme button flips the theme', async () => {
    setTheme('dark');
    const user = userEvent.setup();
    renderMas();
    await user.click(await screen.findByRole('button', { name: 'Cambiar a tema claro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Cambiar a tema oscuro' })).toBeInTheDocument();
    setTheme('dark');
  });
});
