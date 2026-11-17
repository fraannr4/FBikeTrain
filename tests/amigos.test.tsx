import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { ToastProvider } from '../src/ui/components/Toast';
import { Amigos } from '../src/ui/pages/Amigos';
import { Mas } from '../src/ui/pages/Mas';
import { clearAllData } from '../src/db/repo';
import type { FriendRow, ProfileCard } from '../src/social/friends';

const ana: ProfileCard = { id: 'p2', username: 'ana_ruta', display_name: 'Ana Ruta', locality: 'Villa Prueba', distance_km: null };
const bea: ProfileCard = { id: 'p3', username: 'bea_puerto', display_name: 'Bea Puerto', locality: null, distance_km: null };

type Handler = (args?: Record<string, unknown>) => { data?: unknown; error?: { message: string } | null };

/** Cliente falso: cada RPC responde con su manejador; `friends` es la lista que devuelve `list_friends`. */
function fakeClient(handlers: Record<string, Handler>, friends: FriendRow[] = []) {
  const state = { friends };
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === 'list_friends') return { data: state.friends, error: null };
    const h = handlers[fn];
    const r = h ? h(args) : { data: null };
    return { data: r.data ?? null, error: r.error ?? null };
  });
  return { client: { rpc } as unknown as SupabaseClient, rpc, state };
}

function renderWith(client: SupabaseClient, page = <Amigos />, path = '/perfil/amigos') {
  return render(
    <AccountContext.Provider value={{ client, user: { id: 'u1' } as User }}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>{page}</ToastProvider>
      </MemoryRouter>
    </AccountContext.Provider>,
  );
}

const NEAR_MISSING: Handler = () => ({ error: { message: 'Sin zona configurada' } });

describe('Amigos dentro del perfil', () => {
  it('lista tus amigos con su perfil y Retar, y vuelve al perfil', async () => {
    const { client } = fakeClient({ search_profiles_near: () => ({ data: [] }) }, [{ friendship_id: 'f1', status: 'accepted', direction: 'sent', profile: ana }]);
    renderWith(client);
    expect(screen.getByRole('heading', { name: 'Amigos', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a Tu perfil' })).toBeInTheDocument();
    const mine = await screen.findByRole('region', { name: 'Tus amigos' });
    expect(within(mine).getByRole('link', { name: 'Ana Ruta' })).toHaveAttribute('href', '/personas/p2');
    expect(within(mine).getByRole('link', { name: 'Retar a Ana Ruta' })).toHaveAttribute('href', '/retos/nuevo?ciclista=p2');
  });

  it('las solicitudes recibidas van arriba y se aceptan o rechazan', async () => {
    const { client, rpc, state } = fakeClient(
      {
        search_profiles_near: () => ({ data: [] }),
        accept_friendship: () => {
          state.friends = [{ ...state.friends[0], status: 'accepted' }];
          return {};
        },
      },
      [{ friendship_id: 'f9', status: 'pending', direction: 'received', profile: bea }],
    );
    renderWith(client);
    const user = userEvent.setup();
    const received = await screen.findByRole('region', { name: 'Solicitudes recibidas' });
    expect(within(received).getByRole('button', { name: 'Rechazar a Bea Puerto' })).toBeInTheDocument();
    await user.click(within(received).getByRole('button', { name: 'Aceptar a Bea Puerto' }));
    expect(rpc).toHaveBeenCalledWith('accept_friendship', { request_id: 'f9' });
    const mine = await screen.findByRole('region', { name: 'Tus amigos' });
    expect(within(mine).getByText('Bea Puerto')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Solicitudes recibidas' })).not.toBeInTheDocument();
  });

  it('rechazar retira la solicitud', async () => {
    const { client, rpc, state } = fakeClient(
      { search_profiles_near: () => ({ data: [] }), remove_friendship: () => { state.friends = []; return {}; } },
      [{ friendship_id: 'f9', status: 'pending', direction: 'received', profile: bea }],
    );
    renderWith(client);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Rechazar a Bea Puerto' }));
    expect(rpc).toHaveBeenCalledWith('remove_friendship', { request_id: 'f9' });
    expect(await screen.findByText('Todavía no tienes amigos.')).toBeInTheDocument();
  });

  it('con pocos amigos no hay buscador', async () => {
    const { client } = fakeClient({ search_profiles_near: () => ({ data: [] }) }, [
      { friendship_id: 'f1', status: 'accepted', direction: 'sent', profile: ana },
      { friendship_id: 'f2', status: 'accepted', direction: 'received', profile: bea },
    ]);
    renderWith(client);
    await screen.findByRole('region', { name: 'Tus amigos' });
    expect(screen.queryByRole('searchbox', { name: 'Buscar entre tus amigos' })).not.toBeInTheDocument();
  });

  it('el buscador filtra tu lista de amigos', async () => {
    const extra = (n: number): FriendRow => ({ friendship_id: `fx${n}`, status: 'accepted', direction: 'sent', profile: { id: `px${n}`, username: `otro_${n}`, display_name: `Otro ${n}`, locality: null, distance_km: null } });
    const { client } = fakeClient({ search_profiles_near: () => ({ data: [] }) }, [
      { friendship_id: 'f1', status: 'accepted', direction: 'sent', profile: ana },
      { friendship_id: 'f2', status: 'accepted', direction: 'received', profile: bea },
      extra(1), extra(2), extra(3), extra(4),
    ]);
    renderWith(client);
    const user = userEvent.setup();
    const mine = await screen.findByRole('region', { name: 'Tus amigos' });
    const box = screen.getByRole('searchbox', { name: 'Buscar entre tus amigos' });
    expect(box).toHaveAttribute('placeholder', 'Nombre o @usuario');
    await user.type(box, 'puer');
    expect(within(mine).queryByText('Ana Ruta')).not.toBeInTheDocument();
    expect(within(mine).getByText('Bea Puerto')).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, 'zzz');
    expect(within(mine).getByText('Ningún amigo coincide con «zzz».')).toBeInTheDocument();
  });

  it('sugiere ciclistas cercanos que aún no son amigos y permite añadirlos', async () => {
    const { client, rpc, state } = fakeClient(
      {
        search_profiles_near: () => ({ data: [{ ...ana, distance_km: 10 }, bea] }),
        request_friendship: () => {
          state.friends = [...state.friends, { friendship_id: 'f7', status: 'pending', direction: 'sent', profile: ana }];
          return {};
        },
      },
      [{ friendship_id: 'f2', status: 'accepted', direction: 'sent', profile: bea }],
    );
    renderWith(client);
    const user = userEvent.setup();
    const suggestions = await screen.findByRole('region', { name: 'Sugerencias' });
    expect(rpc).toHaveBeenCalledWith('search_profiles_near', { radius_km: 50 });
    expect(await within(suggestions).findByText('Villa Prueba, a menos de 10 km')).toBeInTheDocument();
    expect(within(suggestions).queryByText('Bea Puerto')).not.toBeInTheDocument();
    await user.click(within(suggestions).getByRole('button', { name: 'Añadir a Ana Ruta' }));
    expect(rpc).toHaveBeenCalledWith('request_friendship', { target_id: 'p2' });
    expect(await within(suggestions).findByText('Solicitud enviada')).toBeInTheDocument();
  });

  it('sin zona, sugiere ciclistas activos y explica cómo ver los cercanos', async () => {
    const { client } = fakeClient({
      search_profiles_near: NEAR_MISSING,
      list_cyclists: () => ({ data: [{ ...ana, bio: '', riding_style: 'grupo', avatar_version: 0, last_active_at: null }] }),
    });
    renderWith(client);
    const suggestions = await screen.findByRole('region', { name: 'Sugerencias' });
    expect(await within(suggestions).findByText('Ana Ruta')).toBeInTheDocument();
    expect(within(suggestions).getByRole('link', { name: 'Indicar mi zona' })).toHaveAttribute('href', '/ajustes?abrir=zona');
  });

  it('sin amigos, invita a buscar ciclistas', async () => {
    const { client } = fakeClient({ search_profiles_near: () => ({ data: [] }) });
    renderWith(client);
    expect(await screen.findByText('Todavía no tienes amigos.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Buscar ciclistas' })[0]).toHaveAttribute('href', '/ciclistas');
  });

  it('un error cargando amistades se muestra y no deja añadir a ciegas', async () => {
    const rpc = vi.fn(async (fn: string) => (fn === 'list_friends' ? { error: { message: 'network' } } : { data: fn === 'search_profiles_near' ? [ana] : [] }));
    renderWith({ rpc } as unknown as SupabaseClient);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Añadir a Ana Ruta' })).not.toBeInTheDocument();
  });

  it('las solicitudes enviadas se pueden cancelar', async () => {
    const { client, rpc, state } = fakeClient(
      { search_profiles_near: () => ({ data: [] }), remove_friendship: () => { state.friends = []; return {}; } },
      [{ friendship_id: 'f5', status: 'pending', direction: 'sent', profile: ana }],
    );
    renderWith(client);
    const sent = await screen.findByRole('region', { name: 'Solicitudes enviadas' });
    await userEvent.setup().click(within(sent).getByRole('button', { name: 'Cancelar a Ana Ruta' }));
    expect(rpc).toHaveBeenCalledWith('remove_friendship', { request_id: 'f5' });
  });
});

describe('Amigos: acabado en móvil', () => {
  it('mientras carga la lista muestra un esqueleto ocupado', () => {
    const rpc = vi.fn(() => new Promise(() => {}));
    renderWith({ rpc } as unknown as SupabaseClient);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText(/Cargando tus amigos/)).toBeInTheDocument();
  });

  it('aceptar una solicitud es instantáneo y lo confirma', async () => {
    let finish: () => void = () => {};
    const { client, state } = fakeClient(
      {
        search_profiles_near: () => ({ data: [] }),
        accept_friendship: () => { state.friends = [{ ...state.friends[0], status: 'accepted' }]; return {}; },
      },
      [{ friendship_id: 'f9', status: 'pending', direction: 'received', profile: bea }],
    );
    const slow = { rpc: (fn: string, args?: Record<string, unknown>) => fn === 'accept_friendship'
      ? new Promise(resolve => { finish = () => resolve(client.rpc(fn, args)); })
      : client.rpc(fn, args) } as unknown as SupabaseClient;
    renderWith(slow);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Aceptar a Bea Puerto' }));
    expect(screen.queryByRole('region', { name: 'Solicitudes recibidas' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Tus amigos' })).getByText('Bea Puerto')).toBeInTheDocument();
    finish();
    expect(await screen.findByText('Ahora eres amigo de Bea Puerto.')).toBeInTheDocument();
  });

  it('si el servidor rechaza aceptar, la solicitud vuelve y se explica', async () => {
    const { client } = fakeClient(
      { search_profiles_near: () => ({ data: [] }), accept_friendship: () => ({ error: { message: 'x' } }) },
      [{ friendship_id: 'f9', status: 'pending', direction: 'received', profile: bea }],
    );
    renderWith(client);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Aceptar a Bea Puerto' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Solicitudes recibidas' })).toBeInTheDocument();
  });

  it('quitar a un amigo pide confirmación y se puede mantener', async () => {
    const { client, rpc, state } = fakeClient(
      { search_profiles_near: () => ({ data: [] }), remove_friendship: () => { state.friends = []; return {}; } },
      [{ friendship_id: 'f1', status: 'accepted', direction: 'sent', profile: ana }],
    );
    renderWith(client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Quitar a Ana Ruta' }));
    expect(rpc).not.toHaveBeenCalledWith('remove_friendship', expect.anything());
    await user.click(screen.getByRole('button', { name: 'Mantener a Ana Ruta' }));
    expect(screen.getByRole('button', { name: 'Quitar a Ana Ruta' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quitar a Ana Ruta' }));
    await user.click(screen.getByRole('button', { name: 'Quitar definitivamente a Ana Ruta' }));
    expect(rpc).toHaveBeenCalledWith('remove_friendship', { request_id: 'f1' });
    expect(await screen.findByText('Has quitado a Ana Ruta de tus amigos.')).toBeInTheDocument();
  });
});

describe('Amigos en Más', () => {
  beforeEach(async () => {
    await clearAllData();
  });
  it('con cuenta aparecen las filas Amigos y Retos', async () => {
    renderWith(fakeClient({}).client, <Mas />, '/mas');
    expect(await screen.findByRole('link', { name: /Amigos/ })).toHaveAttribute('href', '/amigos');
    expect(screen.getByRole('link', { name: /Retos/ })).toHaveAttribute('href', '/retos');
  });
  it('sin cuenta no aparece', async () => {
    render(
      <MemoryRouter initialEntries={['/mas']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Mas />
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: /Ajustes/ });
    expect(screen.queryByRole('link', { name: /Amigos/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Retos/ })).not.toBeInTheDocument();
  });
});
