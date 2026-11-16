import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { Ciclistas } from '../src/ui/pages/Ciclistas';
import { blockCyclist, listBlockedCyclists, listCyclists, type Cyclist } from '../src/social/community';
import { listFriends, requestFriendship } from '../src/social/friends';

vi.mock('../src/social/community', () => ({ blockCyclist: vi.fn(), listBlockedCyclists: vi.fn(), listCyclists: vi.fn() }));
vi.mock('../src/social/friends', () => ({ listFriends: vi.fn(), requestFriendship: vi.fn(), acceptFriendship: vi.fn() }));

const person = (id: string): Cyclist => ({ id, username: `ciclista_${id}`, display_name: `Ciclista ${id}`, bio: 'Rodar y descubrir.', riding_style: 'explorar', avatar_version: 0, locality: 'Villa Sintética', distance_km: null, last_active_at: '2026-11-15T00:00:00Z' });
const client = {} as SupabaseClient;
function show(anonymous = false) {
  render(<AccountContext.Provider value={{ client, user: { id: 'u1', is_anonymous: anonymous } as User }}><MemoryRouter><Ciclistas /></MemoryRouter></AccountContext.Provider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCyclists).mockResolvedValue([person('u1'), person('p2')]);
  vi.mocked(listFriends).mockResolvedValue([]);
  vi.mocked(listBlockedCyclists).mockResolvedValue([]);
});

it('shows the whole community immediately and challenges non-friends without self invitations', async () => {
  show();
  const list = await screen.findByRole('list', { name: 'Ciclistas registrados' });
  expect(await within(list).findByRole('link', { name: 'Ver perfil de Ciclista p2' })).toHaveAttribute('href', '/personas/p2');
  expect(listCyclists).toHaveBeenCalledWith(client, '', 0);
  expect(within(list).getByRole('link', { name: 'Retar a Ciclista p2' })).toHaveAttribute('href', '/retos/nuevo?ciclista=p2');
  expect(within(list).queryByRole('link', { name: 'Retar a Ciclista u1' })).not.toBeInTheDocument();
  expect(within(list).queryByRole('link', { name: 'Ver perfil de Ciclista u1' })).not.toBeInTheDocument();
  await userEvent.setup().click(within(list).getByRole('button', { name: 'Solicitar amistad a Ciclista p2' }));
  expect(requestFriendship).toHaveBeenCalledWith(client, 'p2');
});

it('pages past the first fifty and resets the offset when searching by a short name', async () => {
  vi.mocked(listCyclists).mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => person(`p${i}`))).mockResolvedValueOnce([person('p50')]).mockResolvedValueOnce([person('al')]);
  show();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Ver más ciclistas' }));
  expect(await screen.findByRole('link', { name: 'Ver perfil de Ciclista p50' })).toBeInTheDocument();
  expect(listCyclists).toHaveBeenCalledWith(client, '', 50);
  await user.type(screen.getByLabelText('Nombre o usuario'), 'Al');
  await user.click(screen.getByRole('button', { name: 'Buscar' }));
  expect(await screen.findByRole('link', { name: 'Ver perfil de Ciclista al' })).toBeInTheDocument();
  expect(listCyclists).toHaveBeenLastCalledWith(client, 'Al', 0);
  expect(screen.queryByRole('link', { name: 'Ver perfil de Ciclista p50' })).not.toBeInTheDocument();
});

it('gates anonymous accounts without querying the directory', () => {
  show(true);
  expect(screen.getByText(/Necesitas una cuenta registrada/)).toBeInTheDocument();
  expect(listCyclists).not.toHaveBeenCalled();
});

it('retries a failed directory and can unblock a cyclist', async () => {
  vi.mocked(listCyclists).mockRejectedValueOnce(new Error('Sin conexión'));
  vi.mocked(listBlockedCyclists).mockResolvedValue([person('p9')]);
  show();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByRole('link', { name: 'Ver perfil de Ciclista p2' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Ciclistas bloqueados' }));
  await user.click(await screen.findByRole('button', { name: 'Desbloquear a Ciclista p9' }));
  expect(blockCyclist).toHaveBeenCalledWith(client, 'p9', false);
  expect(await screen.findByText('No has bloqueado a ningún ciclista.')).toBeInTheDocument();
});

it('shows a busy skeleton while the first page loads', () => {
  vi.mocked(listCyclists).mockReturnValue(new Promise(() => {}));
  show();
  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.getByText(/Cargando ciclistas/)).toBeInTheDocument();
});

it('marks the request as sent the moment it is tapped, before the server answers', async () => {
  let finish: () => void = () => {};
  vi.mocked(requestFriendship).mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  show();
  const list = await screen.findByRole('list', { name: 'Ciclistas registrados' });
  await userEvent.setup().click(await within(list).findByRole('button', { name: 'Solicitar amistad a Ciclista p2' }));
  expect(within(list).getByLabelText('Solicitud enviada')).toBeInTheDocument();
  expect(within(list).queryByRole('button', { name: 'Solicitar amistad a Ciclista p2' })).not.toBeInTheDocument();
  finish();
});

it('brings the request back when the server refuses it', async () => {
  vi.mocked(requestFriendship).mockRejectedValue(new Error('Límite diario de solicitudes'));
  show();
  const list = await screen.findByRole('list', { name: 'Ciclistas registrados' });
  await userEvent.setup().click(await within(list).findByRole('button', { name: 'Solicitar amistad a Ciclista p2' }));
  expect(await screen.findByText('Límite diario de solicitudes')).toBeInTheDocument();
  expect(within(list).getByRole('button', { name: 'Solicitar amistad a Ciclista p2' })).toBeInTheDocument();
});
