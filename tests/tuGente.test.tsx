import { render, screen, waitFor, within } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext, type Account } from '../src/auth/AccountBoundary';
import { TuGente } from '../src/ui/inicio/TuGente';

const DAY = 86_400_000;
const NOW = Date.now();
const ME = 'yo';

const conversation = (id: string, name: string, preview: string, at: string, unread: number) => ({
  id, kind: 'direct', title: null, peer_id: `p-${id}`, peer_name: name, peer_avatar_version: 0, peer_last_read_at: null,
  last_kind: 'text', last_preview: preview, last_sender_id: `p-${id}`, last_message_at: at, unread, muted: false,
  can_send: true, last_deleted: false,
});
const invitation = (id: string, title: string, at: string) => ({
  id, title, kind: 'distance', created_at: at, deadline: new Date(NOW + 7 * DAY).toISOString(), creator_id: 'marta',
  target_value: null, distance_m: null, segment_key: null, status: 'active', winner_ids: [],
  members: [
    { id: 'marta', username: 'martapuig', display_name: 'Marta Puig', status: 'accepted', accepted_at: null, score: null, updated_at: null },
    { id: ME, username: ME, display_name: ME, status: 'pending', accepted_at: null, score: null, updated_at: null },
  ],
});
const request = (id: string, name: string) => ({
  friendship_id: id, status: 'pending', direction: 'received',
  profile: { id: `u-${id}`, username: id, display_name: name, locality: null, distance_km: null },
});

type Lists = { chats?: unknown[]; retos?: unknown[]; amigos?: unknown[] };
const NAMES: Record<string, keyof Lists> = {
  chat_list_conversations: 'chats', list_community_challenges: 'retos', list_friends: 'amigos',
};
/** RPC simulada: cada lista por su nombre; `fail` hace fallar todas. */
function rpcWith(lists: Lists, fail = false) {
  return vi.fn(async (fn: string) =>
    fail ? { data: null, error: { message: 'red caída' } } : { data: lists[NAMES[fn]] ?? [], error: null });
}
const account = (rpc: ReturnType<typeof vi.fn>, anonymous = false): Account => ({
  client: { rpc } as unknown as SupabaseClient,
  user: { id: ME, is_anonymous: anonymous } as User,
});

function renderTuGente(who: Account | null) {
  return render(
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AccountContext.Provider value={who}>
        <main>
          <TuGente />
        </main>
      </AccountContext.Provider>
    </HashRouter>,
  );
}

const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('TuGente: lo que tu gente espera de ti, en Inicio', () => {
  it('sin cuenta no pinta nada', () => {
    renderTuGente(null);
    expect(screen.getByRole('main')).toBeEmptyDOMElement();
  });

  it('con cuenta anónima no pinta nada ni pide nada', () => {
    const rpc = rpcWith({});
    renderTuGente(account(rpc, true));
    expect(screen.getByRole('main')).toBeEmptyDOMElement();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('con pendientes: tres filas como mucho, de lo más reciente a lo más antiguo, y «Ver todo»', async () => {
    const rpc = rpcWith({
      chats: [conversation('ana', 'Ana Ruta', '¿Quedamos a las 8:15 mejor?', iso(60_000), 2), conversation('leido', 'Leído', 'Ya', iso(1_000), 0)],
      retos: [invitation('r1', 'Más kilómetros esta semana', iso(3_600_000))],
      amigos: [request('pol', 'Pol Serra'), request('eva', 'Eva Mas')],
    });
    renderTuGente(account(rpc));
    const section = await screen.findByRole('region', { name: 'Tu gente' });
    expect(within(section).getByRole('heading', { level: 2, name: 'Tu gente' })).toBeInTheDocument();
    const rows = within(within(section).getByRole('list', { name: 'Pendiente con tu gente' })).getAllByRole('link');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute('href', '#/chat/ana');
    expect(rows[0]).toHaveAccessibleName(/^Ana Ruta, 2 mensajes sin leer\. ¿Quedamos a las 8:15 mejor\?/);
    expect(within(rows[0]).getByText('2')).toBeInTheDocument();
    expect(rows[1]).toHaveAttribute('href', '#/retos/comunidad/r1');
    expect(within(rows[1]).getByText('Marta Puig')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Te reta: Más kilómetros esta semana')).toBeInTheDocument();
    expect(rows[2]).toHaveAttribute('href', '#/perfil/amigos');
    expect(within(rows[2]).getByText('Pol Serra')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Quiere ser tu amigo')).toBeInTheDocument();
    expect(screen.queryByText('Eva Mas')).not.toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Ver todo lo pendiente con tu gente, 4' })).toHaveAttribute('href', '#/gente');
    expect(screen.queryByText('Todo al día')).not.toBeInTheDocument();
  });

  it('sin pendientes: una sola fila «Todo al día» que lleva a Gente', async () => {
    renderTuGente(account(rpcWith({ chats: [conversation('leido', 'Leído', 'Ya', iso(1_000), 0)] })));
    const link = await screen.findByRole('link', { name: 'Tu gente: todo al día. Abrir Gente' });
    expect(link).toHaveAttribute('href', '#/gente');
    expect(link).toHaveTextContent('Tu genteTodo al día');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('mientras carga reserva una fila con el esqueleto y no afirma nada', async () => {
    let answer: (v: { data: unknown[]; error: null }) => void = () => {};
    const rpc = vi.fn(() => new Promise((resolve) => { answer = resolve; }));
    renderTuGente(account(rpc));
    expect(screen.getByRole('status')).toHaveTextContent('Cargando lo pendiente con tu gente…');
    expect(screen.getByRole('main').querySelector('.sk')).not.toBeNull();
    expect(screen.queryByText('Todo al día')).not.toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(3);
    answer({ data: [], error: null });
  });

  it('si falla la carga, una fila neutra «Tu gente» que lleva a Gente, sin decir «Todo al día»', async () => {
    renderTuGente(account(rpcWith({}, true)));
    const link = await screen.findByRole('link', { name: 'Tu gente. Abrir Gente' });
    expect(link).toHaveAttribute('href', '#/gente');
    expect(screen.queryByText('Todo al día')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });
});
