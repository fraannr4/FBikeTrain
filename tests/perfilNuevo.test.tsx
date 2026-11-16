import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { PerfilNuevo } from '../src/ui/pages/PerfilNuevo';
import { uploadAvatar } from '../src/social/avatar';
import { loadSettings, saveSettings } from '../src/settings/settings';

vi.mock('../src/settings/settings', () => ({ loadSettings: vi.fn(), saveSettings: vi.fn() }));
vi.mock('../src/social/avatar', () => ({ uploadAvatar: vi.fn(), avatarBlob: vi.fn().mockResolvedValue(null) }));

const USER_ID = '00000000-0000-0000-0000-0000000000a1';
const DEFAULT_ROW = { username: USER_ID.replace(/-/g, ''), display_name: 'Ciclista', bio: null, riding_style: 'explorar', avatar_version: 0 };

function fakeClient(writeResult: { data: unknown; error: unknown } = { data: { id: USER_ID }, error: null }) {
  const read = vi.fn().mockResolvedValue({ data: { ...DEFAULT_ROW }, error: null });
  const write = vi.fn().mockResolvedValue(writeResult);
  const update = vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(() => ({ single: write })) })) }));
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ single: read })) }));
  const from = vi.fn(() => ({ select, update }));
  return { client: { from } as unknown as SupabaseClient, update, write };
}

function renderStep(client: SupabaseClient, path = '/perfil/nuevo') {
  return render(
    <AccountContext.Provider value={{ client, user: { id: USER_ID } as User }}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/perfil/nuevo" element={<PerfilNuevo />} />
          <Route path="/" element={<p>Pantalla de Inicio</p>} />
          <Route path="/zona" element={<p>Pantalla de Tu zona</p>} />
        </Routes>
      </MemoryRouter>
    </AccountContext.Provider>,
  );
}

async function fillIdentity(name: string, username: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Nombre visible'), name);
  await user.type(screen.getByLabelText('Nombre de usuario'), username);
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadSettings).mockResolvedValue({ displayName: '', home: null } as unknown as Awaited<ReturnType<typeof loadSettings>>);
  vi.mocked(saveSettings).mockResolvedValue(undefined);
});

describe('Configura tu perfil', () => {
  it('empieza con los campos vacíos aunque el perfil tenga los valores por defecto', async () => {
    const { client } = fakeClient();
    renderStep(client);
    expect(await screen.findByLabelText('Nombre visible')).toHaveValue('');
    expect(screen.getByLabelText('Nombre de usuario')).toHaveValue('');
  });

  it('rechaza un nombre de usuario con formato no válido sin llamar al servidor', async () => {
    const { client, update } = fakeClient();
    renderStep(client);
    await fillIdentity('Ana', 'a!');
    expect(await screen.findByText(/Usa entre 3 y 32 letras minúsculas, números o guiones bajos/)).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it('pide el nombre visible', async () => {
    const { client, update } = fakeClient();
    renderStep(client);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nombre de usuario'), 'ana_ruta');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText('Escribe el nombre que verán los demás ciclistas.')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it('avisa si el nombre de usuario ya está ocupado y no avanza', async () => {
    const { client } = fakeClient({ data: null, error: { code: '23505', message: 'duplicate key' } });
    renderStep(client);
    await fillIdentity('Ana', 'ana_ruta');
    expect(await screen.findByText('Ese nombre de usuario ya está ocupado. Elige otro.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Más tarde' })).not.toBeInTheDocument();
  });

  it('guarda nombre y usuario en minúsculas y pasa a la foto y la descripción', async () => {
    const { client, update } = fakeClient();
    renderStep(client);
    await fillIdentity('  Ana del Puerto  ', 'Ana_Ruta');
    expect(await screen.findByRole('button', { name: 'Más tarde' })).toBeInTheDocument();
    expect(update).toHaveBeenCalledWith({ display_name: 'Ana del Puerto', username: 'ana_ruta' });
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Ana del Puerto' }));
  });

  it('«Más tarde» deja la foto y la descripción para otro momento y sigue a Tu zona si falta', async () => {
    const { client, update } = fakeClient();
    renderStep(client, '/perfil/nuevo?siguiente=zona');
    const user = await fillIdentity('Ana', 'ana_ruta');
    await user.click(await screen.findByRole('button', { name: 'Más tarde' }));
    expect(await screen.findByText('Pantalla de Tu zona')).toBeInTheDocument();
    expect(update).toHaveBeenCalledOnce();
  });

  it('si la foto falla lo explica y deja terminar el paso', async () => {
    vi.mocked(uploadAvatar).mockRejectedValue(new Error('No se pudo subir tu foto. Comprueba la conexión e inténtalo de nuevo.'));
    const { client } = fakeClient();
    renderStep(client);
    const user = await fillIdentity('Ana', 'ana_ruta');
    const file = new File(['x'], 'foto.png', { type: 'image/png' });
    await user.upload(await screen.findByLabelText('Archivo de foto de perfil'), file);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo subir tu foto');
    await user.click(screen.getByRole('button', { name: 'Más tarde' }));
    expect(await screen.findByText('Pantalla de Inicio')).toBeInTheDocument();
  });

  it('guarda la descripción y la manera de rodar al terminar', async () => {
    const { client, update } = fakeClient();
    renderStep(client);
    const user = await fillIdentity('Ana', 'ana_ruta');
    await user.type(await screen.findByLabelText(/^Sobre ti/), '  Puertos y café.  ');
    await user.click(screen.getByRole('radio', { name: 'Subir' }));
    await user.click(screen.getByRole('button', { name: 'Guardar y empezar' }));
    expect(await screen.findByText('Pantalla de Inicio')).toBeInTheDocument();
    expect(update).toHaveBeenLastCalledWith({ bio: 'Puertos y café.', riding_style: 'subir' });
  });
});
