import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { TabBar } from '../src/ui/shell/TabBar';
import { Page } from '../src/ui/components/Page';

function fakeClient() {
  const single = vi.fn().mockResolvedValue({ data: { display_name: 'Ana Ruta', avatar_version: 0 }, error: null });
  const from = vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) }));
  return { from, rpc: vi.fn().mockResolvedValue({ data: [], error: null }) } as unknown as SupabaseClient;
}

function withAccount(ui: ReactNode, path = '/') {
  return render(
    <AccountContext.Provider value={{ client: fakeClient(), user: { id: 'u1' } as User }}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>
    </AccountContext.Provider>,
  );
}

describe('Pestaña Retos', () => {
  it('con cuenta, la quinta pestaña del móvil es Retos y lleva el contador en el nombre', () => {
    withAccount(<TabBar pathname="/" planBadge={0} retosBadge={2} />);
    const nav = screen.getByRole('navigation', { name: 'Menú principal' });
    const retos = within(nav).getAllByRole('link', { name: 'Retos, 2 pendientes' });
    // Uno es la pestaña del móvil y otro el del bloque Comunidad del ordenador: los dos con el contador.
    expect(retos).toHaveLength(2);
    retos.forEach((link) => expect(link).toHaveAttribute('href', '/retos'));
    expect(retos.map((link) => link.textContent)).toEqual(['2Retos', '2Retos']);
    expect(within(nav).queryByRole('link', { name: 'Perfil' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Tu perfil' })).toHaveAttribute('href', '/perfil');
  });

  it('el contador pasa de 9 a «9+» y desaparece en cero', () => {
    const { rerender } = withAccount(<TabBar pathname="/" planBadge={0} retosBadge={12} />);
    expect(screen.getAllByRole('link', { name: 'Retos, 12 pendientes' })[0]).toHaveTextContent('9+');
    rerender(
      <AccountContext.Provider value={{ client: fakeClient(), user: { id: 'u1' } as User }}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><TabBar pathname="/" planBadge={0} retosBadge={0} /></MemoryRouter>
      </AccountContext.Provider>,
    );
    expect(screen.getAllByRole('link', { name: 'Retos' })).toHaveLength(2);
  });

  it.each(['/retos', '/retos/comunidad/c1', '/ciclistas'])('en %s la pestaña Retos del móvil es la actual', (path) => {
    withAccount(<TabBar pathname={path} planBadge={0} retosBadge={0} />, path);
    const mobile = screen.getAllByRole('link', { name: 'Retos' }).find((a) => a.classList.contains('tab--mobile'));
    expect(mobile).toHaveAttribute('aria-current', 'page');
  });

  it('en /perfil/amigos el bloque Comunidad marca Amigos y no Tu perfil', () => {
    withAccount(<TabBar pathname="/perfil/amigos" planBadge={0} retosBadge={0} />, '/perfil/amigos');
    const group = screen.getByRole('group', { name: 'Comunidad' });
    expect(within(group).getByRole('link', { name: 'Amigos' })).toHaveAttribute('aria-current', 'page');
    expect(within(group).getByRole('link', { name: 'Amigos' })).toHaveAttribute('href', '/perfil/amigos');
    expect(within(group).getByRole('link', { name: 'Tu perfil' })).not.toHaveAttribute('aria-current');
  });
});

describe('Foto del perfil en la cabecera', () => {
  it('las pantallas raíz llevan tu foto, que abre el perfil', async () => {
    withAccount(<Page title="Historial" />);
    const link = await screen.findByRole('link', { name: 'Tu perfil' });
    expect(link).toHaveAttribute('href', '/perfil');
    await waitFor(() => expect(link).toHaveTextContent('A'));
  });

  it('las pantallas secundarias no la llevan', () => {
    withAccount(<Page title="Subidas" back="/historial" />);
    expect(screen.queryByRole('link', { name: 'Tu perfil' })).not.toBeInTheDocument();
  });

  it('sin cuenta no hay foto', () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Page title="Historial" /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Tu perfil' })).not.toBeInTheDocument();
  });
});
