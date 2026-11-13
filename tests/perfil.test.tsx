import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { Perfil } from '../src/ui/pages/Perfil';
import { loadSettings, saveSettings } from '../src/settings/settings';

vi.mock('../src/settings/settings', () => ({ loadSettings: vi.fn(), saveSettings: vi.fn() }));

const PROFILE = { username: 'ana_ruta', display_name: 'Ana Ruta', stats_visibility: 'everyone' };

function fakeClient() {
  const read = vi.fn().mockResolvedValue({ data: { ...PROFILE }, error: null });
  const write = vi.fn().mockResolvedValue({ data: { id: 'u1' }, error: null });
  const update = vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(() => ({ single: write })) })) }));
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ single: read })) }));
  const from = vi.fn(() => ({ select, update }));
  const signOut = vi.fn().mockResolvedValue({ error: null });
  return { client: { from, auth: { signOut } } as unknown as SupabaseClient, read, update, signOut };
}

function renderWith(client: SupabaseClient) {
  return render(<AccountContext.Provider value={{ client, user: { id: 'u1', email: 'ana@example.invalid' } as User }}>
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Perfil /></MemoryRouter>
  </AccountContext.Provider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadSettings).mockResolvedValue({ displayName: 'Ana', home: null, orsKey: 'local-key' } as unknown as Awaited<ReturnType<typeof loadSettings>>);
  vi.mocked(saveSettings).mockResolvedValue(undefined);
});

describe('Tu perfil', () => {
  it('presenta la identidad y los accesos sociales, y explica el límite de sincronización', async () => {
    const { client } = fakeClient();
    renderWith(client);
    const identity = await screen.findByRole('region', { name: 'Tu identidad pública' });
    expect(within(identity).getByText('Ana Ruta')).toBeInTheDocument();
    expect(within(identity).getByText('@ana_ruta')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Buscar ciclistas/ })).toHaveAttribute('href', '/amigos');
    expect(screen.getByRole('link', { name: /Mis amigos/ })).toHaveAttribute('href', '/amigos?vista=amigos');
    expect(screen.getByRole('link', { name: /Mis retos/ })).toHaveAttribute('href', '/retos');
    expect(screen.getByRole('link', { name: /Tu zona/ })).toHaveAttribute('href', '/zona');
    expect(screen.getByText(/comparativas entre perfiles todavía no están disponibles/)).toBeInTheDocument();
  });

  it('permite reintentar tras un rechazo de red y tras una respuesta sin perfil', async () => {
    const { client, read } = fakeClient();
    read.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: null, error: null });
    renderWith(client);
    const user = userEvent.setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Comprueba la conexión');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar tu perfil');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('form', { name: 'Editar perfil' })).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('guarda solo los campos del perfil y actualiza el saludo sin enviar claves locales', async () => {
    const { client, update } = fakeClient();
    renderWith(client);
    const name = await screen.findByLabelText('Nombre visible');
    const user = userEvent.setup();
    await user.clear(name);
    await user.type(name, '  Ana del Puerto  ');
    await user.selectOptions(screen.getByLabelText('Quién puede ver tus estadísticas'), 'friends');
    await user.click(screen.getByRole('button', { name: 'Guardar perfil' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Perfil guardado.');
    expect(update).toHaveBeenCalledWith({ username: 'ana_ruta', display_name: 'Ana del Puerto', stats_visibility: 'friends' });
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Ana del Puerto', orsKey: 'local-key' }));
  });

  it('cierra solo la sesión del dispositivo', async () => {
    const { client, signOut } = fakeClient();
    renderWith(client);
    await screen.findByRole('form', { name: 'Editar perfil' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cerrar sesión en este dispositivo' }));
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
