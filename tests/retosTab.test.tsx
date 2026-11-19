import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { Page } from '../src/ui/components/Page';

// Retos ya no es pestaña del muelle: vive en «Gente» (ver shell.test.tsx y genteNav.test.tsx).
const YOU = 'Tú: perfil, importar y ajustes';

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

describe('Foto del perfil en la cabecera («Tú»)', () => {
  it('las pantallas raíz llevan tu foto, que abre «Tú»', async () => {
    withAccount(<Page title="Salidas" />);
    const link = await screen.findByRole('link', { name: YOU });
    expect(link).toHaveAttribute('href', '/perfil');
    await waitFor(() => expect(link).toHaveTextContent('A'));
  });

  it('ya no hay icono de chat en la barra superior', async () => {
    withAccount(<Page title="Salidas" />);
    await screen.findByRole('link', { name: YOU });
    expect(screen.queryByRole('link', { name: /^Chat/ })).not.toBeInTheDocument();
  });

  it('las pantallas secundarias no la llevan', () => {
    withAccount(<Page title="Subidas" back="/historial" />);
    expect(screen.queryByRole('link', { name: YOU })).not.toBeInTheDocument();
  });

  it('sin cuenta no hay foto', () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Page title="Salidas" /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: YOU })).not.toBeInTheDocument();
  });
});
