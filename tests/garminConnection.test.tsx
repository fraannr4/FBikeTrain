import { fireEvent, render, screen } from '@testing-library/react';
import { GarminConnection } from '../src/ui/components/GarminConnection';
import { useGarminConnections } from '../src/connections/GarminProvider';

vi.mock('../src/connections/GarminProvider', () => ({ useGarminConnections: vi.fn() }));

function setup(input: Record<string, unknown> = {}) {
  const connection = { ready: true, busy: false, available: false, connected: false, backfillAvailable: false, revision: 0, stop: vi.fn().mockResolvedValue(undefined), refresh: vi.fn().mockResolvedValue(undefined), connect: vi.fn().mockResolvedValue(undefined), sync: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn().mockResolvedValue(undefined), sendCourse: vi.fn(), ...input };
  vi.mocked(useGarminConnections).mockReturnValue(connection);
  render(<GarminConnection />);
  return connection;
}

it('shows one disabled button pending Garmin approval and offers the manual FIT path', () => {
  setup();
  expect(screen.getByRole('heading', { name: 'Garmin Connect' })).toBeVisible();
  const button = screen.getByRole('button', { name: 'Conectar con Garmin' });
  expect(button).toBeDisabled();
  expect(screen.getByText('Pendiente de la aprobación de Garmin')).toBeVisible();
  expect(screen.getByText(/Exporta el FIT desde Garmin Connect y súbelo en Importar/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Ir a Importar' })).toHaveAttribute('href', '#/importar');
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('starts official consent with one click when the server allows it', () => {
  const connection = setup({ available: true });
  expect(screen.queryByText('Pendiente de la aprobación de Garmin')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Conectar con Garmin' }));
  expect(connection.connect).toHaveBeenCalledOnce();
});

it('once connected, rides arrive by themselves and the only action is to disconnect', () => {
  const connection = setup({ available: true, connected: true, lastSyncAt: Date.parse('2026-11-11T10:00:00Z') });
  expect(screen.getByText('Cuenta Garmin conectada.')).toBeVisible();
  expect(screen.getByText(/Las salidas nuevas llegan solas/)).toBeVisible();
  expect(screen.getByText(/Última sincronización:/)).toBeVisible();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Desconectar Garmin' }));
  expect(connection.disconnect).toHaveBeenCalledOnce();
});

it('explains a provider error and blocks actions while busy', () => {
  setup({ available: true, connected: true, busy: true, error: 'No se pudo conectar con Garmin.' });
  expect(screen.getByRole('alert')).toHaveTextContent('No se pudo conectar con Garmin.');
  expect(screen.getByRole('button', { name: 'Desconectar Garmin' })).toBeDisabled();
});

it('warns when the account is linked but push reception is not active yet', () => {
  setup({ available: true, connected: true, receptionAvailable: false });
  expect(screen.getByText(/La recepción de salidas de Garmin todavía no está activa/)).toBeVisible();
  expect(screen.queryByText(/llegan solas/)).not.toBeInTheDocument();
});
