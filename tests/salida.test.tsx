import { configure, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ANALYSIS_VERSION } from '../src/analysis/analysis';
import { App } from '../src/App';
import { db, type RouteSigRow } from '../src/db/db';
import { saveActivity } from '../src/db/repo';
import type { ClimbEffort, StoredActivity, TrackPoint } from '../src/domain/types';
import { synthClimbTrack } from './helpers/synth';

// Con la máquina cargada, la base y el análisis tardan más de 1 s en responder.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 15_000 });

// El análisis pendiente se simula: cada prueba elige su estado.
const analysis = vi.hoisted(() => ({
  state: { status: 'ready' } as { status: 'ready' } | { status: 'error' } | { status: 'running'; done: number; total: number },
}));
vi.mock('../src/ui/useAnalysis', () => ({ useAnalysis: () => analysis.state }));

// Viernes 6 de noviembre de 2026, 13:00 en Madrid.
const NOW = Date.parse('2026-11-06T12:00:00Z');

function ride(id: string, iso: string, opts: { name?: string; hasTrack?: boolean; km?: number; elev?: number; s?: number } = {}): StoredActivity {
  const distanceM = (opts.km ?? 40) * 1000;
  const movingTimeS = opts.s ?? 6000;
  return {
    id,
    startTime: Date.parse(iso),
    sport: 'cycling',
    name: opts.name,
    totals: {
      distanceM,
      movingTimeS,
      elapsedTimeS: movingTimeS + 300,
      elevGainM: opts.elev ?? 300,
      avgSpeedMs: distanceM / movingTimeS,
      maxSpeedMs: 15,
    },
    hasTrack: opts.hasTrack ?? true,
    source: 'gpx',
    importedAt: NOW,
  };
}

// 1 km llano, 2 km al 5 % y 1 km llano: la subida va de los índices 67 a 200 (un punto cada 15 m).
const TRACK = synthClimbTrack([
  { lengthM: 1000, gradePct: 0 },
  { lengthM: 2000, gradePct: 5 },
  { lengthM: 1000, gradePct: 0 },
]);

function effort(activityId: string, iso: string, timeS: number): ClimbEffort {
  return {
    id: `${activityId}_0`,
    activityId,
    activityStart: Date.parse(iso),
    startIdx: 67,
    endIdx: 200,
    start: { lat: 41.009, lng: 2.5 },
    end: { lat: 41.027, lng: 2.5 },
    startDistM: 1000,
    lengthM: 2000,
    gainM: 100,
    avgGradePct: 5,
    timeS,
    avgSpeedMs: 2000 / timeS,
    vamMh: 100 / (timeS / 3600),
  };
}

function sig(a: StoredActivity, cells: string[]): RouteSigRow {
  return { activityId: a.id, activityStart: a.startTime, distanceM: a.totals.distanceM, cells, analysisVersion: ANALYSIS_VERSION };
}

const CELLS = Array.from({ length: 10 }, (_, i) => `c${i}`);

async function seed(acts: StoredActivity[], opts: { efforts?: ClimbEffort[]; sigs?: RouteSigRow[]; tracks?: Record<string, TrackPoint[]> } = {}) {
  for (const a of acts) await saveActivity(a, opts.tracks?.[a.id] ?? (a.hasTrack ? TRACK : []));
  if (opts.efforts) await db.climbEfforts.bulkPut(opts.efforts);
  if (opts.sigs) await db.routeSigs.bulkPut(opts.sigs);
}

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

const r1 = ride('r1', '2026-11-05T08:12:00Z', { name: 'Vuelta al pantano' });

describe('Salida', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    analysis.state = { status: 'ready' };
    await Promise.all([db.activities.clear(), db.tracks.clear(), db.climbEfforts.clear(), db.routeSigs.clear()]);
  });
  afterEach(() => {
    vi.useRealTimers();
    window.location.hash = '';
  });

  it('shows stats map and profile', async () => {
    await seed([r1]);
    renderAt('#/historial/r1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Vuelta al pantano' })).toBeInTheDocument();
    expect(screen.getByText('Ayer, jueves 5 de noviembre, a las 9:12')).toBeInTheDocument();
    const figs = screen.getByRole('group', { name: 'Cifras de la salida' });
    expect(figs).toHaveTextContent('Distancia40,0 km');
    expect(figs).toHaveTextContent('Desnivel300 m');
    expect(figs).toHaveTextContent('Tiempo1 h 40');
    expect(figs).toHaveTextContent('Media24,0 km/h');
    expect(screen.getByRole('region', { name: 'Mapa de la salida' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Perfil de altitud/ })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Punto del perfil' })).toBeInTheDocument();
  });

  it('a long clamped name keeps the heading name clean', async () => {
    const name = 'Vuelta larguísima por el Montseny con Turó de l’Home, Santa Fe, Collformic y vuelta a casa por Collsuspina';
    await seed([ride('long', '2026-11-05T08:12:00Z', { name })]);
    const tall = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(500);
    try {
      renderAt('#/historial/long');
      const toggle = await screen.findByRole('button', { name, expanded: false });
      expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(name);
      await userEvent.click(toggle);
      expect(screen.getByRole('button', { name, expanded: true })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(name);
    } finally {
      tall.mockRestore();
    }
  });

  it('profile slider follows the keys', async () => {
    await seed([r1]);
    renderAt('#/historial/r1');
    const slider = await screen.findByRole('slider', { name: 'Punto del perfil' });
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringMatching(/^Cima: 200 m en el km 3,\d\./));
    slider.focus();
    await userEvent.keyboard('{Home}');
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringMatching(/^km 0,0: 100 metros/));
    await userEvent.keyboard('{End}');
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringMatching(/^km 4,0: 200 metros/));
  });

  it('ride without track shows no map', async () => {
    await seed([ride('r5', '2026-10-27T16:40:00Z', { hasTrack: false })]);
    renderAt('#/historial/r5');
    expect(await screen.findByRole('heading', { level: 1, name: 'Salida sin nombre' })).toBeInTheDocument();
    expect(screen.getByText('Esta salida no tiene GPS, así que no tiene mapa.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Mapa de la salida' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Subidas de esta salida' })).not.toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Punto del perfil' })).not.toBeInTheDocument();
  });

  it('lists climbs with time speed and vam', async () => {
    await seed([r1], { efforts: [effort('r1', '2026-11-05T08:12:00Z', 600)] });
    renderAt('#/historial/r1');
    const section = await screen.findByRole('region', { name: 'Subidas de esta salida' });
    const row = await within(section).findByRole('link', { name: /Del km 1,0 al 3,0/ });
    expect(row).toHaveTextContent('2,0 km al 5,0 %');
    expect(row).toHaveTextContent('10:00');
    expect(row).toHaveTextContent('12,0 km/h');
    expect(row).toHaveTextContent('VAM 600 m/h');
    expect(row).toHaveTextContent('La primera vez');
  });

  it('climb links to its passes', async () => {
    const r2 = ride('r2', '2026-11-01T08:00:00Z', { name: 'Otra vez' });
    await seed([r1, r2], { efforts: [effort('r1', '2026-11-05T08:12:00Z', 600), effort('r2', '2026-11-01T08:00:00Z', 540)] });
    renderAt('#/historial/r1');
    const section = await screen.findByRole('region', { name: 'Subidas de esta salida' });
    const row = await within(section).findByRole('link', { name: /Del km 1,0 al 3,0/ });
    expect(row).toHaveTextContent('Tu mejor en 2 pasadas: 9:00');
    expect(row).toHaveAttribute('href', '#/historial/subidas/r2_0');
  });

  it('no climbs message', async () => {
    await seed([r1]);
    renderAt('#/historial/r1');
    expect(await screen.findByText('Esta salida no tiene subidas de 1 km o más al 3 %.')).toBeInTheDocument();
  });

  it('links to repeated route', async () => {
    const a = ride('a', '2026-09-01T08:00:00Z', { s: 6600 });
    const b = ride('b', '2026-10-01T08:00:00Z', { s: 6300 });
    await seed([a, b, r1], { sigs: [sig(a, CELLS), sig(b, CELLS), sig(r1, CELLS)] });
    renderAt('#/historial/r1');
    const row = await screen.findByRole('link', { name: /Has hecho esta ruta 3 veces/ });
    expect(row).toHaveAttribute('href', '#/historial/repetidas/a');
    expect(row).toHaveTextContent('Esta vez 1 h 40, tu mejor tiempo');
    expect(screen.getByText('Tu mejor tiempo en esta ruta')).toBeInTheDocument();
  });

  it('lists similar routes', async () => {
    const costa = ride('costa', '2026-10-10T08:00:00Z', { name: 'Por la costa', km: 52.4 });
    const lejos = ride('lejos', '2026-10-11T08:00:00Z', { name: 'Muy lejos' });
    await seed([costa, lejos, r1], {
      sigs: [
        sig(r1, CELLS),
        sig(costa, [...CELLS.slice(0, 6), ...Array.from({ length: 8 }, (_, i) => `d${i}`)]),
        sig(lejos, ['x1', 'x2', 'x3']),
      ],
    });
    renderAt('#/historial/r1');
    const section = await screen.findByRole('region', { name: 'Rutas parecidas' });
    const row = await within(section).findByRole('link', { name: /Por la costa/ });
    expect(row).toHaveTextContent('Coincide en un 33 %');
    expect(row).toHaveTextContent('52,4');
    expect(row).toHaveAttribute('href', '#/historial/costa');
    expect(within(section).queryByText('Muy lejos')).not.toBeInTheDocument();
  });

  it('compares with your last 12 months', async () => {
    const others = [20, 30, 50, 60, 70].map((km, i) => ride(`o${i}`, `2026-10-0${i + 1}T08:00:00Z`, { km }));
    const old = ride('old', '2025-06-01T08:00:00Z', { km: 200 });
    await seed([...others, old, r1]);
    renderAt('#/historial/r1');
    const section = await screen.findByRole('region', { name: 'Frente a tu media' });
    expect(section).toHaveTextContent('La 3.ª más corta de tus 6 salidas en 12 meses. Tu media: 46,0 km.');
    expect(section).toHaveTextContent('−13 %');
    expect(within(section).getByRole('img', { name: /^Distancia: 40,0 km/ })).toBeInTheDocument();
  });

  it('unknown id shows not found', async () => {
    renderAt('#/historial/nada');
    expect(await screen.findByRole('heading', { name: 'No se encuentra la salida' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir al historial' })).toHaveAttribute('href', '#/historial');
  });

  it('shows analysis progress', async () => {
    analysis.state = { status: 'running', done: 3, total: 10 };
    await seed([r1]);
    renderAt('#/historial/r1');
    expect(await screen.findByText('Analizando salidas: 3 de 10')).toBeInTheDocument();
  });
});
