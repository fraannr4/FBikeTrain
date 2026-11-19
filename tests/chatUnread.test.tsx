import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext, type Account } from '../src/auth/AccountBoundary';
import { chatUnreadLabel, notifyChatChanged } from '../src/social/chatBadge';
import { ChatButton } from '../src/ui/shell/ChatButton';
import { ChatUnreadProvider } from '../src/ui/shell/ChatUnreadContext';
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

function renderButton(unread: number, value: Account | null) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AccountContext.Provider value={value}>
        <ChatUnreadProvider value={unread}><ChatButton /></ChatUnreadProvider>
      </AccountContext.Provider>
    </MemoryRouter>,
  );
}

describe('icono de chat de la barra superior', () => {
  it('abre el chat y dice cuántas conversaciones hay sin leer', () => {
    renderButton(2, account(vi.fn()));
    const link = screen.getByRole('link', { name: 'Chat, 2 conversaciones sin leer' });
    expect(link).toHaveAttribute('href', '/chat');
    expect(link.querySelector('.tab-badge')).toHaveTextContent('2');
  });
  it('singular, sin insignia a cero y «9+» por encima de nueve', () => {
    expect(chatUnreadLabel(1)).toBe('Chat, 1 conversación sin leer');
    const zero = renderButton(0, account(vi.fn()));
    expect(screen.getByRole('link', { name: 'Chat' }).querySelector('.tab-badge')).toBeNull();
    zero.unmount();
    renderButton(12, account(vi.fn()));
    expect(screen.getByRole('link', { name: 'Chat, 12 conversaciones sin leer' }).querySelector('.tab-badge')).toHaveTextContent('9+');
  });
  it('sin cuenta o con cuenta anónima no se pinta', () => {
    expect(renderButton(3, null).container).toBeEmptyDOMElement();
    expect(renderButton(3, account(vi.fn(), true)).container).toBeEmptyDOMElement();
  });
});

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
