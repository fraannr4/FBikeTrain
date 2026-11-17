import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { ToastProvider } from '../src/ui/components/Toast';
import { Ajustes } from '../src/ui/pages/Ajustes';
import { clearAllData } from '../src/db/repo';
import * as push from '../src/pwa/push';

vi.mock('../src/pwa/push', async importOriginal => ({
  ...await importOriginal<typeof import('../src/pwa/push')>(),
  getPushState: vi.fn(), enablePush: vi.fn(), disablePush: vi.fn(),
}));
const getPushState = vi.mocked(push.getPushState);
const enablePush = vi.mocked(push.enablePush);
const disablePush = vi.mocked(push.disablePush);

const client = { rpc: vi.fn().mockResolvedValue({ data: [], error: null }), from: vi.fn() } as unknown as SupabaseClient;
function renderAjustes(user: Partial<User> = { id: 'u1' }, withAccount = true) {
  const page = (
    <MemoryRouter initialEntries={['/ajustes?abrir=avisos']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider><Ajustes /></ToastProvider>
    </MemoryRouter>
  );
  return render(withAccount ? <AccountContext.Provider value={{ client, user: user as User }}>{page}</AccountContext.Provider> : page);
}
const section = () => waitFor(() => {
  const found = document.querySelector<HTMLElement>('details#avisos');
  if (!found) throw new Error('sin sección Avisos');
  return found;
});

describe('Ajustes: sección Avisos', () => {
  beforeEach(async () => {
    await clearAllData();
    getPushState.mockReset().mockResolvedValue('off');
    enablePush.mockReset().mockResolvedValue(undefined);
    disablePush.mockReset().mockResolvedValue(undefined);
  });

  it('no aparece sin cuenta ni con una cuenta anónima', async () => {
    renderAjustes({ id: 'u1' }, false);
    await screen.findByLabelText('Nombre');
    expect(document.querySelector('details#avisos')).toBeNull();
    expect(getPushState).not.toHaveBeenCalled();
  });
  it('con cuenta anónima tampoco', async () => {
    renderAjustes({ id: 'u1', is_anonymous: true });
    await screen.findByLabelText('Nombre');
    expect(document.querySelector('details#avisos')).toBeNull();
  });

  it('al cargar no pide el permiso: solo consulta el estado y muestra el interruptor apagado', async () => {
    renderAjustes();
    const avisos = await section();
    const toggle = await within(avisos).findByRole('checkbox', { name: 'Recibir avisos en este dispositivo' });
    expect(toggle).not.toBeChecked();
    expect(avisos).toHaveTextContent('Te avisamos de retos y de solicitudes de amistad');
    expect(enablePush).not.toHaveBeenCalled();
  });
  it('al activar el interruptor pide el permiso y activa los avisos', async () => {
    renderAjustes();
    const toggle = await within(await section()).findByRole('checkbox', { name: 'Recibir avisos en este dispositivo' });
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(enablePush).toHaveBeenCalledWith(client));
    await waitFor(() => expect(toggle).toBeChecked());
  });
  it('al apagarlo cancela la suscripción', async () => {
    getPushState.mockResolvedValue('on');
    renderAjustes();
    const toggle = await within(await section()).findByRole('checkbox', { name: 'Recibir avisos en este dispositivo' });
    expect(toggle).toBeChecked();
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(disablePush).toHaveBeenCalledWith(client));
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(enablePush).not.toHaveBeenCalled();
  });
  it('si el usuario deniega el permiso, el interruptor vuelve a apagarse y explica cómo reactivarlo', async () => {
    enablePush.mockRejectedValue(new push.PushError('denied'));
    renderAjustes();
    const avisos = await section();
    await userEvent.setup().click(await within(avisos).findByRole('checkbox', { name: 'Recibir avisos en este dispositivo' }));
    expect(await within(avisos).findByText(/Has bloqueado los avisos/)).toBeInTheDocument();
    expect(within(avisos).queryByRole('checkbox')).toBeNull();
  });
  it.each([
    ['save', 'No se han podido activar los avisos. Inténtalo de nuevo.'],
    ['limit', 'Ya tienes avisos en 10 dispositivos. Desactívalos en otro antes de añadir este.'],
  ] as const)('error %s: lo cuenta con un mensaje y deja el interruptor apagado', async (code, message) => {
    enablePush.mockRejectedValue(new push.PushError(code));
    renderAjustes();
    const avisos = await section();
    const toggle = await within(avisos).findByRole('checkbox', { name: 'Recibir avisos en este dispositivo' });
    await userEvent.setup().click(toggle);
    expect(await within(avisos).findByRole('alert')).toHaveTextContent(message);
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();
  });

  it('navegador sin soporte: lo dice y no ofrece interruptor', async () => {
    getPushState.mockResolvedValue('unsupported');
    renderAjustes();
    const avisos = await section();
    expect(await within(avisos).findByText(/no admite avisos/)).toBeInTheDocument();
    expect(within(avisos).queryByRole('checkbox')).toBeNull();
  });
  it('iPhone sin instalar: pide añadir la app a la pantalla de inicio', async () => {
    getPushState.mockResolvedValue('needs-install');
    renderAjustes();
    const avisos = await section();
    expect(await within(avisos).findByText('Añade la app a la pantalla de inicio para recibir avisos')).toBeInTheDocument();
    expect(within(avisos).queryByRole('checkbox')).toBeNull();
  });
  it('permiso denegado: explica cómo reactivarlo', async () => {
    getPushState.mockResolvedValue('denied');
    renderAjustes();
    expect(await within(await section()).findByText(/permite las notificaciones de este sitio en los ajustes del navegador/)).toBeInTheDocument();
  });
  it('si no se puede leer el estado, lo dice sin romper Ajustes', async () => {
    getPushState.mockRejectedValue(new Error('boom'));
    renderAjustes();
    expect(await within(await section()).findByText(/No se ha podido comprobar el estado de los avisos/)).toBeInTheDocument();
  });
});
