import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { db } from '../src/db/db';
import { saveActivity, setLastBackupAt, setLastImportAt } from '../src/db/repo';
import { saveGoal, saveWorkout } from '../src/calendar/calendarRepo';
import { fullText } from './helpers/text';
import { resetInicioMemory } from '../src/ui/inicio/inicioMemory';
import { saveSettings, DEFAULT_SETTINGS } from '../src/settings/settings';
import type { ActivityTotals, Goal, PlannedWorkout, StoredActivity, TrackPoint } from '../src/domain/types';

// «Ver con datos de ejemplo» guarda dos salidas sintéticas en vez de las ~200 de la demostración.
vi.mock('../src/demo/demoData', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/demo/demoData')>();
  return {
    ...real,
    loadDemoData: vi.fn(async () => {
      const repo = await import('../src/db/repo');
      const base = { sport: 'cycling' as const, hasTrack: false, source: 'fit' as const, importedAt: 0 };
      const t = { elapsedTimeS: 0, avgSpeedMs: 0, maxSpeedMs: 0 };
      await repo.saveActivity({ ...base, id: 'demo-1', startTime: Date.parse('2026-11-03T08:00:00Z'), name: 'Ejemplo uno', totals: { ...t, distanceM: 60_000, elevGainM: 800, movingTimeS: 8_000 } }, []);
      await repo.saveActivity({ ...base, id: 'demo-2', startTime: Date.parse('2026-11-05T08:00:00Z'), name: 'Ejemplo dos', totals: { ...t, distanceM: 50_000, elevGainM: 500, movingTimeS: 7_000 } }, []);
      return 2;
    }),
  };
});

// Leaflet solo pinta líneas si el navegador tiene SVG; jsdom no expone createSVGRect.
Object.defineProperty(SVGSVGElement.prototype, 'createSVGRect', { configurable: true, value: () => ({}) });

// Viernes 6 de noviembre de 2026, 13:00 en Madrid. La semana empieza el lunes 2.
const NOW = Date.parse('2026-11-06T12:00:00Z');
const DAY = 86_400_000;

function ride(iso: string, totals: Partial<ActivityTotals>, extra: Partial<StoredActivity> = {}): StoredActivity {
  const startTime = Date.parse(iso);
  return {
    id: `r-${startTime}`,
    startTime,
    sport: 'cycling',
    totals: {
      distanceM: 0,
      movingTimeS: 0,
      elapsedTimeS: 0,
      elevGainM: 0,
      avgSpeedMs: 0,
      maxSpeedMs: 0,
      ...totals,
    },
    hasTrack: false,
    source: 'fit',
    importedAt: NOW,
    ...extra,
  };
}

// Semana actual: 88 km, 1.240 m y 3 h 42 min en dos salidas.
const thisWeek = [
  ride('2026-11-03T08:00:00Z', { distanceM: 40_000, elevGainM: 600, movingTimeS: 6_000 }),
  ride('2026-11-05T08:00:00Z', { distanceM: 48_000, elevGainM: 640, movingTimeS: 7_320 }, { name: 'Vuelta corta' }),
];
// Cuatro semanas anteriores: 95,652 km, 1.181 m y 13.998 s cada una (24,6 km/h).
// Frente a esa media: distancia −8 %, desnivel +5 %, tiempo −5 %.
const history = ['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28'].map((d) =>
  ride(`${d}T08:00:00Z`, { distanceM: 95_652, elevGainM: 1_181, movingTimeS: 13_998 }),
);

async function seed(acts: StoredActivity[], tracks: Record<string, TrackPoint[]> = {}) {
  for (const a of acts) await saveActivity(a, tracks[a.id] ?? []);
}

function renderInicio() {
  window.location.hash = '#/';
  return render(<App />);
}

describe('Inicio', () => {
  beforeEach(async () => {
    resetInicioMemory();
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    await Promise.all([
      db.activities.clear(),
      db.tracks.clear(),
      db.meta.clear(),
      db.settings.clear(),
      db.calendar.clear(),
      db.goals.clear(),
    ]);
  });
  afterEach(() => {
    vi.useRealTimers();
    window.location.hash = '';
  });

  it('empty state invites import', async () => {
    renderInicio();
    expect(await screen.findByText(/Aún no hay salidas/)).toBeInTheDocument();
    // La tarjeta lateral también dice «Importar salidas», pero está fuera de `main`.
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Importar salidas' })).toHaveAttribute(
      'href',
      '#/importar',
    );
  });

  it('week kpis', async () => {
    await seed([...history, ...thisWeek]);
    await setLastImportAt(NOW - 2 * DAY);
    renderInicio();
    const week = await screen.findByRole('region', { name: 'Esta semana' });
    expect(within(week).getByText(fullText('88 km'))).toBeInTheDocument();
    expect(within(week).getByText(fullText('1240 m'))).toBeInTheDocument();
    expect(within(week).getByText(fullText('3 h 42'))).toBeInTheDocument();
    // Velocidad de esta semana: 88 km en 13.320 s, frente a 24,6 km/h de media.
    expect(within(week).getByText(fullText('23,8 km/h'))).toBeInTheDocument();
    expect(within(week).getByText('−3 % frente a tu media')).toBeInTheDocument();
    expect(within(week).getByText('2 salidas esta semana, frente a tus semanas a estas alturas')).toBeInTheDocument();
  });

  it('speed tile says Sin salidas when there are no rides this week', async () => {
    await seed(history);
    renderInicio();
    const week = await screen.findByRole('region', { name: 'Esta semana' });
    expect(within(week).getByText('Sin salidas')).toBeInTheDocument();
    expect(within(week).getByText('Tu media: 24,6 km/h')).toBeInTheDocument();
  });

  it('loading message is announced as status', async () => {
    renderInicio();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando salidas…');
    await screen.findByText(/Aún no hay salidas/);
  });

  it('deltas compare the week with your weeks at this point', async () => {
    // Las 4 salidas anteriores son de miércoles: a estas alturas (viernes) ya contaban. Entre 11 semanas,
    // 34,8 km, 429 m y 1 h 25 min; frente a 88 km, 1240 m y 3 h 42 min.
    await seed([...history, ...thisWeek]);
    renderInicio();
    expect(await screen.findByText('+153 % frente a tus semanas a estas alturas')).toBeInTheDocument();
    expect(screen.getByText('+189 % frente a tus semanas a estas alturas')).toBeInTheDocument();
    expect(screen.getByText('+162 % frente a tus semanas a estas alturas')).toBeInTheDocument();
  });

  it('no delta without history', async () => {
    await seed(thisWeek);
    renderInicio();
    await screen.findByRole('region', { name: 'Esta semana' });
    expect(screen.queryByText(/% frente a/)).not.toBeInTheDocument();
    const week = screen.getByRole('region', { name: 'Esta semana' });
    expect(within(week).getByText(/Aún no hay media: necesitas 3 semanas con salidas/)).toBeInTheDocument();
  });

  it('import reminder after 7 days', async () => {
    await seed(thisWeek);
    await setLastImportAt(NOW - 9 * DAY);
    renderInicio();
    const data = await screen.findByRole('region', { name: 'Tus datos' });
    expect(within(data).getByText(/Importaste hace 9 días: toca traer las nuevas/)).toBeInTheDocument();
  });

  it('greets by displayName', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, displayName: 'Ana' });
    await seed(thisWeek);
    renderInicio();
    expect(await screen.findByText('Hola, Ana.')).toBeInTheDocument();
  });

  it('last ride without track shows no map', async () => {
    await seed(thisWeek);
    renderInicio();
    const last = await screen.findByRole('region', { name: 'Tu última salida' });
    expect(within(last).getByText('Vuelta corta')).toBeInTheDocument();
    expect(within(last).getByText(fullText('48,0 km'))).toBeInTheDocument();
    expect(within(last).getByText(/no tiene mapa/)).toBeInTheDocument();
    expect(within(last).queryByRole('region', { name: 'Mapa de la última salida' })).not.toBeInTheDocument();
    expect(within(last).queryByRole('img', { name: /Perfil de altitud/ })).not.toBeInTheDocument();
  });

  it('last ride skips a later ride that is too short', async () => {
    // Como la del archivo real: 2 s y 0 km, guardada antes de que la importación las descartara.
    const blip = ride('2026-11-06T07:00:00Z', { distanceM: 0, movingTimeS: 2, elapsedTimeS: 2 }, { name: 'Basura' });
    await seed([...thisWeek, blip]);
    renderInicio();
    const last = await screen.findByRole('region', { name: 'Tu última salida' });
    expect(within(last).getByText('Vuelta corta')).toBeInTheDocument();
    expect(within(last).queryByText('Basura')).not.toBeInTheDocument();
  });

  it('no last ride when every ride is too short', async () => {
    await seed([ride('2026-11-06T07:00:00Z', { distanceM: 0, movingTimeS: 2 })]);
    renderInicio();
    await screen.findByRole('region', { name: 'Esta semana' });
    expect(screen.queryByRole('region', { name: 'Tu última salida' })).not.toBeInTheDocument();
  });

  it('last ride with track shows CyclOSM map and altitude profile', async () => {
    const withTrack = ride('2026-11-05T08:00:00Z', { distanceM: 48_000, elevGainM: 640, movingTimeS: 7_320 }, { hasTrack: true });
    const track: TrackPoint[] = [
      { t: withTrack.startTime, lat: 41.6, lng: 2.2, ele: 120, dist: 0 },
      { t: withTrack.startTime + 60_000, lat: 41.61, lng: 2.21, ele: 410, dist: 1_400 },
      { t: withTrack.startTime + 120_000, lat: 41.62, lng: 2.2, ele: 180, dist: 2_800 },
    ];
    await seed([withTrack], { [withTrack.id]: track });
    renderInicio();
    const last = await screen.findByRole('region', { name: 'Tu última salida' });
    expect(await within(last).findByRole('region', { name: 'Mapa de la última salida' })).toBeInTheDocument();
    expect(await within(last).findByText(/CyclOSM/)).toBeInTheDocument();
    expect(within(last).getByText(/OpenStreetMap/)).toBeInTheDocument();
    expect(within(last).getByRole('img', { name: 'Perfil de altitud: mínima 120 m, máxima 410 m' })).toBeInTheDocument();
  });

  it('last ride date says Ayer, jueves 5 de noviembre', async () => {
    await seed(thisWeek);
    renderInicio();
    const last = await screen.findByRole('region', { name: 'Tu última salida' });
    expect(within(last).getByText('Ayer, jueves 5 de noviembre')).toBeInTheDocument();
  });

  it('last ride links to its detail', async () => {
    await seed(thisWeek);
    renderInicio();
    const last = await screen.findByRole('region', { name: 'Tu última salida' });
    expect(within(last).getByRole('link', { name: 'Ver salida' })).toHaveAttribute(
      'href',
      `#/historial/${thisWeek[1].id}`,
    );
  });

  it('reads only recent rides but keeps an old last ride and the whole count', async () => {
    // Una salida de hace más de un año: fuera de la ventana reciente que Inicio lee entera.
    const old = ride('2025-09-12T08:00:00Z', { distanceM: 61_000, movingTimeS: 9_000 }, { name: 'Salida antigua' });
    const older = ride('2024-03-02T08:00:00Z', { distanceM: 20_000, movingTimeS: 3_000 });
    await seed([older, old]);
    renderInicio();
    const last = await screen.findByRole('region', { name: 'Tu última salida' });
    expect(within(last).getByText('Salida antigua')).toBeInTheDocument();
    const data = screen.getByRole('region', { name: 'Tus datos' });
    expect(within(data).getByText(/2 salidas desde marzo de 2024/)).toBeInTheDocument();
  });

  it('heart rate and power appear only when recorded', async () => {
    await seed([ride('2026-11-05T08:00:00Z', { distanceM: 48_000, movingTimeS: 7_320, avgHr: 142.4 })]);
    renderInicio();
    const last = await screen.findByRole('region', { name: 'Tu última salida' });
    expect(within(last).getByText(fullText('142 ppm'))).toBeInTheDocument();
    expect(within(last).queryByText(/Potencia media/)).not.toBeInTheDocument();
  });

  it('hero greets and summarises the week', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, displayName: 'Ana' });
    await seed([...history, ...thisWeek]);
    renderInicio();
    expect(await screen.findByText('Hola, Ana.')).toBeInTheDocument();
    // Las diferencias van en las cifras, justo debajo: el saludo no las repite.
    expect(screen.getByText(fullText('Llevas 88 km esta semana.'))).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Inicio' })).toBeInTheDocument();
  });

  it('hero shows the summit of the last ride', async () => {
    const withTrack = ride('2026-11-05T08:00:00Z', { distanceM: 48_000, elevGainM: 640, movingTimeS: 7_320 }, { hasTrack: true });
    const track: TrackPoint[] = [
      { t: withTrack.startTime, lat: 41.6, lng: 2.2, ele: 120, dist: 0 },
      { t: withTrack.startTime + 60_000, lat: 41.61, lng: 2.21, ele: 410, dist: 1_400 },
      { t: withTrack.startTime + 120_000, lat: 41.62, lng: 2.2, ele: 180, dist: 2_800 },
    ];
    await seed([withTrack], { [withTrack.id]: track });
    renderInicio();
    expect(await screen.findByText(fullText('410 m'))).toBeInTheDocument();
    expect(screen.getByText(/cima de tu última salida, en el km 1/)).toBeInTheDocument();
  });

  it('hero without track has no summit label', async () => {
    await seed(thisWeek);
    renderInicio();
    await screen.findByRole('region', { name: 'Esta semana' });
    expect(screen.queryByText(/cima de tu última salida/)).not.toBeInTheDocument();
  });

  it('empty state shows how to get the archive', async () => {
    renderInicio();
    expect(await screen.findByRole('heading', { name: 'Cómo conseguir tu archivo de Strava' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getAllByRole('link', { name: 'Importar salidas' })).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Esta semana' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Avisos/ })).not.toBeInTheDocument();
  });

  it('kpi cards select the chart metric', async () => {
    const user = userEvent.setup();
    await seed([...history, ...thisWeek]);
    renderInicio();
    const week = await screen.findByRole('region', { name: 'Esta semana' });
    const dist = within(week).getByRole('button', { name: /^Distancia/ });
    const elev = within(week).getByRole('button', { name: /^Desnivel/ });
    expect(dist).toHaveAttribute('aria-pressed', 'true');
    expect(elev).toHaveAttribute('aria-pressed', 'false');
    expect(dist).toHaveAttribute('aria-controls', 'progreso');
    expect(document.getElementById('progreso')).not.toBeNull();
    await user.click(elev);
    expect(elev).toHaveAttribute('aria-pressed', 'true');
    expect(dist).toHaveAttribute('aria-pressed', 'false');
  });

  it('top bar offers Generar ruta instead of bell and avatar', async () => {
    await seed(thisWeek);
    await setLastImportAt(NOW - 2 * DAY);
    renderInicio();
    expect(await screen.findByRole('link', { name: 'Generar ruta' })).toHaveAttribute('href', '#/rutas');
    // Importar y copia de seguridad están en «Tus datos».
    expect(screen.queryByRole('button', { name: /Avisos/ })).not.toBeInTheDocument();
  });

  it('trend card shows the last 12 weeks', async () => {
    const user = userEvent.setup();
    await seed([...history, ...thisWeek]);
    renderInicio();
    const trend = await screen.findByRole('region', { name: 'Tus últimas 12 semanas' });
    expect(trend).toHaveAttribute('id', 'progreso');
    expect(within(trend).getByRole('img', { name: /^Distancia por semana en las últimas 12 semanas/ })).toBeInTheDocument();
    // Solo 4 semanas con salidas en las 11 completas: 382,6 km entre 11.
    expect(within(trend).getByText(/^A estas alturas sueles llevar 35 km/)).toBeInTheDocument();
    await user.click(within(trend).getByRole('button', { name: 'Ver tabla' }));
    const weeks = within(trend).getAllByRole('rowheader').map((th) => th.textContent);
    expect(weeks).toHaveLength(12);
    expect(weeks[0]).toBe('2 nov (en curso)');
    expect(weeks[11]).toBe('17 ago');
  });

  it('kpi cards switch the trend to Desnivel', async () => {
    const user = userEvent.setup();
    await seed([...history, ...thisWeek]);
    renderInicio();
    const week = await screen.findByRole('region', { name: 'Esta semana' });
    await user.click(within(week).getByRole('button', { name: /^Desnivel/ }));
    const trend = screen.getByRole('region', { name: 'Tus últimas 12 semanas' });
    const metric = within(trend).getByRole('group', { name: 'Métrica de la gráfica' });
    expect(within(metric).getByRole('button', { name: 'Desnivel' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(trend).getByRole('img', { name: /^Desnivel por semana/ })).toBeInTheDocument();
  });

  describe('plan, goals and your data', () => {
    const workout = (id: string, date: string, extra: Partial<PlannedWorkout> = {}): PlannedWorkout => ({
      id,
      date,
      title: `Entreno ${id}`,
      done: false,
      manual: false,
      createdAt: NOW,
      ...extra,
    });
    const marxa: Goal = {
      kind: 'event',
      id: 'marxa',
      title: 'Marxa del Lluçanès',
      date: '2026-12-13',
      distanceM: 140_000,
      elevGainM: 2_600,
      createdAt: NOW,
    };
    const volume = (id: string, start: string, distanceM: number): Goal => ({
      kind: 'volume',
      id,
      title: id,
      period: 'month',
      start,
      distanceM,
      createdAt: NOW,
    });

    it('shows nearest goal', async () => {
      await seed(thisWeek);
      await saveGoal({ ...marxa, id: 'lejos', title: 'Quebrantahuesos', date: '2027-06-20' });
      await saveGoal(marxa);
      await saveGoal({ ...marxa, id: 'pasado', title: 'Marcha pasada', date: '2026-11-01' });
      renderInicio();
      const link = await screen.findByRole('link', { name: /Marxa del Lluçanès/ });
      expect(link).toHaveAttribute('href', '#/plan/objetivos');
      expect(within(link).getByText('13 de diciembre, faltan 37 días')).toBeInTheDocument();
      expect(screen.queryByText('Quebrantahuesos')).not.toBeInTheDocument();
      expect(screen.queryByText('Marcha pasada')).not.toBeInTheDocument();
    });

    it('goal card shows current volume goal', async () => {
      // Noviembre: los 88 km de esta semana. Del 1 a las 00:00 al 6 a las 13:00 han pasado 133 de 720 h: el 18 % (148 km).
      await seed(thisWeek);
      await saveGoal(marxa);
      await saveGoal(volume('nov', '2026-11-01', 800_000));
      await saveGoal(volume('dic', '2026-12-01', 900_000));
      renderInicio();
      const goal = await screen.findByRole('region', { name: 'Objetivo de noviembre' });
      expect(within(goal).getByText('88')).toBeInTheDocument();
      expect(within(goal).getByText('de 800 km')).toBeInTheDocument();
      expect(
        within(goal).getByRole('img', {
          name: 'El 11 % del objetivo. El ritmo esperado hoy es el 18 %: vas 60 km por detrás del ritmo.',
        }),
      ).toBeInTheDocument();
      expect(within(goal).getByText('Quedan 25 días')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Objetivo de diciembre' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Marxa del Lluçanès/ })).toBeInTheDocument();
    });

    it('only volume goal shows goal card', async () => {
      await seed(thisWeek);
      await saveGoal(volume('nov', '2026-11-01', 800_000));
      renderInicio();
      expect(await screen.findByRole('region', { name: 'Objetivo de noviembre' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /faltan/ })).not.toBeInTheDocument();
    });

    it('with a month and a week goal, shows only the month one (the week one is in Plan)', async () => {
      await seed(thisWeek);
      await saveGoal(volume('nov', '2026-11-01', 800_000));
      await saveGoal({ ...volume('sem', '2026-11-02', 200_000), period: 'week' } as Goal);
      renderInicio();
      expect(await screen.findByRole('region', { name: 'Objetivo de noviembre' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Objetivo de la semana' })).not.toBeInTheDocument();
    });

    it('with only a week goal, shows it', async () => {
      await seed(thisWeek);
      await saveGoal({ ...volume('sem', '2026-11-02', 200_000), period: 'week' } as Goal);
      renderInicio();
      expect(await screen.findByRole('region', { name: 'Objetivo de la semana' })).toBeInTheDocument();
    });

    it('no goal hides goal card', async () => {
      await seed(thisWeek);
      await saveGoal(volume('oct', '2026-10-01', 800_000));
      await saveGoal({ ...marxa, date: '2026-11-01' });
      renderInicio();
      await screen.findByRole('region', { name: 'Esta semana' });
      expect(screen.queryByRole('region', { name: /^Objetivo de/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Marxa/ })).not.toBeInTheDocument();
    });

    it('shows next two workouts', async () => {
      await seed(thisWeek);
      await saveWorkout(workout('hecho', '2026-11-06', { done: true, title: 'Ya hecho' }));
      await saveWorkout(workout('sab', '2026-11-07', { title: 'Lluçanès por Prats', distanceM: 86_000, elevGainM: 1_320 }));
      await saveWorkout(workout('dom', '2026-11-08', { title: 'Rodaje suave a Tona', distanceM: 50_000 }));
      await saveWorkout(workout('lun', '2026-11-09', { title: 'Tercero' }));
      renderInicio();
      const next = await screen.findByRole('region', { name: 'Próximo entreno' });
      expect(within(next).getByRole('heading', { level: 3, name: 'Lluçanès por Prats' })).toBeInTheDocument();
      expect(within(next).getByText('Mañana, sábado 7 de noviembre')).toBeInTheDocument();
      expect(within(next).getByText(fullText('86 km'))).toBeInTheDocument();
      expect(within(next).getByText(fullText('1320 m'))).toBeInTheDocument();
      // El nombre va aislado en <bdi>: un título en árabe no arrastra la distancia al otro lado.
      const foot = next.querySelector('.card-foot');
      expect(foot).toHaveTextContent('Y el domingo 8: Rodaje suave a Tona, 50 km.');
      expect(foot?.querySelector('bdi')).toHaveTextContent('Rodaje suave a Tona');
      expect(within(next).getByRole('link', { name: 'Ver el plan de entrenos' })).toHaveAttribute('href', '#/plan');
      expect(within(next).getByRole('link', { name: /Ruta y GPX/ })).toHaveAttribute('href', '#/rutas');
      expect(screen.queryByText('Ya hecho')).not.toBeInTheDocument();
      expect(screen.queryByText(/Tercero/)).not.toBeInTheDocument();
      // El saludo dice lo que toca mañana.
      expect(screen.getByText(fullText('Mañana toca Lluçanès.'))).toBeInTheDocument();
    });

    it('km marker shows weekday, day and month', async () => {
      await seed(thisWeek);
      await saveWorkout(workout('lejos', '2026-11-15', { title: 'Montseny' }));
      renderInicio();
      const next = await screen.findByRole('region', { name: 'Próximo entreno' });
      const marker = next.querySelector('.hito-date');
      expect(marker).toHaveTextContent('dom15nov');
      expect(marker).toHaveAttribute('aria-hidden', 'true');
      expect(within(next).getByText('Domingo 15 de noviembre')).toBeInTheDocument();
    });

    it('no planned workouts invites to calendar', async () => {
      await seed(thisWeek);
      renderInicio();
      const next = await screen.findByRole('region', { name: 'Próximo entreno' });
      expect(within(next).getByText('No tienes salidas planificadas.')).toBeInTheDocument();
      expect(within(next).getByRole('link', { name: 'Ver calendario' })).toHaveAttribute('href', '#/plan');
    });

    it('hero adds the month pace to what is on tomorrow', async () => {
      await seed(thisWeek);
      await saveGoal(volume('nov', '2026-11-01', 800_000));
      await saveWorkout(workout('sab', '2026-11-07', { title: 'Lluçanès por Prats' }));
      renderInicio();
      expect(
        await screen.findByText(fullText('Mañana toca Lluçanès, y en noviembre vas por detrás del ritmo.')),
      ).toBeInTheDocument();
    });

    it('import and backup use the same relative days', async () => {
      await seed([...history, ...thisWeek]);
      await setLastImportAt(NOW - 3 * DAY);
      await setLastBackupAt(NOW - 12 * DAY);
      renderInicio();
      const data = await screen.findByRole('region', { name: 'Tus datos' });
      expect(within(data).getByRole('link', { name: /^Importar salidas/ })).toHaveAttribute('href', '#/importar');
      expect(within(data).getByText(/Importaste hace 3 días\./)).toBeInTheDocument();
      expect(within(data).getByText('La última, hace 12 días, anterior a la última importación')).toBeInTheDocument();
      expect(within(data).getByRole('link', { name: /^Hacer copia de seguridad/ })).toHaveAttribute('href', '#/ajustes');
    });

    it('no backup yet', async () => {
      await seed(thisWeek);
      renderInicio();
      const data = await screen.findByRole('region', { name: 'Tus datos' });
      expect(within(data).getByText('Aún no has hecho ninguna')).toBeInTheDocument();
    });

    it('ride count and first month', async () => {
      await seed([...history, ...thisWeek]);
      renderInicio();
      const data = await screen.findByRole('region', { name: 'Tus datos' });
      expect(within(data).getByText(/6 salidas desde octubre de 2026/)).toBeInTheDocument();
    });

    it('empty state offers the example data', async () => {
      const user = userEvent.setup();
      renderInicio();
      await user.click(await screen.findByRole('button', { name: 'Ver con datos de ejemplo' }));
      const week = await screen.findByRole('region', { name: 'Esta semana' });
      expect(within(week).getByText(fullText('110 km'))).toBeInTheDocument();
      // El botón pulsado desaparece: el foco va al título y se anuncia la carga.
      await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Inicio' })).toHaveFocus());
      expect(screen.getByText('Datos de ejemplo cargados')).toBeInTheDocument();
    });
  });
});
