import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { Persona } from '../src/ui/pages/Persona';
import { ToastProvider } from '../src/ui/components/Toast';
import type { FriendRow } from '../src/social/friends';

const profile = { id: 'p2', username: 'ana_ruta', display_name: 'Ana Ruta', bio: 'Historias sobre dos ruedas.', riding_style: 'subir', avatar_version: 0 };
function setup(initial: FriendRow[] = [], fail = false, missing = false) {
  let friends = initial;
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: missing ? null : profile, error: null })) })) }));
  const rpc = vi.fn(async (fn: string) => {
    if (fn === 'list_friends') return fail ? { error: { message: 'network' } } : { data: friends };
    if (fn === 'list_profile_posts') return { data: [] };
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

it('carga solo identidad pública y permite solicitar y cancelar amistad', async () => {
  const { select, rpc } = setup();
  const user = userEvent.setup();
  expect(await screen.findByRole('heading', { name: 'Ana Ruta' })).toBeInTheDocument();
  expect(select).toHaveBeenCalledWith('id,username,display_name,bio,riding_style,avatar_version');
  expect(screen.getByText('Historias sobre dos ruedas.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Solicitar amistad' }));
  expect(rpc).toHaveBeenCalledWith('request_friendship', { target_id: 'p2' });
  await user.click(await screen.findByRole('button', { name: 'Cancelar solicitud' }));
  expect(rpc).toHaveBeenCalledWith('remove_friendship', { request_id: 'f1' });
  expect(await screen.findByRole('button', { name: 'Solicitar amistad' })).toBeInTheDocument();
});

it('permite retar antes de aceptar amistad y conserva la aceptación de la solicitud', async () => {
  setup([{ friendship_id: 'f1', status: 'pending', direction: 'received', profile: { ...profile, locality: null, distance_km: null } }]);
  expect(await screen.findByRole('link', { name: 'Retar a Ana Ruta' })).toHaveAttribute('href', '/retos/nuevo?ciclista=p2');
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Aceptar solicitud' }));
  expect(await screen.findByText('Sois amigos')).toBeInTheDocument();
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
  expect(screen.queryByRole('button', { name: 'Solicitar amistad' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
});

it('un perfil borrado tiene estado explícito', async () => {
  setup([], false, true);
  expect(await screen.findByRole('heading', { name: 'Perfil no disponible' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Solicitar amistad' })).not.toBeInTheDocument();
});
