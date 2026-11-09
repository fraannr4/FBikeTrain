import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { db } from '../src/db/db';
import { saveActivity, setLastBackupAt } from '../src/db/repo';
import { listWorkouts, saveWorkout } from '../src/calendar/calendarRepo';
import type { LocalDate, PlannedWorkout, StoredActivity } from '../src/domain/types';

// Viernes 6 de noviembre de 2026, 11:00 en Madrid. La semana va del lunes 2 al domingo 8.
const NOW = Date.parse('2026-11-06T10:00:00Z');

const workout = (id: string, date: LocalDate, extra: Partial<PlannedWorkout> = {}): PlannedWorkout => ({
  id,
  date,
  title: 'Rodaje',
  done: false,
  manual: false,
  createdAt: 1,
  ...extra,
});

function ride(id: string, iso: string, distanceM: number, elevGainM = 0): StoredActivity {
  return {
    id,
    startTime: Date.parse(iso),
    sport: 'cycling',
    totals: { distanceM, movingTimeS: 6_000, elapsedTimeS: 6_500, elevGainM, avgSpeedMs: 8, maxSpeedMs: 14 },
    hasTrack: false,
    source: 'fit',
    importedAt: NOW,
  };
}

function renderCalendario(path = '/plan') {
  window.location.hash = `#${path}`;
  return render(<App />);
}

const strip = () => screen.findByRole('group', { name: /^Días/ });
const sheet = (name: string) => screen.getByRole('dialog', { name });

async function pickDayFromMonth(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  await user.click(await screen.findByRole('button', { name: 'Ver el mes' }));
  await user.click(within(sheet('Elegir día')).getByRole('button', { name: label }));
}

// La tira pinta 21 semanas de botones: las consultas por rol tardan en jsdom.
describe('Calendario', { timeout: 20_000 }, () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    await Promise.all(db.tables.map((t) => t.clear()));
  });
  afterEach(() => {
    vi.useRealTimers();
    window.location.hash = '';
  });

  it('shows current month', async () => {
    const user = userEvent.setup();
    await saveWorkout(workout('w1', '2026-11-07'));
    renderCalendario();
    expect(await screen.findByRole('button', { name: /2–8 de noviembre/ })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Hoy, viernes 6' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver el mes' }));
    expect(within(sheet('Elegir día')).getByText('Noviembre de 2026')).toBeInTheDocument();
  });

  it('navigates months', async () => {
    const user = userEvent.setup();
    await saveWorkout(workout('w1', '2026-11-07'));
    renderCalendario();
    await user.click(await screen.findByRole('button', { name: 'Ver el mes' }));
    await user.click(within(sheet('Elegir día')).getByRole('button', { name: 'Mes siguiente' }));
    expect(within(sheet('Elegir día')).getByText('Diciembre de 2026')).toBeInTheDocument();
    expect(within(sheet('Elegir día')).getByRole('button', { name: /^Martes 1 de diciembre/ })).toBeInTheDocument();
  });

  it('opens on the month of ?mes', async () => {
    await saveWorkout(workout('w1', '2026-11-07'));
    renderCalendario('/plan?mes=2026-12');
    expect(await screen.findByRole('heading', { name: 'Martes 1 de diciembre' })).toBeInTheDocument();
  });

  it('adds workout from a day', async () => {
    const user = userEvent.setup();
    await saveWorkout(workout('w1', '2026-11-07'));
    renderCalendario();
    await pickDayFromMonth(user, /^Domingo 15 de noviembre/);
    expect(await screen.findByRole('heading', { name: 'Domingo 15 de noviembre' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Planificar este día' }));
    const form = sheet('Planificar entreno');
    expect(within(form).getByLabelText('Día')).toHaveValue('2026-11-15');
    await user.type(within(form).getByLabelText('Nombre'), 'Coll d’Estenalles');
    await user.type(within(form).getByLabelText('Distancia'), '72');
    await user.type(within(form).getByLabelText('Desnivel'), '1320');
    await user.click(screen.getByRole('button', { name: 'Guardar entreno' }));

    await waitFor(async () => {
      const saved = (await listWorkouts()).find((w) => w.id !== 'w1');
      expect(saved).toMatchObject({
        date: '2026-11-15',
        title: 'Coll d’Estenalles',
        distanceM: 72_000,
        elevGainM: 1_320,
        done: false,
        manual: false,
      });
    });
    expect(await screen.findByRole('heading', { level: 3, name: 'Coll d’Estenalles' })).toBeInTheDocument();
  });

  it('title is required', async () => {
    const user = userEvent.setup();
    renderCalendario();
    await user.click((await screen.findAllByRole('button', { name: /Planificar/ }))[0]);
    const form = sheet('Planificar entreno');
    await user.type(within(form).getByLabelText('Distancia'), '50');
    await user.click(screen.getByRole('button', { name: 'Guardar entreno' }));
    expect(within(form).getByText('Ponle un nombre: la zona o el puerto bastan.')).toBeInTheDocument();
    expect(within(form).getByLabelText('Nombre')).toHaveAttribute('aria-invalid', 'true');
    expect(await listWorkouts()).toHaveLength(0);
  });

  it('rejects a figure it cannot read', async () => {
    const user = userEvent.setup();
    renderCalendario();
    await user.click((await screen.findAllByRole('button', { name: /Planificar/ }))[0]);
    const form = sheet('Planificar entreno');
    await user.type(within(form).getByLabelText('Nombre'), 'Rodaje');
    await user.type(within(form).getByLabelText('Distancia'), '7.5000');
    await user.click(screen.getByRole('button', { name: 'Guardar entreno' }));
    expect(within(form).getByText(/No sabemos si «7.5000» lleva decimales/)).toBeInTheDocument();
    expect(await listWorkouts()).toHaveLength(0);
  });

  it('shows ride and done workout on its day', async () => {
    const user = userEvent.setup();
    await saveActivity(ride('a5', '2026-11-05T08:00:00Z', 48_000, 640), []);
    await saveWorkout(workout('w5', '2026-11-05', { title: 'Vuelta corta', done: true, activityId: 'a5' }));
    renderCalendario();
    await user.click(within(await strip()).getByRole('button', { name: /^Jueves 5 de noviembre: Vuelta corta, hecho/ }));

    const card = await screen.findByRole('article', { name: 'Vuelta corta' });
    expect(within(card).getByText('Hecho')).toBeInTheDocument();
    expect(within(card).getByText(/Coincide con tu salida/)).toHaveTextContent(/48\skm, 640\sm y 1 h 40 min/);
    expect(within(card).getByRole('link', { name: 'Ver salida' })).toHaveAttribute('href', '#/historial/a5');
  });

  it('done workout with missing activity shows done without link', async () => {
    const user = userEvent.setup();
    await saveWorkout(workout('w5', '2026-11-05', { title: 'Vuelta corta', done: true, activityId: 'gone' }));
    renderCalendario();
    await user.click(within(await strip()).getByRole('button', { name: /^Jueves 5 de noviembre/ }));

    const card = await screen.findByRole('article', { name: 'Vuelta corta' });
    expect(within(card).getByText('Hecho')).toBeInTheDocument();
    expect(within(card).getByText(/no está importada en este navegador/)).toBeInTheDocument();
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
  });

  it('toggle done marks manual', async () => {
    const user = userEvent.setup();
    await saveActivity(ride('a5', '2026-11-05T08:00:00Z', 48_000), []);
    await saveWorkout(workout('w5', '2026-11-05', { title: 'Vuelta corta', done: true, activityId: 'a5' }));
    renderCalendario();
    await user.click(within(await strip()).getByRole('button', { name: /^Jueves 5 de noviembre/ }));
    await user.click(await screen.findByRole('button', { name: 'Editar Vuelta corta' }));

    const form = sheet('Editar entreno');
    const done = within(form).getByRole('switch', { name: 'Hecho' });
    expect(done).toHaveAttribute('aria-checked', 'true');
    await user.click(done);
    expect(done).toHaveAttribute('aria-checked', 'false');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(async () => {
      const [w] = await listWorkouts();
      expect(w).toMatchObject({ done: false, manual: true });
      expect(w.activityId).toBeUndefined();
    });
  });

  it('marks a missed workout as done by hand', async () => {
    const user = userEvent.setup();
    await saveWorkout(workout('w3', '2026-11-03', { title: 'Coll de Bracons' }));
    renderCalendario();
    await user.click(within(await strip()).getByRole('button', { name: /^Martes 3 de noviembre: Coll de Bracons, sin hacer/ }));
    const card = await screen.findByRole('article', { name: 'Coll de Bracons' });
    expect(within(card).getByText('Sin hacer')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Marcar como hecho' }));

    await waitFor(async () => expect((await listWorkouts())[0]).toMatchObject({ done: true, manual: true }));
    expect(await screen.findByText('Marcado como hecho')).toBeInTheDocument();
  });

  it('edits and deletes workout', async () => {
    const user = userEvent.setup();
    await saveWorkout(workout('w7', '2026-11-07', { title: 'Lluçanès por Prats', distanceM: 86_000 }));
    renderCalendario();
    await user.click(within(await strip()).getByRole('button', { name: /^Sábado 7 de noviembre/ }));
    await user.click(await screen.findByRole('button', { name: 'Editar Lluçanès por Prats' }));

    let form = sheet('Editar entreno');
    expect(within(form).getByLabelText('Distancia')).toHaveValue('86');
    const name = within(form).getByLabelText('Nombre');
    await user.clear(name);
    await user.type(name, 'Lluçanès por Olost');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(async () => expect((await listWorkouts())[0].title).toBe('Lluçanès por Olost'));

    await user.click(await screen.findByRole('button', { name: 'Editar Lluçanès por Olost' }));
    form = sheet('Editar entreno');
    await user.click(within(form).getByRole('button', { name: 'Borrar entreno' }));
    await waitFor(async () => expect(await listWorkouts()).toHaveLength(0));
    expect(await screen.findByText('Entreno borrado')).toBeInTheDocument();
  });

  it('saving a past workout with a ride marks it done', async () => {
    const user = userEvent.setup();
    await saveActivity(ride('a3', '2026-11-03T08:00:00Z', 72_100, 1_180), []);
    renderCalendario();
    await user.click((await screen.findAllByRole('button', { name: /Planificar/ }))[0]);
    const form = sheet('Planificar entreno');
    fireEvent.change(within(form).getByLabelText('Día'), { target: { value: '2026-11-03' } });
    await user.type(within(form).getByLabelText('Nombre'), 'Coll de Bracons');
    await user.click(screen.getByRole('button', { name: 'Guardar entreno' }));

    await waitFor(async () =>
      expect((await listWorkouts())[0]).toMatchObject({ date: '2026-11-03', done: true, activityId: 'a3', manual: false }),
    );
  });

  it('lists upcoming workouts', async () => {
    await saveWorkout(workout('w7', '2026-11-07', { title: 'Lluçanès por Prats', distanceM: 86_000, elevGainM: 1_320 }));
    await saveWorkout(workout('w8', '2026-11-08', { title: 'Rodaje suave a Tona', distanceM: 50_000 }));
    await saveWorkout(workout('w2', '2026-11-03', { title: 'Coll de Bracons', distanceM: 72_000, done: true, manual: true }));
    renderCalendario();

    const next = await screen.findByRole('region', { name: 'Próximos' });
    const rows = within(within(next).getByRole('list')).getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/Lluçanès por Prats/);
    expect(rows[0]).toHaveTextContent(/Mañana, 1320\sm de desnivel/);
    expect(rows[1]).toHaveTextContent(/En 2 días/);
    expect(screen.getByText(/1 de 3/)).toBeInTheDocument();
  });

  it('empty calendar invites to plan', async () => {
    renderCalendario();
    expect(await screen.findByRole('heading', { name: 'Aún no has planificado nada' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Planificar un entreno' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Próximos' })).not.toBeInTheDocument();
  });

  it('backup reminder', async () => {
    await saveWorkout(workout('w7', '2026-11-07'));
    renderCalendario();
    expect(await screen.findByText('Tu calendario tiene cambios sin copia.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Exportar copia' })).toHaveAttribute('href', '#/ajustes');
  });

  it('no backup reminder after a backup', async () => {
    await saveWorkout(workout('w7', '2026-11-07'));
    await setLastBackupAt(NOW + 1);
    renderCalendario();
    await screen.findByRole('region', { name: 'Próximos' });
    expect(screen.queryByText('Tu calendario tiene cambios sin copia.')).not.toBeInTheDocument();
  });
});
