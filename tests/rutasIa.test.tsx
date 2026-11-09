import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import { DECLARED_REFERENCE_KEY } from '../src/ai/levelSummary';
import { runAiRoutes, type AiRoute, type AiRoutesResult } from '../src/ai/routePlanner';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { App } from '../src/App';
import { AccountContext } from '../src/auth/AccountBoundary';
import { aiShown } from '../src/ui/components/AiRoutes';
import { TrendingDown, TrendingUp } from '../src/ui/icons';
import { db } from '../src/db/db';
import { saveActivity } from '../src/db/repo';
import type { Coord3, LatLng, StoredActivity } from '../src/domain/types';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/settings/settings';
import { forgetAiRoutes } from '../src/ui/pages/RutasIa';

// La IA y ORS nunca se llaman: `runAiRoutes` se simula. El mapa de Leaflet se sustituye por un doble.
vi.mock('../src/ai/routePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ai/routePlanner')>()),
  runAiRoutes: vi.fn(),
}));
vi.mock('../src/routes/history', () => ({ loadVisitedCells: vi.fn(async () => new Set<string>()) }));
vi.mock('../src/ui/components/StartPointCanvas', () => ({
  StartPointCanvas: ({ onChange }: { onChange: (p: LatLng) => void }) => (
    <button type="button" onClick={() => onChange({ lat: 40.45, lng: -3.69 })}>
      Elegir un punto de prueba
    </button>
  ),
}));

// Puntos sintéticos y públicos: la Puerta del Sol como Casa.
const SOL: LatLng = { lat: 40.4168, lng: -3.7038 };
const NOW = Date.parse('2026-11-06T12:00:00Z');
const DAY = 86_400_000;
const run = runAiRoutes as unknown as Mock<typeof runAiRoutes>;

function ride(i: number): StoredActivity {
  const distanceM = 50_000;
  return {
    id: `r-${i}`,
    startTime: NOW - (i + 1) * 3 * DAY,
    sport: 'cycling',
    totals: { distanceM, movingTimeS: distanceM / 7, elapsedTimeS: distanceM / 6, elevGainM: 800, avgSpeedMs: 7, maxSpeedMs: 15 },
    hasTrack: false,
    source: 'gpx',
    importedAt: NOW,
  };
}

async function seed({ llmKey = 'llm-key', model = 'openai/gpt-oss-20b', rides = 5 } = {}) {
  await saveSettings({
    ...structuredClone(DEFAULT_SETTINGS),
    home: SOL,
    ors: { apiKey: 'test-key' },
    llm: { baseUrl: 'https://api.groq.com/openai/v1', apiKey: llmKey, model },
  });
  for (let i = 0; i < rides; i++) await saveActivity(ride(i), []);
}

function coords(dyKm: number): Coord3[] {
  return Array.from({ length: 41 }, (_, i) => {
    const t = (i / 40) * Math.PI * 2;
    return [SOL.lng + (Math.sin(t) * 4) / 85, SOL.lat + (dyKm - Math.cos(t) * 4) / 111, 650 + 40 * Math.sin(t)];
  });
}

function aiRoute(i: number, over: Partial<AiRoute> = {}): AiRoute {
  return {
    id: `route-${i}`,
    seed: i,
    coords: coords(4 + i),
    distanceM: 54_000 + i * 1000,
    elevGainM: 820 + i * 10,
    unpavedM: 0,
    trackM: 0,
    mainRoadPct: 0,
    unknownSurfacePct: 0,
    steep: [{ fromM: 0, toM: 54_000, cls: 2 }],
    profile: Array.from({ length: 21 }, (_, k) => ({ dM: k * 2700, ele: 650 + 40 * Math.sin(k / 3) })),
    maxSteepCls: 2,
    newPct: 74,
    score: 0.9 - i / 10,
    difficulty: 'Media',
    estTimeS: 7800,
    titulo: `Opción ${i + 1}`,
    explicacion: `54 km y 820 m: la opción ${i + 1} sube un poco tu salida habitual.`,
    upliftPct: 8,
    dimension: 'distancia',
    limitadoPorTiempo: false,
    ...over,
  };
}

function renderIa() {
  window.location.hash = '#/rutas/ia';
  return render(<App />);
}

// Margen amplio: el primer pintado (carga de Dexie y de la pantalla) es lento en una máquina ocupada.
const question = (name: string) => screen.findByRole('heading', { level: 1, name }, { timeout: 5000 });

/** Contesta las cuatro preguntas: Fondo, 2 h, Casa y Descubrir. Acaba en el resumen. */
async function answerAll() {
  const user = userEvent.setup();
  await question('¿Qué quieres entrenar?');
  await user.click(screen.getByRole('radio', { name: /Fondo/ }));
  await question('¿Cuánto tiempo tienes?');
  await user.click(screen.getByRole('radio', { name: /^2 h/ }));
  await question('¿Desde dónde sales?');
  await user.click(screen.getByRole('radio', { name: /Casa/ }));
  await question('¿Repetir zona o descubrir?');
  await user.click(screen.getByRole('radio', { name: /Descubrir/ }));
  await question('Tu petición');
  return user;
}

async function ask(result: AiRoutesResult) {
  run.mockResolvedValue(result);
  renderIa();
  const user = await answerAll();
  await user.click(screen.getByRole('button', { name: /Pedir rutas a la IA/ }));
  return user;
}

// Flujos de cuatro preguntas con userEvent: varios segundos cada uno.
describe('Rutas con IA', { timeout: 20_000 }, () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    run.mockReset();
    forgetAiRoutes();
    await Promise.all([db.activities.clear(), db.tracks.clear(), db.settings.clear(), db.meta.clear(), db.climbEfforts.clear(), db.referenceRoutes.clear()]);
  });
  afterEach(() => {
    vi.useRealTimers();
    window.location.hash = '';
  });

  it('asks llm key and model when missing', async () => {
    await seed({ llmKey: '' });
    const { unmount } = renderIa();
    expect(await screen.findByText(/Configura la IA en Ajustes/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ir a Ajustes/ })).toHaveAttribute('href', '#/ajustes?abrir=claves');
    expect(screen.getByRole('link', { name: 'Generar sin IA' })).toHaveAttribute('href', '#/rutas');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    unmount();

    await seed({ model: '', rides: 0 });
    renderIa();
    expect(await screen.findByText(/Configura la IA en Ajustes/)).toBeInTheDocument();
  });

  it('initial questions below 5 rides', async () => {
    await seed({ rides: 2 });
    renderIa();
    expect(await screen.findByText('¿Cuántos km sueles hacer en una salida?')).toBeInTheDocument();
    expect(screen.getByText('¿Cuánto desnivel sueles subir en una salida?')).toBeInTheDocument();
    expect(screen.getByText('¿A qué velocidad media sueles ir?')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Más distancia' }));
    await user.click(screen.getByRole('button', { name: 'Guardar y seguir' }));
    expect(await question('¿Qué quieres entrenar?')).toBeInTheDocument();
    const saved = await db.meta.get(DECLARED_REFERENCE_KEY);
    expect(saved?.value).toEqual({ kmPorSalida: 55, desnivelPorSalidaM: 600, velocidadMediaKmh: 25 });
  });

  it('guided questions in order', async () => {
    await seed();
    renderIa();
    const user = userEvent.setup();
    expect(await question('¿Qué quieres entrenar?')).toBeInTheDocument();
    expect(screen.getByText('Paso 1 de 5')).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => r.querySelector('.opt-t')?.textContent)).toEqual(['Fondo', 'Subidas', 'Mixto']);
    await user.click(screen.getByRole('radio', { name: /Subidas/ }));

    expect(await question('¿Cuánto tiempo tienes?')).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => r.querySelector('.opt-t')?.textContent)).toEqual([
      '1 h',
      '1 h 30 min',
      '2 h',
      '3 h',
      '4 h',
      'Otro tiempo',
    ]);
    // «Otro tiempo» no avanza solo: pide los minutos.
    await user.click(screen.getByRole('radio', { name: /Otro tiempo/ }));
    await user.type(screen.getByRole('spinbutton', { name: 'Minutos' }), '150');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));

    expect(await question('¿Desde dónde sales?')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Casa/ })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Un punto del mapa/ }));
    await user.click(screen.getByRole('button', { name: 'Elegir un punto de prueba' }));
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));

    expect(await question('¿Repetir zona o descubrir?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(await question('¿Desde dónde sales?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await user.click(await screen.findByRole('radio', { name: /Repetir zona/ }));

    expect(await question('Tu petición')).toBeInTheDocument();
    const answers = screen.getByRole('list', { name: 'Tus respuestas' });
    expect(within(answers).getByText('Subidas')).toBeInTheDocument();
    expect(within(answers).getByText('2 h 30 min')).toBeInTheDocument();
    expect(within(answers).getByText('Un punto del mapa')).toBeInTheDocument();
    expect(within(answers).getByText('Repetir zona')).toBeInTheDocument();
  });

  it('notes field warns about addresses', async () => {
    await seed();
    renderIa();
    await answerAll();
    const notes = screen.getByRole('textbox', { name: /Algo más/ });
    expect(notes).toHaveAttribute('maxLength', '200');
    expect(screen.getByText('No escribas direcciones: este texto se envía a la IA.')).toBeInTheDocument();
    // Las dos cifras con el mismo formato: sin punto de millar por debajo de 10.000.
    expect(screen.getByText(/^Consultas ORS hoy: \d+ de 2000\./)).toBeInTheDocument();
  });

  it('shows what the ai sees, without home', async () => {
    await seed();
    renderIa();
    await answerAll();
    const card = screen.getByRole('region', { name: 'Lo que verá la IA' });
    expect(within(card).getByText(/50 km/)).toBeInTheDocument();
    expect(within(card).getByText(/Nunca verá tus tracks GPS, dónde está Casa/)).toBeInTheDocument();
  });

  it('sends answers without the start point', async () => {
    await seed();
    await ask({ kind: 'routes', routes: [aiRoute(0)], warnings: [] });
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const [input, deps] = run.mock.calls[0];
    expect(input.answers).toEqual({ focus: 'fondo', minutes: 120, explore: 'descubrir', notes: '' });
    expect(input.start).toEqual(SOL);
    expect(JSON.stringify(input.answers)).not.toContain('40.4');
    expect(JSON.stringify(input.summary)).not.toContain('40.4');
    expect(deps.orsKey).toBe('test-key');
  });

  it('with the shared road service it does not ask for the ORS key and searches through it', async () => {
    await seed();
    await saveSettings({ ...(await loadSettings()), ors: { apiKey: '' } });
    vi.stubEnv('VITE_SHARED_ORS_ENABLED', 'true');
    try {
      run.mockResolvedValue({ kind: 'routes', routes: [aiRoute(0)], warnings: [] });
      window.location.hash = '#/rutas/ia';
      const account = { client: {} as SupabaseClient, user: { id: 'u1' } as User };
      render(<AccountContext.Provider value={account}><App /></AccountContext.Provider>);
      const user = await answerAll();
      expect(screen.queryByText(/Falta tu clave de rutas/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Consultas ORS hoy/)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Pedir rutas a la IA/ }));
      await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
      expect(run.mock.calls[0][1].orsKey).toMatchObject({ kind: 'shared' });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('shows thinking state while waiting', async () => {
    await seed();
    run.mockReturnValue(new Promise(() => {}));
    renderIa();
    const user = await answerAll();
    await user.click(screen.getByRole('button', { name: /Pedir rutas a la IA/ }));
    expect(await screen.findByText('Pensando objetivos…')).toBeInTheDocument();
    expect(screen.getByText('Buscando carreteras…')).toBeInTheDocument();
  });

  it('cancel while waiting returns to the summary with answers kept', async () => {
    await seed();
    run.mockReturnValue(new Promise(() => {}));
    renderIa();
    const user = await answerAll();
    await user.click(screen.getByRole('button', { name: /Pedir rutas a la IA/ }));
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(await question('Tu petición')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Tus respuestas' })).getByText('Fondo')).toBeInTheDocument();
  });

  it('shows routes with explanation and uplift', async () => {
    await seed();
    await ask({ kind: 'routes', routes: [aiRoute(0), aiRoute(1), aiRoute(2)], warnings: [] });
    expect(await screen.findByRole('heading', { level: 1, name: '3 rutas para hoy' })).toBeInTheDocument();
    const first = screen.getByRole('article', { name: /Opción 1/ });
    expect(within(first).getByText(/la opción 1 sube un poco/)).toBeInTheDocument();
    expect(within(first).getByText('+8 % frente a tu referencia en distancia')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exportar GPX de Opción 1, ruta 1 de 3/ })).toBeInTheDocument();
  });

  it('saves an ai route in the library to splice it', async () => {
    await seed();
    const user = await ask({ kind: 'routes', routes: [aiRoute(0), aiRoute(1)], warnings: [] });
    const first = await screen.findByRole('article', { name: /Opción 1/ });
    const name = within(first).getByRole('heading').getAttribute('title') ?? '';
    await user.click(screen.getByRole('button', { name: `Guardar «${name}» en la biblioteca` }));
    await waitFor(async () => expect(await db.referenceRoutes.count()).toBe(1));
    const [saved] = await db.referenceRoutes.toArray();
    expect(saved).toMatchObject({ name, format: 'gpx', sourceFileName: 'ruta-54km-820m.gpx' });
    expect(saved.points).toHaveLength(41);
    await user.click(screen.getByRole('button', { name: 'Empalmar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Empalmar dos rutas' })).toBeInTheDocument();
  });

  it('opens the map of an ai route with its full title', async () => {
    await seed();
    const user = await ask({ kind: 'routes', routes: [aiRoute(0), aiRoute(1)], warnings: [] });
    const first = await screen.findByRole('article', { name: /Opción 1/ });
    const name = within(first).getByRole('heading').getAttribute('title') ?? '';
    await user.click(within(first).getByRole('button', { name: `Ver ${name} en el mapa` }));
    const sheet = await screen.findByRole('dialog', { name });
    expect(within(sheet).getByRole('region', { name: `Mapa de ${name}` })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Exportar GPX' })).toBeInTheDocument();
  });

  it('shows time-limited note', async () => {
    await seed();
    await ask({ kind: 'routes', routes: [aiRoute(0, { limitadoPorTiempo: true })], warnings: [] });
    const card = await screen.findByRole('article', { name: /Opción 1/ });
    expect(within(card).getByText('Limitada por tu tiempo disponible')).toBeInTheDocument();
  });

  it('fallback shows prefilled manual form', async () => {
    await seed();
    await ask({
      kind: 'fallback',
      message: 'La IA no ha devuelto un plan válido. Ajusta la ruta a mano.',
      cause: 'invalid_json',
      suggested: { distanceM: 55_000, elevGainM: 900, preferNew: true },
    });
    expect(await screen.findByText('La IA no ha devuelto un plan válido. Ajusta la ruta a mano.')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Distancia' })).getByText('55')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Desnivel' })).getByText('900')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Priorizar carretera nueva' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: /Generar 5 rutas/ })).toBeInTheDocument();
  });

  it('rate limit shows wait and manual form', async () => {
    await seed();
    const message = 'Has llegado al límite del proveedor de IA. Vuelve a probar en 30 s.';
    await ask({ kind: 'fallback', message, cause: 'rate_limit', suggested: { distanceM: 55_000, elevGainM: null, preferNew: true } });
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Distancia' })).toBeInTheDocument();
  });

  it('a rejected key offers a link to review it', async () => {
    await seed();
    const message = 'El proveedor de IA rechaza la clave. Revísala en Ajustes.';
    await ask({ kind: 'fallback', message, cause: 'unauthorized', suggested: { distanceM: 55_000, elevGainM: null, preferNew: true } });
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Revisar la clave/ })).toHaveAttribute('href', '#/ajustes?abrir=claves');
  });

  it('a rate limit does not send to Ajustes', async () => {
    await seed();
    const message = 'Has llegado al límite del proveedor de IA. Vuelve a probar en 30 s.';
    await ask({ kind: 'fallback', message, cause: 'rate_limit', suggested: { distanceM: 55_000, elevGainM: null, preferNew: true } });
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Revisar la clave/ })).not.toBeInTheDocument();
  });

  it('the difference arrow follows its sign', () => {
    const [up, down] = aiShown([aiRoute(0, { upliftPct: 8 }), aiRoute(1, { upliftPct: -9 })]);
    expect(up.card.notes?.[0]).toMatchObject({ icon: TrendingUp, text: expect.stringContaining('8 % frente a tu referencia en distancia') });
    expect(down.card.notes?.[0]).toMatchObject({ icon: TrendingDown, text: expect.stringContaining('9 % frente a tu referencia en distancia') });
  });

  it('shows warnings', async () => {
    await seed();
    await ask({ kind: 'routes', routes: [aiRoute(0)], warnings: ['No hay ruta de asfalto para "Opción 2".'] });
    expect(await screen.findByText('No hay ruta de asfalto para "Opción 2".')).toBeInTheDocument();
  });
});
