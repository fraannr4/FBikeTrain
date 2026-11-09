import { render, screen, act } from '@testing-library/react';
import type { SupabaseClient, AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AccountBoundary } from '../src/auth/AccountBoundary';
import { db } from '../src/db/db';

function mockClient(user: { id: string } | null = null) {
  let emit: (event: AuthChangeEvent, session: Session | null) => void;
  const session = user ? { user } : null;
  const client = { auth: {
    onAuthStateChange: vi.fn(callback => { emit = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
    getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
  } } as unknown as SupabaseClient;
  return { client, emit: (s: Session | null) => emit('SIGNED_OUT', s) };
}

describe('guardia obligatoria de cuenta', () => {
  const initialize = async () => {};
  it('no monta datos ni navegación antes de iniciar sesión', async () => {
    const { client } = mockClient();
    const child = vi.fn(() => <p>Datos privados</p>);
    const Child = child;
    render(<AccountBoundary client={client} initialize={initialize}><Child /></AccountBoundary>);
    expect(await screen.findByRole('heading', { name: 'Vuelve a tu ritmo' })).toBeVisible();
    expect(child).not.toHaveBeenCalled();
  });
  it('selecciona la base del usuario antes de montar sus pantallas y las retira al salir', async () => {
    const { client, emit } = mockClient({ id: '00000000-0000-0000-0000-000000000088' });
    render(<AccountBoundary client={client} initialize={initialize}><p>Datos privados</p></AccountBoundary>);
    expect(await screen.findByText('Datos privados')).toBeVisible();
    expect(db.name).toBe('ciclismo-user-00000000-0000-0000-0000-000000000088');
    act(() => emit(null));
    expect(await screen.findByRole('heading', { name: 'Vuelve a tu ritmo' })).toBeVisible();
    expect(screen.queryByText('Datos privados')).not.toBeInTheDocument();
    await db.delete();
  });
  it('retira los datos de la cuenta anterior antes de recargar al cambiar de identidad', async () => {
    const { client, emit } = mockClient({ id: '00000000-0000-0000-0000-000000000087' });
    const reload = vi.fn();
    render(<AccountBoundary client={client} initialize={initialize} reload={reload}><p>Datos privados</p></AccountBoundary>);
    await screen.findByText('Datos privados');
    act(() => emit({ user: { id: '00000000-0000-0000-0000-000000000086' } } as Session));
    expect(screen.queryByText('Datos privados')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Preparando');
    expect(reload).toHaveBeenCalledOnce();
    await db.delete();
  });
  it('permite volver a entrar tras un error de callback', async () => {
    const { client, emit } = mockClient();
    render(<AccountBoundary client={client} initialize={async () => { throw new Error('expired'); }}><p>Datos privados</p></AccountBoundary>);
    await screen.findByRole('alert');
    act(() => emit({ user: { id: '00000000-0000-0000-0000-000000000085' } } as Session));
    expect(await screen.findByText('Datos privados')).toBeVisible();
    await db.delete();
  });
});
