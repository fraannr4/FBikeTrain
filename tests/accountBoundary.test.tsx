import { render, screen, act, fireEvent } from '@testing-library/react';
import type { SupabaseClient, AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AccountBoundary } from '../src/auth/AccountBoundary';
import { db } from '../src/db/db';
import { armFreshSignIn, disarmFreshSignIn } from '../src/auth/useFreshSignIn';

function mockClient(user: { id: string } | null = null) {
  let emit: (event: AuthChangeEvent, session: Session | null) => void;
  const session = user ? { user } : null;
  const client = { auth: {
    onAuthStateChange: vi.fn(callback => { emit = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
    getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
  } } as unknown as SupabaseClient;
  return { client, emit: (s: Session | null) => emit('SIGNED_OUT', s), emitEvent: (e: AuthChangeEvent, s: Session | null) => emit(e, s) };
}

describe('guardia obligatoria de cuenta', () => {
  const initialize = async () => {};
  it('no monta datos ni navegación antes de iniciar sesión', async () => {
    const { client } = mockClient();
    const child = vi.fn(() => <p>Datos privados</p>);
    const Child = child;
    render(<AccountBoundary client={client} initialize={initialize}><Child /></AccountBoundary>);
    expect(await screen.findByRole('heading', { name: 'Vuelve a tu ritmo' }, { timeout: 5000 })).toBeVisible();
    expect(child).not.toHaveBeenCalled();
  });
  it('selecciona la base del usuario antes de montar sus pantallas y las retira al salir', async () => {
    const { client, emit } = mockClient({ id: '00000000-0000-0000-0000-000000000088' });
    render(<AccountBoundary client={client} initialize={initialize}><p>Datos privados</p></AccountBoundary>);
    expect(await screen.findByText('Datos privados', {}, { timeout: 5000 })).toBeVisible();
    expect(db.name).toBe('ciclismo-user-00000000-0000-0000-0000-000000000088');
    act(() => emit(null));
    expect(await screen.findByRole('heading', { name: 'Vuelve a tu ritmo' }, { timeout: 5000 })).toBeVisible();
    expect(screen.queryByText('Datos privados')).not.toBeInTheDocument();
    await db.delete();
  });
  it('retira los datos de la cuenta anterior antes de recargar al cambiar de identidad', async () => {
    const { client, emit } = mockClient({ id: '00000000-0000-0000-0000-000000000087' });
    const reload = vi.fn();
    render(<AccountBoundary client={client} initialize={initialize} reload={reload}><p>Datos privados</p></AccountBoundary>);
    await screen.findByText('Datos privados', {}, { timeout: 5000 });
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
    expect(await screen.findByText('Datos privados', {}, { timeout: 5000 })).toBeVisible();
    await db.delete();
  });

  describe('bienvenida', () => {
    afterEach(() => disarmFreshSignIn());
    const ana = { user: { id: '00000000-0000-0000-0000-000000000084', email: 'ana@example.invalid', user_metadata: { full_name: 'Ana' } } } as unknown as Session;

    it('aparece tras un SIGNED_IN con la marca de una acción real y después muestra la app', async () => {
      const { client, emitEvent } = mockClient();
      render(<AccountBoundary client={client} initialize={initialize}><p>Datos privados</p></AccountBoundary>);
      await screen.findByRole('heading', { name: 'Vuelve a tu ritmo' }, { timeout: 5000 });
      armFreshSignIn();
      act(() => emitEvent('SIGNED_IN', ana));
      expect(screen.getByRole('heading', { name: 'Hola, Ana.' })).toBeInTheDocument();
      expect(screen.queryByText('Datos privados')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
      expect(await screen.findByText('Datos privados', {}, { timeout: 5000 })).toBeVisible();
      await vi.waitFor(() => expect(screen.queryByRole('heading', { name: 'Hola, Ana.' })).not.toBeInTheDocument(), { timeout: 2000 });
      await db.delete();
    });

    it('no aparece con INITIAL_SESSION ni con el SIGNED_IN que se repite al volver a la pestaña', async () => {
      const { client, emitEvent } = mockClient();
      render(<AccountBoundary client={client} initialize={initialize}><p>Datos privados</p></AccountBoundary>);
      await screen.findByRole('heading', { name: 'Vuelve a tu ritmo' }, { timeout: 5000 });
      armFreshSignIn();
      act(() => emitEvent('INITIAL_SESSION', ana));
      expect(await screen.findByText('Datos privados', {}, { timeout: 5000 })).toBeVisible();
      expect(screen.queryByRole('heading', { name: /Hola/ })).not.toBeInTheDocument();
      disarmFreshSignIn();
      act(() => emitEvent('SIGNED_IN', ana));
      expect(screen.queryByRole('heading', { name: /Hola/ })).not.toBeInTheDocument();
      await db.delete();
    });

    it('no aparece al recargar con la sesión guardada', async () => {
      const { client } = mockClient({ id: '00000000-0000-0000-0000-000000000083' });
      render(<AccountBoundary client={client} initialize={initialize}><p>Datos privados</p></AccountBoundary>);
      expect(await screen.findByText('Datos privados', {}, { timeout: 5000 })).toBeVisible();
      expect(screen.queryByRole('heading', { name: /Hola/ })).not.toBeInTheDocument();
      await db.delete();
    });

    it('aparece al volver de Google o del enlace de correo con la marca armada', async () => {
      armFreshSignIn();
      const { client } = mockClient({ id: '00000000-0000-0000-0000-000000000082' });
      render(<AccountBoundary client={client} initialize={initialize}><p>Datos privados</p></AccountBoundary>);
      expect(await screen.findByRole('heading', { name: 'Hola.' }, { timeout: 5000 })).toBeInTheDocument();
      await db.delete();
    });
  });
});
