import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { Persona } from '../src/ui/pages/Persona';
import { ToastProvider } from '../src/ui/components/Toast';
import type { FriendRow } from '../src/social/friends';

const profile = { id: 'p2', username: 'ana_ruta', display_name: 'Ana Ruta', bio: 'Historias sobre dos ruedas.', riding_style: 'subir', avatar_version: 0 };
function setup(initial: FriendRow[] = [], fail = false, missing = false, challenges: unknown[] = []) {
  let friends = initial;
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: missing ? null : profile, error: null })) })) }));
  const rpc = vi.fn(async (fn: string) => {
    if (fn === 'list_friends') return fail ? { error: { message: 'network' } } : { data: friends };
    if (fn === 'list_profile_posts') return { data: [] };
    if (fn === 'list_community_challenges') return { data: challenges };
    if (fn === 'request_friendship') friends = [{ friendship_id: 'f1', status: 'pending', direction: 'sent', profile: { ...profile, locality: null, distance_km: null } }];
    if (fn === 'accept_friendship') friends = friends.map(f => ({ ...f, status: 'accepted' }));
    if (fn === 'remove_friendship') friends = [];
    return { error: null };
  });
  const from = vi.fn(() => ({ select }));
  render(<AccountContext.Provider value={{ client: { from, rpc } as unknown as SupabaseClient, user: { id: 'u1' } as User }}>
    <MemoryRouter initialEntries={['/personas/p2']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider><Routes><Route path="/personas/:id" element={<Persona />} /></Routes></ToastProvider>
    </MemoryRouter>
  </AccountContext.Provider>);
  return { select, rpc };
}

it('carga solo identidad pública y permite añadir amigo y cancelar la solicitud', async () => {
  const { select, rpc } = setup();
  const user = userEvent.setup();
  expect(await screen.findByRole('heading', { name: 'Ana Ruta' })).toBeInTheDocument();
  expect(select).toHaveBeenCalledWith('id,username,display_name,bio,riding_style,avatar_version');
  expect(screen.getByText('@ana_ruta')).toBeInTheDocument();
  expect(screen.getByText('Historias sobre dos ruedas.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Añadir amigo' }));
  expect(rpc).toHaveBeenCalledWith('request_friendship', { target_id: 'p2' });
  await user.click(await screen.findByRole('button', { name: 'Solicitud enviada' }));
  await user.click(screen.getByRole('button', { name: 'Cancelar solicitud' }));
  expect(rpc).toHaveBeenCalledWith('remove_friendship', { request_id: 'f1' });
  expect(await screen.findByRole('button', { name: 'Añadir amigo' })).toBeInTheDocument();
});

it('Retar va junto al botón de amistad y se puede responder a una solicitud', async () => {
  setup([{ friendship_id: 'f1', status: 'pending', direction: 'received', profile: { ...profile, locality: null, distance_km: null } }]);
  const user = userEvent.setup();
  expect(await screen.findByRole('link', { name: 'Retar a Ana Ruta' })).toHaveAttribute('href', '/retos/nuevo?ciclista=p2');
  await user.click(screen.getByRole('button', { name: 'Responder solicitud' }));
  await user.click(screen.getByRole('button', { name: 'Aceptar solicitud' }));
  expect(await screen.findByRole('button', { name: 'Amigos' })).toBeInTheDocument();
});

it('siendo amigos, el menú permite eliminar la amistad', async () => {
  const { rpc } = setup([{ friendship_id: 'f1', status: 'accepted', direction: 'sent', profile: { ...profile, locality: null, distance_km: null } }]);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Amigos' }));
  expect(screen.getByRole('button', { name: 'Bloquear a Ana Ruta' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Eliminar de amigos' }));
  expect(rpc).toHaveBeenCalledWith('remove_friendship', { request_id: 'f1' });
  expect(await screen.findByRole('button', { name: 'Añadir amigo' })).toBeInTheDocument();
});

it('siendo amigos, el menú permite bloquear', async () => {
  const { rpc } = setup([{ friendship_id: 'f1', status: 'accepted', direction: 'sent', profile: { ...profile, locality: null, distance_km: null } }]);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Amigos' }));
  await user.click(screen.getByRole('button', { name: 'Bloquear a Ana Ruta' }));
  expect(rpc).toHaveBeenCalledWith('block_cyclist', { target_id: 'p2', blocked: true });
  expect(await screen.findByRole('heading', { name: 'Perfil no disponible' })).toBeInTheDocument();
});

it('cuenta los retos que habéis compartido y quién ganó', async () => {
  const m = (id: string, name: string) => ({ id, username: id, display_name: name, status: 'accepted', accepted_at: null, score: 1, updated_at: null });
  const duel = (id: string, winner: string) => ({ id, title: id, kind: 'distance', created_at: '2026-11-01T00:00:00Z', deadline: '2026-11-08T00:00:00Z', creator_id: 'u1', target_value: null, distance_m: null, segment_key: null, status: 'finished', members: [m('u1', 'Tú'), m('p2', 'Ana Ruta')], winner_ids: [winner] });
  setup([], false, false, [duel('a', 'u1'), duel('b', 'p2'), duel('c', 'u1')]);
  const stats = await screen.findByRole('list', { name: 'Cifras de Ana Ruta' });
  expect(await within(stats).findByRole('link', { name: '3 retos juntos' })).toHaveAttribute('href', '/retos?vista=historial');
  expect(within(stats).getByText('2', { selector: 'strong' }).parentElement).toHaveTextContent('2Tus victorias');
  expect(within(stats).getByText('1', { selector: 'strong' }).parentElement).toHaveTextContent('1Sus victorias');
});

it('denuncia en privado y al bloquear retira el perfil y sus acciones', async () => {
  const { rpc } = setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Bloquear o denunciar' }));
  await user.type(screen.getByLabelText('Motivo de la denuncia'), 'Mensajes de acoso');
  await user.click(screen.getByRole('button', { name: 'Enviar denuncia' }));
  expect(rpc).toHaveBeenCalledWith('report_cyclist', { target_id: 'p2', reason: 'Mensajes de acoso' });
  expect(await screen.findByText(/Denuncia enviada/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Bloquear a este ciclista' }));
  expect(rpc).toHaveBeenCalledWith('block_cyclist', { target_id: 'p2', blocked: true });
  expect(await screen.findByRole('heading', { name: 'Perfil no disponible' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Retar a Ana Ruta' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Cuaderno del ciclista' })).not.toBeInTheDocument();
});

it('no permite solicitudes si no se puede comprobar la relación', async () => {
  setup([], true);
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Añadir amigo' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
});

it('un perfil borrado tiene estado explícito', async () => {
  setup([], false, true);
  expect(await screen.findByRole('heading', { name: 'Perfil no disponible' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Añadir amigo' })).not.toBeInTheDocument();
});
