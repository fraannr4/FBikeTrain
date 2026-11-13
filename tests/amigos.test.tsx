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

function renderWith(client: SupabaseClient, page = <Amigos />, path = '/amigos') {
  return render(
    <AccountContext.Provider value={{ client, user: { id: 'u1' } as User }}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>{page}</ToastProvider>
      </MemoryRouter>
    </AccountContext.Provider>,
  );
}

const calls = (rpc: ReturnType<typeof vi.fn>, fn: string) => rpc.mock.calls.filter((c) => c[0] === fn);
const zona = (locality: string | null): Handler => () => ({ data: [{ locality, show_area: true }] });

describe('Amigos', () => {
  it('abre la lista desde el acceso del perfil y enlaza perfiles ajenos', async () => {
    const { client } = fakeClient({}, [{ friendship_id: 'f1', status: 'accepted', direction: 'sent', profile: ana }]);
    renderWith(client, <Amigos />, '/amigos?vista=amigos');
    expect(await screen.findByRole('region', { name: 'Tus amigos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ana Ruta' })).toHaveAttribute('href', '/personas/p2');
  });

  it('un error cargando amistades se muestra en Buscar y bloquea solicitudes desconocidas', async () => {
    const rpc = vi.fn(async (fn: string) => fn === 'list_friends'
      ? { error: { message: 'network' } }
      : { data: fn === 'search_profiles' ? [ana] : [] });
    renderWith({ rpc } as unknown as SupabaseClient);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nombre o usuario'), 'Ana');
    await user.click(within(screen.getByRole('search')).getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Amistad sin comprobar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Solicitar amistad a Ana Ruta' })).not.toBeInTheDocument();
  });
  it('con menos de 3 letras no busca y lo dice', async () => {
    const { client, rpc } = fakeClient({ my_area: zona('Villa Centro') });
    renderWith(client);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nombre o usuario'), 'an');
    await user.click(within(screen.getByRole('search')).getByRole('button', { name: 'Buscar' }));
    expect(screen.getByText('Escribe al menos 3 letras.')).toBeInTheDocument();
    expect(calls(rpc, 'search_profiles')).toHaveLength(0);
  });

  it('muestra los resultados por nombre y envía la solicitud', async () => {
    const { client, rpc, state } = fakeClient({
      my_area: zona('Villa Centro'),
      search_profiles: () => ({ data: [ana, bea] }),
      request_friendship: () => {
        state.friends = [{ friendship_id: 'f1', status: 'pending', direction: 'sent', profile: ana }];
        return {};
      },
    });
    renderWith(client);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nombre o usuario'), 'Ana');
    await user.click(within(screen.getByRole('search')).getByRole('button', { name: 'Buscar' }));
    const row = (await screen.findByText('Ana Ruta')).closest('li')!;
    expect(within(row).getByText('@ana_ruta')).toBeInTheDocument();
    expect(within(row).getByText('Villa Prueba')).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith('search_profiles', { q: 'Ana' });
    await user.click(within(row).getByRole('button', { name: 'Solicitar amistad a Ana Ruta' }));
    expect(rpc).toHaveBeenCalledWith('request_friendship', { target_id: 'p2' });
    expect(await within(row).findByText('Pendiente')).toBeInTheDocument();
  });

  it('«Cerca de mí» sin zona lo dice y no llama', async () => {
    const { client, rpc } = fakeClient({ my_area: zona(null) });
    renderWith(client);
    await vi.waitFor(() => expect(calls(rpc, 'my_area')).toHaveLength(1));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cerca de mí: 25 km' }));
    expect(await screen.findByText('Indica tu zona en Ajustes para buscar cerca.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Indicar mi zona' })).toHaveAttribute('href', '/ajustes?abrir=zona');
    expect(calls(rpc, 'search_profiles_near')).toHaveLength(0);
  });

  it('«Cerca de mí» con zona busca en el radio elegido y muestra la banda de distancia', async () => {
    const { client, rpc } = fakeClient({
      my_area: zona('Villa Centro'),
      search_profiles_near: () => ({ data: [{ ...ana, distance_km: 10 }] }),
    });
    renderWith(client);
    await vi.waitFor(() => expect(calls(rpc, 'my_area')).toHaveLength(1));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cerca de mí: 50 km' }));
    expect(await screen.findByText('Villa Prueba, a menos de 10 km')).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith('search_profiles_near', { radius_km: 50 });
  });

  it('un error de la solicitud se muestra traducido y no deja el botón bloqueado', async () => {
    const { client } = fakeClient({
      my_area: zona('Villa Centro'),
      search_profiles: () => ({ data: [ana] }),
      request_friendship: () => ({ error: { message: 'Solicitud no válida' } }),
    });
    renderWith(client);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nombre o usuario'), 'Ana');
    await user.click(within(screen.getByRole('search')).getByRole('button', { name: 'Buscar' }));
    const button = await screen.findByRole('button', { name: 'Solicitar amistad a Ana Ruta' });
    await user.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('No puedes enviarte una solicitud a ti mismo.');
    expect(button).toBeEnabled();
  });

  it('sin amistades invita a buscar', async () => {
    const { client } = fakeClient({ my_area: zona('Villa Centro') });
    renderWith(client);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Amigos' }));
    expect(await screen.findByText('Todavía no tienes amigos. Busca a alguien por su nombre o cerca de ti.')).toBeInTheDocument();
  });

  it('aceptar y quitar refrescan la lista', async () => {
    const { client, rpc, state } = fakeClient(
      {
        my_area: zona('Villa Centro'),
        accept_friendship: () => {
          state.friends = [{ ...state.friends[0], status: 'accepted' }];
          return {};
        },
        remove_friendship: () => {
          state.friends = [];
          return {};
        },
      },
      [{ friendship_id: 'f9', status: 'pending', direction: 'received', profile: bea }],
    );
    renderWith(client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Amigos (1)' }));
    const received = await screen.findByRole('region', { name: 'Solicitudes recibidas' });
    expect(within(received).getByText('Bea Puerto')).toBeInTheDocument();
    expect(within(received).getByRole('button', { name: 'Rechazar a Bea Puerto' })).toBeInTheDocument();
    await user.click(within(received).getByRole('button', { name: 'Aceptar a Bea Puerto' }));
    expect(rpc).toHaveBeenCalledWith('accept_friendship', { request_id: 'f9' });
    const mine = await screen.findByRole('region', { name: 'Tus amigos' });
    await user.click(within(mine).getByRole('button', { name: 'Quitar a Bea Puerto' }));
    expect(rpc).toHaveBeenCalledWith('remove_friendship', { request_id: 'f9' });
    expect(await screen.findByText('Todavía no tienes amigos. Busca a alguien por su nombre o cerca de ti.')).toBeInTheDocument();
    expect(calls(rpc, 'list_friends').length).toBeGreaterThanOrEqual(3);
  });

  it('a un amigo aceptado se le puede retar', async () => {
    const { client } = fakeClient({ my_area: zona('Villa Centro') }, [{ friendship_id: 'f3', status: 'accepted', direction: 'sent', profile: bea }]);
    renderWith(client);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Amigos' }));
    const mine = await screen.findByRole('region', { name: 'Tus amigos' });
    expect(within(mine).getByRole('link', { name: 'Retar a Bea Puerto' })).toHaveAttribute('href', '/retos/nuevo?amigo=p3');
  });

  it('las solicitudes enviadas se pueden cancelar', async () => {
    const { client, rpc, state } = fakeClient(
      { my_area: zona('Villa Centro'), remove_friendship: () => { state.friends = []; return {}; } },
      [{ friendship_id: 'f5', status: 'pending', direction: 'sent', profile: ana }],
    );
    renderWith(client);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Amigos' }));
    const sent = await screen.findByRole('region', { name: 'Solicitudes enviadas' });
    await user.click(within(sent).getByRole('button', { name: 'Cancelar a Ana Ruta' }));
    expect(rpc).toHaveBeenCalledWith('remove_friendship', { request_id: 'f5' });
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
