import { fireEvent, render, screen } from '@testing-library/react';
import { SendToGarmin } from '../src/ui/components/SendToGarmin';
import { useGarminConnections } from '../src/connections/GarminProvider';
import type { ReferenceRoute } from '../src/routes/library';

vi.mock('../src/connections/GarminProvider', () => ({ useGarminConnections: vi.fn() }));
const route = { id: 'r1', name: 'Vuelta sintética', format: 'gpx', sourceFileName: 'x.gpx', originalXml: '', originalPoints: [],
  points: [{ lat: 41, lng: 2.5 }, { lat: 41.01, lng: 2.5 }],
  summary: { distanceM: 1112, elevGainM: 0, elevLossM: 0, closed: false, pointCount: 2 }, createdAt: 0, updatedAt: 0 } satisfies ReferenceRoute;
function setup(input: Record<string, unknown>) {
  const garmin = { ready: true, busy: false, available: true, connected: true, courseAvailable: true, sendCourse: vi.fn().mockResolvedValue(undefined), ...input };
  vi.mocked(useGarminConnections).mockReturnValue(garmin as never);
  render(<SendToGarmin route={route} />);
  return garmin;
}

it.each([
  ['not connected', { connected: false }],
  ['without course permission', { courseAvailable: false }],
  ['pending approval', { available: false }],
])('renders nothing when %s', (_label, input) => {
  setup(input);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('publishes the route on Garmin and tells how to get it on the device', async () => {
  const garmin = setup({});
  fireEvent.click(screen.getByRole('button', { name: 'Enviar a Garmin' }));
  expect(garmin.sendCourse).toHaveBeenCalledWith(route);
  expect(await screen.findByRole('status')).toHaveTextContent(/Enviada a Garmin Connect/);
});

it('shows the error and lets the rider retry', async () => {
  setup({ sendCourse: vi.fn().mockRejectedValue(new Error('Garmin no está disponible ahora.')) });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar a Garmin' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Garmin no está disponible ahora.');
  expect(screen.getByRole('button', { name: 'Enviar a Garmin' })).toBeEnabled();
});
