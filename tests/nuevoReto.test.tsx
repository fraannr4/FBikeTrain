import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { db } from '../src/db/db';
import { analyzeReferenceRoutePoints, type ReferenceRoute, type RoutePoint } from '../src/routes/library';
import type { FriendRow, ProfileCard } from '../src/social/friends';
import { NuevoReto } from '../src/ui/pages/NuevoReto';

const ana: ProfileCard = { id: 'p2', username: 'ana_ruta', display_name: 'Ana Ruta', locality: null, distance_km: null };
const bea: ProfileCard = { id: 'p3', username: 'bea_puerto', display_name: 'Bea Puerto', locality: null, distance_km: null };
const accepted = (p: ProfileCard): FriendRow => ({ friendship_id: `f-${p.id}`, status: 'accepted', direction: 'sent', profile: p });

const line = (n: number, lng0: number): RoutePoint[] => Array.from({ length: n }, (_, i) => ({ lat: 41.6, lng: lng0 + i * 0.001, ele: 100 + i * 2 }));
function route(id: string, name: string, points: RoutePoint[], updatedAt: number): ReferenceRoute {
  const summary = points.length >= 2 ? analyzeReferenceRoutePoints(points) : { distanceM: 0, elevGainM: null, elevLossM: null, closed: false, pointCount: points.length };
  return { id, name, format: 'gpx', sourceFileName: `${id}.gpx`, originalXml: '<gpx/>', originalPoints: points, points, summary, createdAt: 1, updatedAt };
}

function fakeClient(friends: FriendRow[], created = 'reto-1') {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === 'list_friends') return { data: friends, error: null };
    if (fn === 'create_challenge') return { data: created, error: null };
    return { data: null, error: null };
  });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

function renderAt(client: SupabaseClient, path: string) {
  return render(
    <AccountContext.Provider value={{ client, user: { id: 'u1' } as User }}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/retos/nuevo" element={<NuevoReto />} />
          <Route path="/retos/:id" element={<p>Detalle del reto</p>} />
        </Routes>
      </MemoryRouter>
    </AccountContext.Provider>,
  );
}

beforeEach(async () => {
  await db.referenceRoutes.clear();
  await db.referenceRoutes.bulkPut([route('r-a', 'Costa sintética', line(30, 2.29), 2), route('r-b', 'Sierra sintética', line(60, 2.4), 1)]);
});

describe('Nuevo reto', () => {
  it('preselecciona el amigo y la ruta de la dirección y resume la ruta', async () => {
    const { client } = fakeClient([accepted(ana), accepted(bea)]);
    renderAt(client, '/retos/nuevo?amigo=p3&ruta=r-b');
    expect(await screen.findByRole('combobox', { name: 'Amigo' })).toHaveValue('p3');
    expect(await screen.findByRole('combobox', { name: 'Ruta' })).toHaveValue('r-b');
    expect(screen.getByText('4,9 km')).toBeInTheDocument();
    expect(screen.getByText('118 m')).toBeInTheDocument();
  });

  it('sin amigos aceptados lo dice y enlaza a Amigos', async () => {
    const { client } = fakeClient([{ ...accepted(ana), status: 'pending' }]);
    renderAt(client, '/retos/nuevo');
    expect(await screen.findByText('Necesitas un amigo aceptado para retarle')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Amigos' })).toHaveAttribute('href', '/amigos');
    expect(screen.queryByRole('button', { name: 'Enviar reto' })).not.toBeInTheDocument();
  });

  it('crea el reto con los puntos de la ruta y abre su detalle', async () => {
    const { client, rpc } = fakeClient([accepted(ana)]);
    renderAt(client, '/retos/nuevo?ruta=r-a');
    const user = userEvent.setup();
    await screen.findByRole('combobox', { name: 'Amigo' });
    await user.click(await screen.findByRole('button', { name: 'Enviar reto' }));
    expect(await screen.findByText('Detalle del reto')).toBeInTheDocument();
    const [, args] = rpc.mock.calls.find((c) => c[0] === 'create_challenge') as unknown as [string, Record<string, unknown>];
    expect(args).toMatchObject({ challenged_id: 'p2', route_name: 'Costa sintética', distance_m: 2411, elev_gain_m: 58 });
    expect(args.route_points).toHaveLength(30);
    expect((args.route_points as number[][])[0]).toEqual([41.6, 2.29, 100]);
  });

  it('una ruta con menos de 2 puntos no se envía y lo explica', async () => {
    await db.referenceRoutes.put(route('r-1', 'Punto suelto', line(1, 2.5), 9));
    const { client, rpc } = fakeClient([accepted(ana)]);
    renderAt(client, '/retos/nuevo?ruta=r-1');
    await screen.findByRole('combobox', { name: 'Amigo' });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Enviar reto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La ruta necesita al menos 2 puntos.');
    expect(rpc.mock.calls.some((c) => c[0] === 'create_challenge')).toBe(false);
  });
});
