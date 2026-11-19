import { act, renderHook, waitFor } from '@testing-library/react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Account } from '../src/auth/AccountBoundary';
import { notifyCommunityChanged } from '../src/social/communityBadge';
import type { FriendRow } from '../src/social/friends';
import { genteStart, useGenteCounts, type GentePending } from '../src/ui/shell/GentePendingContext';
import { useFriendRequests } from '../src/ui/shell/useFriendRequests';

const DAY = 86_400_000;
const card = (id: string) => ({ id, username: id, display_name: id, locality: null, distance_km: null });
const friend = (id: string, status: FriendRow['status'], direction: FriendRow['direction']): FriendRow => ({ friendship_id: id, status, direction, profile: card(id) });
/** Invitación a un reto que acaba en una semana: cuenta como pendiente para u1. */
const invitation = (id: string) => ({
  id, title: id, kind: 'distance', created_at: new Date().toISOString(), deadline: new Date(Date.now() + 7 * DAY).toISOString(),
  creator_id: 'p2', target_value: null, distance_m: null, segment_key: null, status: 'active', winner_ids: [],
  members: [
    { id: 'p2', username: 'p2', display_name: 'p2', status: 'accepted', accepted_at: null, score: null, updated_at: null },
    { id: 'u1', username: 'u1', display_name: 'u1', status: 'pending', accepted_at: null, score: null, updated_at: null },
  ],
});

const account = (rpc: ReturnType<typeof vi.fn>, anonymous = false): Account => ({
  client: { rpc } as unknown as SupabaseClient,
  user: { id: 'u1', is_anonymous: anonymous } as User,
});
const pending = (over: Partial<GentePending> = {}): GentePending => ({ chats: 0, amigos: 0, retos: 0, total: 0, ...over });

afterEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

describe('genteStart: la parte de «Gente» que se abre', () => {
  it.each([
    [pending(), '/chat'],
    [pending({ chats: 2, amigos: 1, retos: 1 }), '/chat'],
    [pending({ chats: 1 }), '/chat'],
    [pending({ retos: 3 }), '/retos'],
    [pending({ amigos: 1 }), '/perfil/amigos'],
    [pending({ amigos: 1, retos: 1 }), '/retos'],
    [pending({ chats: 1, amigos: 4 }), '/chat'],
  ])('con %o abre %s', (p, to) => {
    expect(genteStart(p)).toBe(to);
  });
});

describe('useFriendRequests: solicitudes recibidas sin responder', () => {
  it('cuenta solo las pendientes recibidas', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [friend('a', 'pending', 'received'), friend('b', 'pending', 'received'), friend('c', 'pending', 'sent'), friend('d', 'accepted', 'received')],
      error: null,
    });
    const who = account(rpc);
    const { result } = renderHook(() => useFriendRequests(who, '/'));
    await waitFor(() => expect(result.current).toBe(2));
    expect(rpc).toHaveBeenCalledWith('list_friends');
  });

  it('vuelve a contar al cambiar la clave, con COMMUNITY_CHANGED_EVENT y al volver a la app', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [friend('a', 'pending', 'received')], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [friend('a', 'pending', 'received'), friend('b', 'pending', 'received')], error: null })
      .mockResolvedValue({ data: [friend('c', 'pending', 'received')], error: null });
    const who = account(rpc);
    const { result, rerender } = renderHook(({ key }) => useFriendRequests(who, key), { initialProps: { key: '' } });
    await waitFor(() => expect(result.current).toBe(1));
    act(() => notifyCommunityChanged());
    await waitFor(() => expect(result.current).toBe(0));
    rerender({ key: '/perfil/amigos' });
    await waitFor(() => expect(result.current).toBe(2));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(result.current).toBe(1));
  });

  it('sin cuenta o con cuenta anónima da cero y no llama', () => {
    const rpc = vi.fn();
    expect(renderHook(() => useFriendRequests(null, '/')).result.current).toBe(0);
    expect(renderHook(() => useFriendRequests(account(rpc, true), '/')).result.current).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('un fallo de red deja el contador a cero', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [friend('a', 'pending', 'received')], error: null })
      .mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    const who = account(rpc);
    const { result } = renderHook(() => useFriendRequests(who, '/'));
    await waitFor(() => expect(result.current).toBe(1));
    act(() => notifyCommunityChanged());
    await waitFor(() => expect(result.current).toBe(0));
  });
});

describe('useGenteCounts: lo que el armazón reparte', () => {
  function rpcWith({ chats = 0, friends = [] as FriendRow[], challenges = [] as unknown[] }) {
    return vi.fn(async (fn: string) => {
      if (fn === 'chat_unread_count') return { data: chats, error: null };
      if (fn === 'list_friends') return { data: friends, error: null };
      if (fn === 'list_community_challenges') return { data: challenges, error: null };
      return { data: null, error: null };
    });
  }

  it('suma chats, solicitudes de amistad y retos', async () => {
    const rpc = rpcWith({ chats: 2, friends: [friend('a', 'pending', 'received')], challenges: [invitation('r1')] });
    const who = account(rpc);
    const { result } = renderHook(() => useGenteCounts(who, '/'));
    await waitFor(() => expect(result.current).toEqual({ chats: 2, amigos: 1, retos: 1, total: 4 }));
  });

  it('con cuenta anónima todo es cero y no llama a nada', async () => {
    const rpc = rpcWith({ chats: 5 });
    const who = account(rpc, true);
    const { result } = renderHook(() => useGenteCounts(who, '/'));
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toEqual(pending());
    expect(rpc).not.toHaveBeenCalled();
  });

  it('si la red falla, los contadores se quedan a cero', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    const who = account(rpc);
    const { result } = renderHook(() => useGenteCounts(who, '/'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(3));
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toEqual(pending());
  });
});
