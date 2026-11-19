import { act, renderHook, waitFor } from '@testing-library/react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Account } from '../src/auth/AccountBoundary';
import { notifyChatChanged } from '../src/social/chatBadge';
import { useChatUnread } from '../src/ui/shell/useChatUnread';

const account = (rpc: ReturnType<typeof vi.fn>, anonymous = false): Account => ({
  client: { rpc } as unknown as SupabaseClient,
  user: { id: 'u1', is_anonymous: anonymous } as User,
});
/** Cada lectura devuelve el siguiente valor; la última se repite. */
function counting(...values: number[]) {
  const rpc = vi.fn();
  values.forEach(value => rpc.mockResolvedValueOnce({ data: value, error: null }));
  return rpc.mockResolvedValue({ data: values[values.length - 1], error: null });
}

// El acceso al chat vive ahora en «Gente» (muelle, carril y GenteNav): ver shell y genteNav.
describe('recuento de conversaciones sin leer', () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  it('lee al montar y vuelve a leer al cambiar de pantalla', async () => {
    const rpc = counting(2, 5);
    const who = account(rpc);
    const { result, rerender } = renderHook(({ key }) => useChatUnread(who, key), { initialProps: { key: '/' } });
    await waitFor(() => expect(result.current).toBe(2));
    expect(rpc).toHaveBeenCalledWith('chat_unread_count');
    rerender({ key: '/historial' });
    await waitFor(() => expect(result.current).toBe(5));
  });

  it('vuelve a leer tras leer una conversación y al volver a la app: otro dispositivo pudo leerla', async () => {
    const rpc = counting(3, 1, 0);
    const who = account(rpc);
    const { result } = renderHook(() => useChatUnread(who, '/'));
    await waitFor(() => expect(result.current).toBe(3));
    act(() => notifyChatChanged());
    await waitFor(() => expect(result.current).toBe(1));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(result.current).toBe(0));
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('con la app a la vista vuelve a leer cada 60 s; oculta, no', async () => {
    vi.useFakeTimers();
    const rpc = counting(1);
    const who = account(rpc);
    renderHook(() => useChatUnread(who, '/'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(rpc).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(rpc).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('un fallo de red deja el contador a cero y no rompe', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: 4, error: null }).mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    const who = account(rpc);
    const { result } = renderHook(() => useChatUnread(who, '/'));
    await waitFor(() => expect(result.current).toBe(4));
    act(() => notifyChatChanged());
    await waitFor(() => expect(result.current).toBe(0));
  });

  it('sin cuenta, con cuenta anónima o con un cliente sin RPC no llama y devuelve cero', async () => {
    const rpc = counting(7);
    expect(renderHook(() => useChatUnread(null, '/')).result.current).toBe(0);
    expect(renderHook(() => useChatUnread(account(rpc, true), '/')).result.current).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
    const broken: Account = { client: {} as SupabaseClient, user: { id: 'u1' } as User };
    const { result } = renderHook(() => useChatUnread(broken, '/'));
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe(0);
  });

  it('al desmontar deja de escuchar', async () => {
    const rpc = counting(1);
    const who = account(rpc);
    const { unmount } = renderHook(() => useChatUnread(who, '/'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    unmount();
    notifyChatChanged();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
