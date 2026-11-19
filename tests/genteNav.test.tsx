import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext, type Account } from '../src/auth/AccountBoundary';
import { GenteNav } from '../src/ui/gente/GenteNav';
import { GentePendingProvider, type GentePending } from '../src/ui/shell/GentePendingContext';
import { ToastProvider } from '../src/ui/components/Toast';
import { Chats } from '../src/ui/pages/Chats';
import { Amigos } from '../src/ui/pages/Amigos';
import { CommunityRetos } from '../src/ui/pages/CommunityRetos';
import { Ciclistas } from '../src/ui/pages/Ciclistas';

const rpc = vi.fn(async () => ({ data: [], error: null }));
const from = vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { display_name: 'Ana', avatar_version: 0 }, error: null }) })) })) }));
const REGISTERED: Account = { client: { rpc, from } as unknown as SupabaseClient, user: { id: 'u1' } as User };
const ANONYMOUS: Account = { client: { rpc, from } as unknown as SupabaseClient, user: { id: 'u1', is_anonymous: true } as User };
const gente = (chats = 0, amigos = 0, retos = 0): GentePending => ({ chats, amigos, retos, total: chats + amigos + retos });

function renderAt(path: string, ui: ReactNode, account: Account | null = REGISTERED, pending = gente()) {
  return render(
    <AccountContext.Provider value={account}>
      <GentePendingProvider value={pending}>
        <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ToastProvider>{ui}</ToastProvider>
        </MemoryRouter>
      </GentePendingProvider>
    </AccountContext.Provider>,
  );
}
const parts = () => within(screen.getByRole('navigation', { name: 'Partes de Gente' })).getAllByRole('link');

describe('GenteNav', () => {
  it('cuatro enlaces: Chats, Amigos, Retos y Ciclistas, cada uno a su dirección', () => {
    renderAt('/chat', <GenteNav />);
    expect(parts().map((a) => a.textContent)).toEqual(['Chats', 'Amigos', 'Retos', 'Ciclistas']);
    expect(parts().map((a) => a.getAttribute('href'))).toEqual(['/chat', '/perfil/amigos', '/retos', '/ciclistas']);
  });

  it.each([
    ['/chat', 'Chats'], ['/perfil/amigos', 'Amigos'], ['/retos', 'Retos'], ['/ciclistas', 'Ciclistas'],
  ])('en %s marca %s con aria-current', (path, label) => {
    renderAt(path, <GenteNav />);
    const current = parts().filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(label);
  });

  it('reparte lo pendiente: contador junto al rótulo y nombre que lo dice', () => {
    renderAt('/chat', <GenteNav />, REGISTERED, gente(2, 1, 3));
    expect(parts().map((a) => a.getAttribute('aria-label'))).toEqual(['Chats, 2 sin leer', 'Amigos, 1 solicitud', 'Retos, 3 pendientes', null]);
    expect(parts().map((a) => a.querySelector('.seg-count')?.textContent ?? null)).toEqual(['2', '1', '3', null]);
  });

  it('sin pendientes no hay contadores; por encima de nueve, «9+»', () => {
    const { unmount } = renderAt('/chat', <GenteNav />);
    expect(document.querySelector('.seg-count')).toBeNull();
    unmount();
    renderAt('/chat', <GenteNav />, REGISTERED, gente(120, 2, 1));
    expect(screen.getByRole('link', { name: 'Chats, 120 sin leer' }).querySelector('.seg-count')).toHaveTextContent('9+');
    expect(screen.getByRole('link', { name: 'Amigos, 2 solicitudes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Retos, 1 pendiente' })).toBeInTheDocument();
  });

  it.each([['sin cuenta', null], ['con cuenta anónima', ANONYMOUS]] as const)('%s no se pinta', (_, account) => {
    renderAt('/chat', <GenteNav />, account, gente(2, 1, 1));
    expect(screen.queryByRole('navigation', { name: 'Partes de Gente' })).not.toBeInTheDocument();
  });
});

describe('las cuatro partes de «Gente»', () => {
  it.each([
    ['/chat', 'Chats', <Chats key="c" />, 'Chat'],
    ['/perfil/amigos', 'Amigos', <Amigos key="a" />, 'Amigos'],
    ['/retos', 'Retos', <CommunityRetos key="r" />, 'Retos'],
    ['/ciclistas', 'Ciclistas', <Ciclistas key="ci" />, 'Ciclistas'],
  ])('%s: pantalla raíz con título «Gente», su parte marcada y el documento con su nombre', async (path, part, page, doc) => {
    renderAt(path, page);
    expect(screen.getByRole('heading', { level: 1, name: 'Gente' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Volver/ })).not.toBeInTheDocument();
    const current = parts().filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent)).toEqual([part]);
    expect(document.title).toBe(`${doc} · FBikeTrain`);
    expect(await screen.findByRole('link', { name: 'Tú: perfil, importar y ajustes' })).toHaveAttribute('href', '/perfil');
  });

  it('«Nuevo chat» sigue en la barra de Chats', () => {
    renderAt('/chat', <Chats />);
    expect(screen.getByRole('link', { name: 'Nuevo chat' })).toHaveAttribute('href', '/perfil/amigos');
  });
});
