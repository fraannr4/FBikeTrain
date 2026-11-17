import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { CommunityRetos } from '../src/ui/pages/CommunityRetos';
import { CommunityReto } from '../src/ui/pages/CommunityReto';
import { JournalFeed } from '../src/ui/profile/JournalFeed';
import { listJournal, type JournalPost } from '../src/social/journal';
import type { CommunityChallenge, CommunityMember } from '../src/social/communityChallenges';

vi.mock('../src/social/journal', () => ({ createPost: vi.fn(), deletePost: vi.fn(), listJournal: vi.fn() }));
vi.mock('../src/db/repo', () => ({ listActivities: vi.fn(async () => []) }));
vi.mock('../src/ui/profile/ProfileAvatar', () => ({ ProfileAvatar: () => <span /> }));

const DAY = 86_400_000;
const member = (id: string, name: string, score: number | null): CommunityMember => ({ id, username: id, display_name: name, status: 'accepted', accepted_at: null, score, updated_at: null });
const RETO: CommunityChallenge = {
  id: 'c3', title: 'Collado de las Encinas', kind: 'distance', created_at: new Date(Date.now() - DAY).toISOString(), deadline: new Date(Date.now() + 2.5 * DAY).toISOString(),
  creator_id: 'p4', target_value: null, distance_m: null, segment_key: null, status: 'active', winner_ids: [], members: [member('p4', 'Ana', 9000), member('u1', 'Tú', 12_500)],
};
const POST = (id: string): JournalPost => ({
  id, author_id: 'p9', body: `Historia ${id}`, visibility: 'everyone', created_at: '2026-11-13T12:00:00Z',
  ride: { activity_date: '2026-11-13', distance_m: 42000, moving_time_s: 5400, elev_gain_m: 300 },
  author: { id: 'p9', username: 'ana', display_name: 'Ana', riding_style: 'explorar', avatar_version: 0 },
});

type Writer = { insert: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>; match: ReturnType<typeof vi.fn> };
function fakeClient(likes: Record<string, { like_count: number; liked: boolean }>, extra: (fn: string, args?: Record<string, unknown>) => unknown = () => ({ data: null, error: null })) {
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === 'list_likes') return { data: (args?.ids as string[]).map(id => ({ object_id: id, ...(likes[id] ?? { like_count: 0, liked: false }) })), error: null };
    return extra(fn, args);
  });
  const writer: Writer = { insert: vi.fn(async () => ({ error: null })), delete: vi.fn(), match: vi.fn(async () => ({ error: null })) };
  writer.delete.mockReturnValue({ match: writer.match });
  const from = vi.fn((table: string) => table === 'likes' ? writer : { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { display_name: 'Fran', avatar_version: 0 }, error: null }) })) })) });
  return { client: { rpc, from } as unknown as SupabaseClient, rpc, writer };
}
const future = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

describe('me gusta en la lista de retos', () => {
  it('pide los recuentos de todos los retos en una sola llamada y permite dar me gusta', async () => {
    const { client, rpc, writer } = fakeClient({ c3: { like_count: 4, liked: false } }, (fn, args) =>
      fn === 'list_community_challenges' ? { data: args?.page_offset ? [] : [RETO], error: null } : { data: [], error: null });
    render(<AccountContext.Provider value={{ client, user: { id: 'u1' } as User }}><MemoryRouter future={future}><CommunityRetos /></MemoryRouter></AccountContext.Provider>);
    const button = await screen.findByRole('button', { name: 'Me gusta, 4' });
    expect(rpc.mock.calls.filter(([fn]) => fn === 'list_likes')).toHaveLength(1);
    await userEvent.setup().click(button);
    expect(await screen.findByRole('button', { name: 'Quitar me gusta, 5' })).toHaveAttribute('aria-pressed', 'true');
    expect(writer.insert).toHaveBeenCalledWith({ user_id: 'u1', object_type: 'challenge', object_id: 'c3' });
  });

  it('el botón no queda dentro del enlace de la tarjeta', async () => {
    const { client } = fakeClient({}, fn => fn === 'list_community_challenges' ? { data: [RETO], error: null } : { data: [], error: null });
    render(<AccountContext.Provider value={{ client, user: { id: 'u1' } as User }}><MemoryRouter future={future}><CommunityRetos /></MemoryRouter></AccountContext.Provider>);
    const button = await screen.findByRole('button', { name: 'Me gusta' });
    expect(button.closest('a')).toBeNull();
  });
});

describe('me gusta en el detalle del reto', () => {
  it('muestra el recuento y vuelve atrás si el servidor lo rechaza', async () => {
    const { client, writer } = fakeClient({ c3: { like_count: 2, liked: true } }, fn => fn === 'get_community_challenge' ? { data: RETO, error: null } : { data: null, error: null });
    writer.match.mockResolvedValue({ error: { message: 'rls', code: '42501' } });
    render(<AccountContext.Provider value={{ client, user: { id: 'u1' } as User }}>
      <MemoryRouter initialEntries={['/retos/comunidad/c3']} future={future}><Routes><Route path="/retos/comunidad/:id" element={<CommunityReto />} /></Routes></MemoryRouter>
    </AccountContext.Provider>);
    const button = await screen.findByRole('button', { name: 'Quitar me gusta, 2' });
    await userEvent.setup().click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se ha podido guardar tu me gusta');
    expect(screen.getByRole('button', { name: 'Quitar me gusta, 2' })).toBeInTheDocument();
  });
});

describe('me gusta en las salidas compartidas', () => {
  it('cada publicación lleva su botón con un único pedido para toda la página', async () => {
    vi.mocked(listJournal).mockResolvedValue([POST('p1'), POST('p2')]);
    const { client, rpc, writer } = fakeClient({ p1: { like_count: 1, liked: true }, p2: { like_count: 0, liked: false } });
    render(<MemoryRouter future={future}><JournalFeed client={client} userId="u1" targetId={null} /></MemoryRouter>);
    expect(await screen.findAllByRole('article', { name: 'Publicación de Ana' })).toHaveLength(2);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Quitar me gusta, 1' })).toBeInTheDocument());
    const likes = rpc.mock.calls.filter(([fn]) => fn === 'list_likes');
    expect(likes).toHaveLength(1);
    expect(likes[0][1]).toEqual({ kind: 'post', ids: ['p1', 'p2'] });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Me gusta' }));
    expect(writer.insert).toHaveBeenCalledWith({ user_id: 'u1', object_type: 'post', object_id: 'p2' });
    const cards = screen.getAllByRole('article');
    expect(within(cards[1]).getByRole('button', { name: 'Quitar me gusta, 1' })).toHaveAttribute('aria-pressed', 'true');
  });
});
