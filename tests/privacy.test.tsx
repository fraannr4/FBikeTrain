import { act, render, screen } from '@testing-library/react';
import { PublicAccess } from '../src/auth/PublicAccess';

afterEach(() => { window.history.replaceState(null, '', '/'); });

it('opens public privacy before mounting account authentication or private data', () => {
  window.history.replaceState(null, '', '/#/privacidad');
  const privateEntry = vi.fn(() => <p>Cuenta privada</p>);
  const PrivateEntry = privateEntry;
  render(<PublicAccess><PrivateEntry /></PublicAccess>);
  expect(screen.getByRole('heading', { name: 'Privacidad', level: 1 })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Garmin Connect' })).toBeVisible();
  expect(privateEntry).not.toHaveBeenCalled();
  act(() => { window.history.replaceState(null, '', '/#/'); window.dispatchEvent(new HashChangeEvent('hashchange')); });
  expect(screen.getByText('Cuenta privada')).toBeVisible();
});

it('states which Garmin data is stored, how to delete it and whom to contact', () => {
  window.history.replaceState(null, '', '/#/privacidad');
  render(<PublicAccess><p>Cuenta privada</p></PublicAccess>);
  const garmin = screen.getByRole('heading', { name: 'Garmin Connect' }).closest('section')!;
  expect(garmin).toHaveTextContent(/identificador de usuario de Garmin/);
  expect(garmin).toHaveTextContent(/cifrad/);
  expect(garmin).toHaveTextContent(/30 días/);
  expect(garmin).toHaveTextContent(/Desconectar/);
  expect(garmin).toHaveTextContent(/recorrido/);
  expect(screen.getByRole('link', { name: 'fbiketrain@gmail.com' })).toHaveAttribute('href', 'mailto:fbiketrain@gmail.com');
});
