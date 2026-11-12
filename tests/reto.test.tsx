import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { clearAllData } from '../src/db/repo';
import { db } from '../src/db/db';
import type { StoredActivity } from '../src/domain/types';
import type { ChallengeResult } from '../src/social/challenges';
import type { ProfileCard } from '../src/social/friends';
import { Reto } from '../src/ui/pages/Reto';
import { Retos } from '../src/ui/pages/Retos';

vi.mock('../src/ui/components/RideMap', () => ({ RideMap: ({ label }: { label: string }) => <div>{label}</div> }));

const ana: ProfileCard = { id: 'p2', username: 'ana_ruta', display_name: 'Ana Ruta', locality: null, distance_km: null };
const CREATED = '2026-11-01T09:00:00Z';
const DEADLINE = '2026-12-01T09:00:00Z';
const res = (over: Partial<ChallengeResult> = {}): ChallengeResult => ({
  activity_date: '2026-11-05', moving_time_s: 5400, distance_m: 42000, avg_speed_ms: 7.78, elev_gain_m: 600, vam_mh: 400, ...over,
});

type Status = 'pending' | 'accepted' | 'declined' | 'finished' | 'expired';
function row(over: { id?: string; status?: Status; i_am_challenger?: boolean; route_name?: string; mine?: ChallengeResult | null; theirs?: ChallengeResult | null } = {}) {
  const { mine = null, theirs = null, ...challenge } = over;
  return {
    challenge: {
      id: 'r1', status: 'pending', route_name: 'Vuelta sintética', route_points: [[41.6, 2.29, 100], [41.61, 2.3, 120]], distance_m: 42000,
      elev_gain_m: 610, deadline: DEADLINE, created_at: CREATED, i_am_challenger: false, ...challenge,
    },
    rival: ana,
    mine,
    theirs,
  };
}

type Handler = (args?: Record<string, unknown>) => { data?: unknown; error?: { message: string } | null };
function fakeClient(rows: ReturnType<typeof row>[], handlers: Record<string, Handler> = {}) {
  const state = { rows };
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === 'list_challenges') return { data: state.rows, error: null };
    const r = handlers[fn]?.(args) ?? {};
    return { data: r.data ?? null, error: r.error ?? null };
  });
  return { client: { rpc } as unknown as SupabaseClient, rpc, state };
}

function renderAt(client: SupabaseClient, path: string) {
  return render(
    <AccountContext.Provider value={{ client, user: { id: 'u1' } as User }}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/retos" element={<Retos />} />
          <Route path="/retos/:id" element={<Reto />} />
        </Routes>
      </MemoryRouter>
    </AccountContext.Provider>,
  );
}

function activity(id: string, startTime: string, km: number, name: string): StoredActivity {
  const distanceM = km * 1000;
  return {
    id, startTime: Date.parse(startTime), sport: 'cycling', name, hasTrack: true, source: 'gpx', importedAt: 0,
    totals: { distanceM, movingTimeS: 5600, elapsedTimeS: 6000, elevGainM: 605, avgSpeedMs: distanceM / 5600, maxSpeedMs: 15 },
  };
}

const calls = (rpc: ReturnType<typeof vi.fn>, fn: string) => rpc.mock.calls.filter((c) => c[0] === fn);

beforeEach(async () => {
  await clearAllData();
});

describe('Retos', () => {
  it('lista los retos con su estado, el rival y el plazo', async () => {
    const { client } = fakeClient([
      row({ id: 'r1', status: 'pending' }),
      row({ id: 'r2', status: 'finished', route_name: 'Puerto sintético', i_am_challenger: true }),
      row({ id: 'r3', status: 'expired', route_name: 'Costa sintética' }),
    ]);
    renderAt(client, '/retos');
    const first = (await screen.findByRole('link', { name: /Vuelta sintética/ })).closest('li')!;
    expect(within(first).getByText('Pendiente')).toBeInTheDocument();
    expect(within(first).getByText('Te reta Ana Ruta')).toBeInTheDocument();
    expect(within(first).getByText('Plazo: 1 de diciembre')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Puerto sintético/ })).toHaveAttribute('href', '/retos/r2');
    expect(screen.getByText('Retas a Ana Ruta')).toBeInTheDocument();
    expect(screen.getByText('Terminado')).toBeInTheDocument();
    expect(screen.getByText('Caducado')).toBeInTheDocument();
  });

  it('sin retos invita a retar desde Amigos', async () => {
    renderAt(fakeClient([]).client, '/retos');
    expect(await screen.findByText('Sin retos todavía')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Amigos' })).toHaveAttribute('href', '/amigos');
  });
});

describe('Reto', () => {
  it('si me retaron y está pendiente, aceptar llama a respond_challenge', async () => {
    const { client, rpc, state } = fakeClient([row()], {
      respond_challenge: () => {
        state.rows = [row({ status: 'accepted' })];
        return {};
      },
    });
    renderAt(client, '/retos/r1');
    expect(await screen.findByText('Mapa de la ruta del reto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar GPX' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(rpc).toHaveBeenCalledWith('respond_challenge', { challenge_id: 'r1', accept: true });
    expect(await screen.findByRole('button', { name: 'Usar una salida' })).toBeInTheDocument();
  });

  it('elegir una salida envía solo sus cifras, nunca el track', async () => {
    await db.activities.bulkPut([
      activity('antes', '2026-10-20T09:00:00Z', 42, 'Salida de antes del reto'),
      activity('corta', '2026-11-04T09:00:00Z', 25, 'Salida corta'),
      activity('buena', '2026-11-05T09:00:00Z', 42.3, 'Salida buena'),
    ]);
    await db.tracks.put({ activityId: 'buena', points: [{ t: 0, lat: 41.6, lng: 2.29, ele: 100, dist: 0 }] } as never);
    const { client, rpc } = fakeClient([row({ status: 'accepted' })], { submit_challenge_result: () => ({}) });
    renderAt(client, '/retos/r1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Usar una salida' }));
    const sheet = await screen.findByRole('dialog', { name: 'Elige tu salida' });
    expect(within(sheet).queryByText('Salida de antes del reto')).not.toBeInTheDocument();
    const options = within(sheet).getAllByRole('listitem');
    expect(within(options[0]).getByText('Salida buena')).toBeInTheDocument();
    expect(within(options[1]).getByText('Esta salida es bastante más corta que la ruta del reto')).toBeInTheDocument();
    await user.click(within(options[0]).getByRole('button', { name: 'Usar esta salida: Salida buena' }));
    const [[, args]] = calls(rpc, 'submit_challenge_result') as unknown as [string, Record<string, unknown>][];
    expect(args).toEqual({
      challenge_id: 'r1', activity_date: '2026-11-05', moving_time_s: 5600, distance_m: 42300, avg_speed_ms: 7.55, elev_gain_m: 605, vam_mh: 389,
    });
    expect(JSON.stringify(args)).not.toMatch(/lat/);
  });

  it('una salida corta también se puede enviar', async () => {
    await db.activities.put(activity('corta', '2026-11-04T09:00:00Z', 25, 'Salida corta'));
    const { client, rpc } = fakeClient([row({ status: 'accepted' })]);
    renderAt(client, '/retos/r1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Usar una salida' }));
    await user.click(await screen.findByRole('button', { name: 'Usar esta salida: Salida corta' }));
    expect(calls(rpc, 'submit_challenge_result')).toHaveLength(1);
  });

  it('si el reto ya está cerrado, lo explica', async () => {
    await db.activities.put(activity('buena', '2026-11-05T09:00:00Z', 42.3, 'Salida buena'));
    const { client } = fakeClient([row({ status: 'accepted' })], { submit_challenge_result: () => ({ error: { message: 'Reto cerrado' } }) });
    renderAt(client, '/retos/r1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Usar una salida' }));
    await user.click(await screen.findByRole('button', { name: 'Usar esta salida: Salida buena' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El reto está cerrado: ha terminado, se ha rechazado o ha pasado el plazo de 30 días.');
  });

  it('con los dos resultados muestra la comparativa y quién gana', async () => {
    const { client } = fakeClient([row({ status: 'finished', mine: res({ moving_time_s: 5400 }), theirs: res({ moving_time_s: 5700, avg_speed_ms: 7.4 }) })]);
    renderAt(client, '/retos/r1');
    expect(await screen.findByText('Has ganado')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Comparativa del reto' });
    expect(within(table).getByRole('columnheader', { name: 'Ana Ruta' })).toBeInTheDocument();
    const time = within(table).getByRole('row', { name: /Tiempo en movimiento/ });
    expect(within(time).getByText('1:30:00')).toBeInTheDocument();
    expect(within(time).getByText('1:35:00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Usar/ })).not.toBeInTheDocument();
  });

  it('caducado: sin botones para responder ni enviar', async () => {
    const { client } = fakeClient([row({ status: 'expired' })]);
    renderAt(client, '/retos/r1');
    expect(await screen.findByText('Caducado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceptar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rechazar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Usar/ })).not.toBeInTheDocument();
  });

  it('un reto que no está en la lista se da por no disponible', async () => {
    renderAt(fakeClient([]).client, '/retos/otro');
    expect(await screen.findByText('Ese reto ya no está disponible.')).toBeInTheDocument();
  });
});
