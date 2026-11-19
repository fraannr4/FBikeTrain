import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { Perfil } from '../src/ui/pages/Perfil';
import { loadSettings, saveSettings } from '../src/settings/settings';
import { countActivities, getMeta } from '../src/db/repo';
import { getBackupMeta } from '../src/backup/backup';

const DAY = 86_400_000;

vi.mock('../src/settings/settings', () => ({ loadSettings: vi.fn(), saveSettings: vi.fn() }));
vi.mock('../src/db/repo', () => ({ listActivities: vi.fn().mockResolvedValue([]), countActivities: vi.fn(), getMeta: vi.fn() }));
vi.mock('../src/backup/backup', async (original) => ({ ...(await original<typeof import('../src/backup/backup')>()), getBackupMeta: vi.fn() }));
vi.mock('../src/ui/profile/JournalFeed', () => ({ JournalFeed: () => <section aria-label="Cuaderno de ruta" /> }));

const PROFILE = { username: 'ana_ruta', display_name: 'Ana Ruta', stats_visibility: 'everyone', bio: 'La bici y los puertos.', riding_style: 'explorar', avatar_version: 0 };

function fakeClient() {
  const read = vi.fn().mockResolvedValue({ data: { ...PROFILE }, error: null });
  const write = vi.fn().mockResolvedValue({ data: { id: 'u1' }, error: null });
  const update = vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(() => ({ single: write })) })) }));
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ single: read })) }));
  const from = vi.fn(() => ({ select, update }));
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  return { client: { from, rpc, auth: { signOut } } as unknown as SupabaseClient, read, update, signOut };
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
  vi.mocked(countActivities).mockResolvedValue(3);
  vi.mocked(getMeta).mockResolvedValue({ lastImportAt: Date.now() - DAY });
  vi.mocked(getBackupMeta).mockResolvedValue({});
});

describe('«Tú»: tus datos y ajustes', () => {
  const rows = () => within(screen.getByRole('list', { name: 'Tus datos y ajustes' })).getAllByRole('link');

  it('arriba, antes de la ficha: Importar salidas, Ajustes, Copia de seguridad y Privacidad', async () => {
    renderWith(fakeClient().client);
    expect(screen.getByRole('heading', { level: 1, name: 'Tú' })).toBeInTheDocument();
    expect(await screen.findByText('La última, ayer')).toBeInTheDocument();
    expect(rows().map((a) => [a.querySelector('.row-title')?.textContent, a.getAttribute('href')])).toEqual([
      ['Importar salidas', '/importar'],
      ['Ajustes', '/ajustes'],
      ['Copia de seguridad', '/ajustes?abrir=copia'],
      ['Privacidad', '#/privacidad'],
    ]);
    expect(screen.getByText('Zona, punto de salida y tema')).toBeInTheDocument();
    expect(screen.getByText('Qué se guarda y quién lo ve')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Tus datos y ajustes' });
    const identity = await screen.findByRole('region', { name: 'Tu identidad pública' });
    expect(list.compareDocumentPosition(identity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Más opciones' })).not.toBeInTheDocument();
  });

  it('avisa de los cambios sin copiar en «Copia de seguridad»', async () => {
    vi.mocked(getBackupMeta).mockResolvedValue({ calendarChangedAt: Date.now() - DAY });
    renderWith(fakeClient().client);
    expect(await screen.findByRole('link', { name: /^Copia de seguridad.*Hay cambios sin copiar/ })).toHaveAttribute('href', '/ajustes?abrir=copia');
  });

  it('sin salidas, lo primero es tu archivo de Strava', async () => {
    vi.mocked(countActivities).mockResolvedValue(0);
    renderWith(fakeClient().client);
    expect(await screen.findByText('Empieza por tu archivo de Strava')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Importar salidas' })).toHaveAttribute('href', '/importar');
    expect(screen.getByRole('link', { name: '¿Vienes de otro teléfono? Restaurar una copia' })).toHaveAttribute('href', '/ajustes?abrir=restaurar');
    expect(rows().map((a) => a.querySelector('.row-title')?.textContent)).toEqual(['Ajustes', 'Privacidad']);
  });
});

describe('Tu perfil', () => {
  it('presenta la identidad y los accesos sociales, y explica el límite de sincronización', async () => {
    const { client } = fakeClient();
    renderWith(client);
    const identity = await screen.findByRole('region', { name: 'Tu identidad pública' });
    expect(within(identity).getByText('Ana Ruta')).toBeInTheDocument();
    expect(within(identity).getByText('@ana_ruta')).toBeInTheDocument();
    expect(within(identity).getByText('La bici y los puertos.')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Editar perfil' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ciclistas' })).toHaveAttribute('href', '/ciclistas');
    expect(screen.getByRole('link', { name: /Mis retos/ })).toHaveAttribute('href', '/retos');
    expect(screen.getByRole('link', { name: /Tu zona/ })).toHaveAttribute('href', '/zona');
    expect(screen.getByText(/comparativas entre perfiles siguen pendientes/)).toBeInTheDocument();
  });

  it('fila de cifras tocables: amigos con solicitudes, retos ganados y salidas del año', async () => {
    const { client } = fakeClient();
    const card = (id: string) => ({ id, username: id, display_name: id, locality: null, distance_km: null });
    const m = (id: string) => ({ id, username: id, display_name: id, status: 'accepted', accepted_at: null, score: 1, updated_at: null });
    const duel = (id: string, winner: string) => ({ id, title: id, kind: 'distance', created_at: '2026-11-01T00:00:00Z', deadline: '2026-11-08T00:00:00Z', creator_id: 'u1', target_value: null, distance_m: null, segment_key: null, status: 'finished', members: [m('u1'), m('p2')], winner_ids: [winner] });
    vi.mocked(client.rpc).mockImplementation((async (fn: string) => {
      if (fn === 'list_friends') return { data: [
        { friendship_id: 'a', status: 'accepted', direction: 'sent', profile: card('p2') },
        { friendship_id: 'b', status: 'accepted', direction: 'received', profile: card('p3') },
        { friendship_id: 'c', status: 'pending', direction: 'received', profile: card('p4') },
      ], error: null };
      if (fn === 'list_community_challenges') return { data: [duel('x', 'u1'), duel('y', 'p2')], error: null };
      return { data: [], error: null };
    }) as unknown as SupabaseClient['rpc']);
    renderWith(client);
    const stats = await screen.findByRole('list', { name: 'Tus cifras' });
    expect(await within(stats).findByRole('link', { name: '2 amigos, 1 solicitud pendiente' })).toHaveAttribute('href', '/perfil/amigos');
    expect(await within(stats).findByRole('link', { name: '1 reto ganado' })).toHaveAttribute('href', '/retos?vista=historial');
    expect(await within(stats).findByRole('link', { name: /^0 salidas en \d{4}$/ })).toHaveAttribute('href', '/historial');
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
    expect(await screen.findByRole('region', { name: 'Tu identidad pública' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Editar perfil' })).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('guarda solo los campos del perfil y actualiza el saludo sin enviar claves locales', async () => {
    const { client, update } = fakeClient();
    renderWith(client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Editar perfil' }));
    const name = screen.getByLabelText('Nombre visible');
    await user.clear(name);
    await user.type(name, '  Ana del Puerto  ');
    await user.clear(screen.getByLabelText(/^Sobre ti/));
    await user.type(screen.getByLabelText(/^Sobre ti/), '  La mejor vista llega después de la subida.  ');
    await user.click(screen.getByRole('radio', { name: 'Subir' }));
    await user.selectOptions(screen.getByLabelText(/^Quién puede ver tus estadísticas/), 'friends');
    await user.click(screen.getByRole('button', { name: 'Guardar perfil' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Perfil guardado.');
    expect(update).toHaveBeenCalledWith({ username: 'ana_ruta', display_name: 'Ana del Puerto', stats_visibility: 'friends', bio: 'La mejor vista llega después de la subida.', riding_style: 'subir' });
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Ana del Puerto', orsKey: 'local-key' }));
  });

  it('cierra solo la sesión del dispositivo', async () => {
    const { client, signOut } = fakeClient();
    renderWith(client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Editar perfil' }));
    await user.click(screen.getByText('Tu cuenta y este dispositivo'));
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión en este dispositivo' }));
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('mientras carga el perfil, muestra un esqueleto ocupado', () => {
    const { client, read } = fakeClient();
    read.mockReturnValue(new Promise(() => {}));
    renderWith(client);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText(/Cargando tu perfil/)).toBeInTheDocument();
  });

  it('reserva las tres cifras desde el primer momento, sin saltos al llegar los datos', async () => {
    const { client } = fakeClient();
    vi.mocked(client.rpc).mockReturnValue(new Promise(() => {}) as unknown as ReturnType<SupabaseClient['rpc']>);
    renderWith(client);
    const stats = await screen.findByRole('list', { name: 'Tus cifras' });
    expect(within(stats).getAllByRole('listitem')).toHaveLength(3);
    expect(within(stats).getByText('Amigos')).toBeInTheDocument();
    expect(within(stats).getByText('Retos ganados')).toBeInTheDocument();
  });

  it('comparte el enlace al perfil con la hoja del sistema', async () => {
    const { client } = fakeClient();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    renderWith(client);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Compartir perfil' }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: `${window.location.origin}${window.location.pathname}#/personas/u1` }));
    delete (navigator as unknown as Record<string, unknown>).share;
  });

  it('sin hoja del sistema, copia el enlace y lo dice', async () => {
    const { client } = fakeClient();
    delete (navigator as unknown as Record<string, unknown>).share;
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderWith(client);
    await user.click(await screen.findByRole('button', { name: 'Compartir perfil' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/#\/personas\/u1$/));
    expect(await screen.findByRole('status')).toHaveTextContent('Enlace copiado');
  });
});
