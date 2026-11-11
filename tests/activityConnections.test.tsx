import { fireEvent, render, screen } from '@testing-library/react';
import { ActivityConnections } from '../src/ui/components/ActivityConnections';
import { useConnections } from '../src/connections/ConnectionsProvider';

vi.mock('../src/connections/ConnectionsProvider', () => ({ useConnections: vi.fn() }));

const connection = { athleteId: '0', apiKey: 'synthetic-secret-key', autoSync: true };
function setup(connected = false, state = {}, storageError = false) {
  const value = {
    connection: connected ? connection : undefined,
    state, busy: false, ready: !storageError, storageError, revision: 0,
    save: vi.fn().mockResolvedValue(undefined), sync: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(), stop: vi.fn().mockResolvedValue(undefined), refresh: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(useConnections).mockReturnValue(value);
  render(<ActivityConnections defaultOpen />);
  return value;
}

it('guides a new connection with own-account default and direct-device warning', () => {
  setup();
  expect(screen.getByLabelText('Athlete id de Intervals.icu')).toHaveValue('0');
  expect(screen.getByRole('link', { name: 'Abrir ajustes de Intervals.icu' })).toHaveAttribute('href', 'https://intervals.icu/settings');
  expect(screen.getByText(/opciones de desarrollador/i)).toBeVisible();
  expect(screen.getByText(/Conecta tu dispositivo directamente a Intervals.icu, no a través de Strava/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Sincronizar ahora' })).toBeDisabled();
});

it('syncs at one touch without inserting the stored secret into an input', () => {
  const value = setup(true, { lastSuccessAt: Date.parse('2026-11-11T09:00:00Z') });
  expect(screen.getByLabelText('Clave de API de Intervals.icu')).toHaveValue('');
  expect(screen.getByText(/Última sincronización completa:/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Sincronizar ahora' }));
  expect(value.sync).toHaveBeenCalledOnce();
});

it('keeps the existing secret when only automatic sync is changed', async () => {
  const value = setup(true);
  fireEvent.click(screen.getByText('Cambiar conexión y sincronización'));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar conexión' }));
  expect(value.save).toHaveBeenCalledWith({ ...connection, autoSync: false });
  expect(await screen.findByText('Conexión guardada en este navegador.')).toBeVisible();
});

it('blocks manual sync during a provider cooldown and explains when to retry', () => {
  setup(true, { retryAt: Date.now() + 60_000, error: 'Intervals.icu ha limitado las peticiones.' });
  expect(screen.getByRole('button', { name: 'Sincronizar ahora' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Intervals.icu ha limitado las peticiones.');
  expect(screen.getByText(/Podrás reintentar después/)).toBeVisible();
});

it('can reset unreadable credentials even before the connection is ready', async () => {
  const value = setup(false, {}, true);
  expect(screen.getByLabelText('Clave de API de Intervals.icu')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Restablecer conexión local' }));
  expect(value.save).toHaveBeenCalledWith();
  expect(screen.getByText(/Restablecer elimina la conexión local dañada y conserva tus salidas/)).toBeVisible();
});
