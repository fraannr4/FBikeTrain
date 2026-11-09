import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { db } from '../src/db/db';
import { saveActivity } from '../src/db/repo';
import { listGoals, saveGoal, saveWorkout } from '../src/calendar/calendarRepo';
import type { EventGoal, Goal, LocalDate, PlannedWorkout, StoredActivity, VolumeGoal } from '../src/domain/types';

// Sábado 7 de noviembre de 2026, 00:30 en Madrid. La semana va del lunes 2 al domingo 8.
const NOW = Date.parse('2026-11-06T23:30:00Z');
// Lunes 23 de noviembre, 00:00 en Madrid: han pasado 22 de los 30 días del mes.
const NOV_23 = Date.parse('2026-11-22T23:00:00Z');

function ride(id: string, iso: string, km: number, elevGainM = 0): StoredActivity {
  return {
    id,
    startTime: Date.parse(iso),
    sport: 'cycling',
    totals: { distanceM: km * 1000, movingTimeS: 6_000, elapsedTimeS: 6_500, elevGainM, avgSpeedMs: 8, maxSpeedMs: 14 },
    hasTrack: false,
    source: 'fit',
    importedAt: NOW,
  };
}

const event = (extra: Partial<EventGoal> = {}): EventGoal => ({
  kind: 'event',
  id: 'ev',
  title: 'Marcha',
  date: '2026-12-14',
  distanceM: 120_000,
  elevGainM: 2000,
  createdAt: 1,
  ...extra,
});

const volume = (extra: Partial<VolumeGoal> = {}): VolumeGoal => ({
  kind: 'volume',
  id: 'vol',
  title: 'Noviembre de 2026',
  period: 'month',
  start: '2026-11-01',
  distanceM: 400_000,
  createdAt: 1,
  ...extra,
});

const workout = (id: string, date: LocalDate, distanceM?: number): PlannedWorkout => ({
  id,
  date,
  title: 'Rodaje',
  distanceM,
  done: false,
  manual: false,
  createdAt: 1,
});

async function seed({ goals = [], rides = [], workouts = [] }: { goals?: Goal[]; rides?: StoredActivity[]; workouts?: PlannedWorkout[] }) {
  for (const g of goals) await saveGoal(g);
  for (const r of rides) await saveActivity(r, []);
  for (const w of workouts) await saveWorkout(w);
}

function renderObjetivos() {
  window.location.hash = '#/plan/objetivos';
  return render(<App />);
}

const sheet = (name: string) => screen.getByRole('dialog', { name });
const newGoal = async () => (await screen.findAllByRole('button', { name: 'Nuevo objetivo' }))[0];

async function openEventForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Una marcha o evento/ }));
  return within(sheet('Nuevo objetivo'));
}

async function openVolumeForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Volumen por semana o mes/ }));
  return within(sheet('Nuevo objetivo'));
}

describe('Objetivos', { timeout: 20_000 }, () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    await Promise.all(db.tables.map((t) => t.clear()));
  });
  afterEach(() => {
    vi.useRealTimers();
    window.location.hash = '';
  });

  describe('formulario', () => {
    it('creates goal', async () => {
      const user = userEvent.setup();
      renderObjetivos();
      const form = await openEventForm(user);
      expect(form.getByRole('tab', { name: 'Evento' })).toHaveAttribute('aria-selected', 'true');
      await user.type(form.getByLabelText('Nombre'), 'Marcha');
      fireEvent.change(form.getByLabelText('Fecha'), { target: { value: '2026-12-14' } });
      await user.type(form.getByLabelText('Distancia'), '120');
      await user.type(form.getByLabelText('Desnivel'), '2.000');
      await user.click(screen.getByRole('button', { name: 'Crear objetivo' }));
      await waitFor(async () => expect(await listGoals()).toHaveLength(1));
      expect((await listGoals())[0]).toMatchObject({
        kind: 'event',
        title: 'Marcha',
        date: '2026-12-14',
        distanceM: 120_000,
        elevGainM: 2000,
      });
    });

    it('goal requires name and distance or elevation', async () => {
      const user = userEvent.setup();
      renderObjetivos();
      const form = await openEventForm(user);
      await user.click(screen.getByRole('button', { name: 'Crear objetivo' }));
      expect(form.getByText('Ponle un nombre para reconocerlo en la cuenta atrás.')).toBeInTheDocument();
      await user.type(form.getByLabelText('Nombre'), 'Marcha');
      await user.click(screen.getByRole('button', { name: 'Crear objetivo' }));
      expect(form.getByText('Pon al menos una cifra: distancia o desnivel.')).toBeInTheDocument();
      expect(await listGoals()).toHaveLength(0);
    });

    it('goal form switches to volume', async () => {
      const user = userEvent.setup();
      renderObjetivos();
      const form = await openEventForm(user);
      expect(form.getByLabelText('Fecha')).toBeInTheDocument();
      await user.click(form.getByRole('tab', { name: 'Volumen' }));
      expect(form.getByRole('group', { name: 'Cada' })).toBeInTheDocument();
      expect(form.getByLabelText('Horas')).toBeInTheDocument();
      expect(form.queryByLabelText('Fecha')).not.toBeInTheDocument();
    });

    it('creates monthly volume goal', async () => {
      const user = userEvent.setup();
      renderObjetivos();
      const form = await openVolumeForm(user);
      expect(form.getByRole('tab', { name: 'Volumen' })).toHaveAttribute('aria-selected', 'true');
      await user.click(within(form.getByRole('group', { name: 'Cada' })).getByRole('button', { name: 'Mes' }));
      fireEvent.change(form.getByLabelText('Mes'), { target: { value: '2026-11' } });
      await user.type(form.getByLabelText('Distancia'), '400');
      await user.click(screen.getByRole('button', { name: 'Crear objetivo' }));
      await waitFor(async () => expect(await listGoals()).toHaveLength(1));
      expect((await listGoals())[0]).toMatchObject({
        kind: 'volume',
        period: 'month',
        start: '2026-11-01',
        distanceM: 400_000,
      });
    });

    it('weekly volume goal starts on monday', async () => {
      const user = userEvent.setup();
      renderObjetivos();
      const form = await openVolumeForm(user);
      fireEvent.change(form.getByLabelText('Semana del'), { target: { value: '2026-12-03' } });
      await user.type(form.getByLabelText('Desnivel'), '5000');
      await user.click(screen.getByRole('button', { name: 'Crear objetivo' }));
      await waitFor(async () => expect(await listGoals()).toHaveLength(1));
      expect((await listGoals())[0]).toMatchObject({ kind: 'volume', period: 'week', start: '2026-11-30', elevGainM: 5000 });
    });

    it('volume time goal is saved in seconds', async () => {
      const user = userEvent.setup();
      renderObjetivos();
      const form = await openVolumeForm(user);
      await user.type(form.getByLabelText('Horas'), '7');
      await user.type(form.getByLabelText('Minutos'), '30');
      await user.click(screen.getByRole('button', { name: 'Crear objetivo' }));
      await waitFor(async () => expect(await listGoals()).toHaveLength(1));
      expect((await listGoals())[0]).toMatchObject({ period: 'week', start: '2026-11-02', movingTimeS: 27_000 });
    });

    it('volume goal requires a target', async () => {
      const user = userEvent.setup();
      renderObjetivos();
      const form = await openVolumeForm(user);
      await user.click(screen.getByRole('button', { name: 'Crear objetivo' }));
      expect(form.getByText('Pon al menos una cifra: distancia, desnivel o tiempo.')).toBeInTheDocument();
      expect(await listGoals()).toHaveLength(0);
    });

    it('new goal for a taken period replaces it', async () => {
      const user = userEvent.setup();
      await seed({ goals: [volume({ id: 'w', period: 'week', start: '2026-11-02', distanceM: 250_000 })] });
      renderObjetivos();
      await user.click(await newGoal());
      const form = within(sheet('Nuevo objetivo'));
      await user.click(form.getByRole('tab', { name: 'Volumen' }));
      await user.click(within(form.getByRole('group', { name: 'Cada' })).getByRole('button', { name: 'Semana' }));
      expect(form.getByText(/Ya tienes un objetivo para esta semana: 250 km\. Este lo sustituye\./)).toBeInTheDocument();
      await user.type(form.getByLabelText('Distancia'), '300');
      await user.click(screen.getByRole('button', { name: 'Sustituir objetivo' }));
      await waitFor(async () => expect((await listGoals()).map((g) => g.kind === 'volume' && g.distanceM)).toEqual([300_000]));
    });

    it('edits and deletes goal', async () => {
      const user = userEvent.setup();
      await seed({ goals: [volume()] });
      renderObjetivos();
      await user.click(await screen.findByRole('button', { name: 'Editar el objetivo de noviembre' }));
      const form = within(sheet('Editar objetivo'));
      const km = form.getByLabelText('Distancia');
      expect(km).toHaveValue('400');
      await user.clear(km);
      await user.type(km, '500');
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
      await waitFor(async () => expect((await listGoals())[0]).toMatchObject({ id: 'vol', distanceM: 500_000 }));

      await user.click(await screen.findByRole('button', { name: 'Editar el objetivo de noviembre' }));
      await user.click(within(sheet('Editar objetivo')).getByRole('button', { name: 'Borrar objetivo' }));
      await waitFor(async () => expect(await listGoals()).toHaveLength(0));
      await user.click(await screen.findByRole('button', { name: 'Deshacer' }));
      await waitFor(async () => expect(await listGoals()).toHaveLength(1));
    });
  });

  describe('evento', () => {
    it('shows goal progress', async () => {
      const user = userEvent.setup();
      await seed({
        goals: [event()],
        rides: [ride('r1', '2026-10-03T08:00:00Z', 96, 1440)],
        workouts: [workout('w1', '2026-11-14'), workout('w2', '2026-12-05')],
      });
      renderObjetivos();
      const card = within(await screen.findByRole('region', { name: 'Tu próximo evento' }));
      expect(card.getByText('Faltan 37 días:')).toBeInTheDocument();
      expect(card.getByText('Marcha')).toBeInTheDocument();
      expect(card.getByText('Lunes 14 de diciembre · 120 km, 2000 m')).toBeInTheDocument();
      expect(card.getByText(/Tu salida más larga:/)).toHaveTextContent('Tu salida más larga: 96 de 120 km');

      const row = card.getByRole('button', { name: /^Faltan 37 días: Marcha/ });
      expect(row).toHaveAttribute('aria-expanded', 'false');
      await user.click(row);
      expect(row).toHaveAttribute('aria-expanded', 'true');
      expect(card.getByRole('img', { name: 'Tu salida más larga, 96 km, es el 80 % de la distancia de la marcha' })).toBeInTheDocument();
      expect(card.getByRole('img', { name: 'Tu salida con más desnivel, 1440 m, es el 72 % del desnivel de la marcha' })).toBeInTheDocument();
      expect(card.getByRole('link', { name: '2 entrenos planificados hasta la marcha' })).toHaveAttribute('href', '#/plan');
    });

    it('past goal shows days since', async () => {
      await seed({ goals: [event({ date: '2026-11-04' })] });
      renderObjetivos();
      const card = within(await screen.findByRole('region', { name: 'Tu próximo evento' }));
      expect(card.getByText('Ya pasó:')).toBeInTheDocument();
      expect(card.getByText('Fue el miércoles 4 de noviembre, hace 3 días. Pon el siguiente.')).toBeInTheDocument();
    });
  });

  describe('volumen', () => {
    it('shows volume progress ahead', async () => {
      vi.setSystemTime(NOV_23);
      await seed({ goals: [volume()], rides: [ride('r1', '2026-11-10T08:00:00Z', 212), ride('r2', '2026-11-20T08:00:00Z', 100)] });
      renderObjetivos();
      const card = within(await screen.findByRole('article', { name: 'Noviembre' }));
      expect(
        card.getByRole('img', { name: 'Distancia: 312 km de 400 km, el 78 %. El ritmo para llegar a tiempo es el 73 %.' }),
      ).toBeInTheDocument();
      expect(card.getByText(/por delante del ritmo/)).toHaveTextContent('19 km por delante del ritmo');
      expect(card.getByText('Quedan 8 días')).toBeInTheDocument();
    });

    it('shows volume progress behind', async () => {
      vi.setSystemTime(NOV_23);
      await seed({ goals: [volume()], rides: [ride('r1', '2026-11-10T08:00:00Z', 200)] });
      renderObjetivos();
      const card = within(await screen.findByRole('article', { name: 'Noviembre' }));
      expect(card.getByText(/por detrás del ritmo/)).toHaveTextContent('93 km por detrás del ritmo');
    });

    it('volume goal with two targets shows one line each', async () => {
      vi.setSystemTime(NOV_23);
      await seed({
        goals: [volume({ elevGainM: 5000 })],
        rides: [ride('r1', '2026-11-10T08:00:00Z', 212, 2000), ride('r2', '2026-11-20T08:00:00Z', 100, 1000)],
      });
      renderObjetivos();
      const card = within(await screen.findByRole('article', { name: 'Noviembre' }));
      expect(card.getByText('Objetivo: 400 km y 5000 m en el mes.')).toBeInTheDocument();
      expect(card.getByRole('img', { name: /^Distancia: 312 km de 400 km/ })).toBeInTheDocument();
      expect(
        card.getByRole('img', { name: 'Desnivel: 3000 m de 5000 m, el 60 %. El ritmo para llegar a tiempo es el 73 %.' }),
      ).toBeInTheDocument();
    });

    it('future volume goal shows start', async () => {
      await seed({ goals: [volume({ start: '2026-12-01', title: 'Diciembre de 2026' })] });
      renderObjetivos();
      const card = within(await screen.findByRole('article', { name: 'Diciembre' }));
      expect(card.getByText('Empieza en 24 días')).toBeInTheDocument();
      expect(card.queryByText(/ritmo/)).not.toBeInTheDocument();
    });

    it('reached goal says by how much', async () => {
      await seed({
        goals: [volume({ id: 'w', period: 'week', start: '2026-11-02', distanceM: 100_000 })],
        rides: [ride('r1', '2026-11-03T08:00:00Z', 150)],
      });
      renderObjetivos();
      const card = within(await screen.findByRole('article', { name: 'Esta semana' }));
      expect(card.getByText('Conseguido')).toBeInTheDocument();
      expect(card.getByText(/por encima del objetivo/)).toHaveTextContent('50 km por encima del objetivo');
      expect(card.getByText('Del 2 al 8 de noviembre. Objetivo: 100 km.')).toBeInTheDocument();
    });

    it('planned workouts tell where you get', async () => {
      await seed({
        goals: [volume({ id: 'w', period: 'week', start: '2026-11-02', distanceM: 250_000 })],
        rides: [ride('r1', '2026-11-03T08:00:00Z', 160)],
        workouts: [workout('p1', '2026-11-08', 86_000), workout('p0', '2026-11-05', 50_000)],
      });
      renderObjetivos();
      const card = within(await screen.findByRole('article', { name: 'Esta semana' }));
      expect(card.getByText(/Con lo planificado/)).toHaveTextContent('Con lo planificado llegas a 246 km');
    });
  });

  it('lists previous goals', async () => {
    await seed({
      goals: [volume({ id: 'oct', start: '2026-10-01', distanceM: 800_000 }), volume({ id: 'now' })],
      rides: [ride('r1', '2026-10-10T08:00:00Z', 416), ride('r2', '2026-10-20T08:00:00Z', 400)],
    });
    renderObjetivos();
    const prev = within(await screen.findByRole('region', { name: 'Anteriores' }));
    expect(prev.getByText('Octubre')).toBeInTheDocument();
    expect(prev.getByText('816 de 800 km, conseguido')).toBeInTheDocument();
    expect(prev.getByText('102')).toBeInTheDocument();
  });

  it('no goals invites to set one', async () => {
    renderObjetivos();
    expect(await screen.findByRole('heading', { name: 'Ponte un objetivo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Una marcha o evento/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Volumen por semana o mes/ })).toBeInTheDocument();
  });
});
