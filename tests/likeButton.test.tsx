import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LikeButton } from '../src/ui/likes/LikeButton';
import { useLikes } from '../src/ui/likes/useLikes';
import { fetchLikes, setLike } from '../src/social/likes';

vi.mock('../src/social/likes', async importOriginal => ({ ...await importOriginal<typeof import('../src/social/likes')>(), fetchLikes: vi.fn(), setLike: vi.fn() }));
const client = {} as SupabaseClient;

describe('LikeButton', () => {
  it('sin me gusta: nombre «Me gusta», sin pulsar y sin recuento visible', () => {
    render(<LikeButton count={0} liked={false} onToggle={() => {}} />);
    const button = screen.getByRole('button', { name: 'Me gusta' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveTextContent('');
  });

  it('con me gusta propio: «Quitar me gusta» con el recuento en es-ES y aria-pressed', () => {
    render(<LikeButton count={12345} liked onToggle={() => {}} />);
    const button = screen.getByRole('button', { name: 'Quitar me gusta, 12.345' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveTextContent('12.345');
  });

  it('el recuento ajeno se anuncia con el verbo de dar', () => {
    render(<LikeButton count={3} liked={false} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Me gusta, 3' })).toBeInTheDocument();
  });

  it('avisa al tocar y no se activa mientras está ocupado', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<LikeButton count={1} liked={false} onToggle={onToggle} />);
    await user.click(screen.getByRole('button', { name: 'Me gusta, 1' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<LikeButton count={1} liked={false} onToggle={onToggle} busy />);
    await user.click(screen.getByRole('button', { name: 'Me gusta, 1' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('anuncia el fallo en una región de alerta', () => {
    render(<LikeButton count={0} liked={false} onToggle={() => {}} failed />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se ha podido guardar tu me gusta. Inténtalo de nuevo.');
  });
});

describe('useLikes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchLikes).mockResolvedValue({ a: { count: 2, liked: false } });
    vi.mocked(setLike).mockResolvedValue(undefined);
  });

  it('carga todos los ids en una sola llamada y no recarga si la lista es la misma', async () => {
    const { result, rerender } = renderHook(({ ids }) => useLikes(client, 'u1', 'post', ids), { initialProps: { ids: ['a', 'b'] } });
    await waitFor(() => expect(result.current.get('a')).toEqual({ count: 2, liked: false }));
    expect(result.current.get('b')).toEqual({ count: 0, liked: false });
    rerender({ ids: ['a', 'b'] });
    expect(fetchLikes).toHaveBeenCalledTimes(1);
    expect(fetchLikes).toHaveBeenCalledWith(client, 'post', ['a', 'b']);
  });

  it('actualiza al instante, antes de que responda el servidor', async () => {
    let resolve!: () => void;
    vi.mocked(setLike).mockReturnValue(new Promise<void>(r => { resolve = r; }));
    const { result } = renderHook(() => useLikes(client, 'u1', 'post', ['a']));
    await waitFor(() => expect(result.current.get('a').count).toBe(2));
    act(() => { void result.current.toggle('a'); });
    expect(result.current.get('a')).toEqual({ count: 3, liked: true });
    expect(result.current.isBusy('a')).toBe(true);
    expect(setLike).toHaveBeenCalledWith(client, 'u1', 'post', 'a', true);
    await act(async () => { resolve(); });
    expect(result.current.get('a')).toEqual({ count: 3, liked: true });
    expect(result.current.isBusy('a')).toBe(false);
  });

  it('vuelve atrás y marca el fallo si el servidor lo rechaza', async () => {
    vi.mocked(setLike).mockRejectedValue(new Error('No se ha podido guardar tu me gusta. Inténtalo de nuevo.'));
    const { result } = renderHook(() => useLikes(client, 'u1', 'post', ['a']));
    await waitFor(() => expect(result.current.get('a').count).toBe(2));
    await act(async () => { await result.current.toggle('a'); });
    expect(result.current.get('a')).toEqual({ count: 2, liked: false });
    expect(result.current.hasFailed('a')).toBe(true);
  });

  it('quitar me gusta resta y nunca baja de cero', async () => {
    vi.mocked(fetchLikes).mockResolvedValue({ a: { count: 1, liked: true } });
    const { result } = renderHook(() => useLikes(client, 'u1', 'post', ['a']));
    await waitFor(() => expect(result.current.get('a').liked).toBe(true));
    await act(async () => { await result.current.toggle('a'); });
    expect(result.current.get('a')).toEqual({ count: 0, liked: false });
    expect(setLike).toHaveBeenCalledWith(client, 'u1', 'post', 'a', false);
  });

  it('ignora un segundo toque mientras el primero está en vuelo', async () => {
    let resolve!: () => void;
    vi.mocked(setLike).mockReturnValue(new Promise<void>(r => { resolve = r; }));
    const { result } = renderHook(() => useLikes(client, 'u1', 'post', ['a']));
    await waitFor(() => expect(result.current.get('a').count).toBe(2));
    act(() => { void result.current.toggle('a'); void result.current.toggle('a'); });
    expect(setLike).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(); });
  });

  it('si no se pueden leer, el botón sigue disponible a cero', async () => {
    vi.mocked(fetchLikes).mockRejectedValue(new Error('No se han podido cargar los me gusta.'));
    const { result } = renderHook(() => useLikes(client, 'u1', 'post', ['a']));
    await waitFor(() => expect(fetchLikes).toHaveBeenCalled());
    expect(result.current.get('a')).toEqual({ count: 0, liked: false });
  });
});
