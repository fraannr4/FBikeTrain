import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { GarminProvider, useGarminConnections } from '../src/connections/GarminProvider';
import { withConnectionLock } from '../src/connections/connectionLock';
import { db } from '../src/db/db';
import type { GarminClient } from '../src/connections/garminClient';

function Probe() {
  const state = useGarminConnections();
  return <p>{state?.ready ? `ready ${state.available ? 'available' : 'pending'} ${state.connected ? 'connected' : 'disconnected'}` : 'loading'}</p>;
}
const api = (): GarminClient => ({
  status: vi.fn().mockResolvedValue({ available: true, connected: true, backfillAvailable: false }),
  list: vi.fn().mockResolvedValue({ activities: [], backfillAvailable: false }),
  connect: vi.fn(), disconnect: vi.fn(), file: vi.fn(), sendCourse: vi.fn(), complete: vi.fn().mockResolvedValue(undefined),
});
afterEach(() => { vi.unstubAllEnvs(); window.history.replaceState(null, '', '/'); });

it('completes the Garmin link once on return, removes the code from the address, then checks status', async () => {
  vi.stubEnv('VITE_GARMIN_ENABLED', 'true');
  window.history.replaceState(null, '', '/#/ajustes?abrir=conexiones&garmin_code=synthetic-code');
  const client = api();
  render(<StrictMode><GarminProvider api={client}><Probe /></GarminProvider></StrictMode>);
  expect(await screen.findByText('ready available connected')).toBeVisible();
  expect(client.complete).toHaveBeenCalledTimes(1);
  expect(vi.mocked(client.complete).mock.calls[0][0]).toBe('synthetic-code');
  expect(window.location.hash).toBe('#/ajustes?abrir=conexiones');
  expect(vi.mocked(client.complete).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(client.status).mock.invocationCallOrder[0]);
});

it('shows why the link was refused', async () => {
  vi.stubEnv('VITE_GARMIN_ENABLED', 'true');
  window.history.replaceState(null, '', '/#/ajustes?abrir=conexiones&garmin_code=synthetic-code');
  const client = api();
  vi.mocked(client.complete).mockRejectedValue(new Error('Esta autorización se inició desde otra cuenta.'));
  function ErrorProbe() { return <p>{useGarminConnections()?.error ?? 'sin error'}</p>; }
  render(<GarminProvider api={client}><ErrorProbe /></GarminProvider>);
  expect(await screen.findByText('Esta autorización se inició desde otra cuenta.')).toBeVisible();
});

it('checks Garmin and collects new deliveries once when mounted in StrictMode', async () => {
  vi.stubEnv('VITE_GARMIN_ENABLED', 'true');
  const client = api();
  render(<StrictMode><GarminProvider api={client}><Probe /></GarminProvider></StrictMode>);
  expect(await screen.findByText('ready available connected')).toBeVisible();
  expect(client.status).toHaveBeenCalledTimes(1);
  expect(client.list).toHaveBeenCalledTimes(1);
});

it('retries shortly when another connection holds the shared lock at startup', async () => {
  vi.stubEnv('VITE_GARMIN_ENABLED', 'true');
  const client = api();
  let release!: () => void;
  const held = withConnectionLock(db, () => new Promise<void>(resolve => { release = resolve; }));
  render(<GarminProvider api={client}><Probe /></GarminProvider>);
  expect(await screen.findByText('ready available connected')).toBeVisible();
  expect(client.list).not.toHaveBeenCalled();
  release(); await held;
  await waitFor(() => expect(client.list).toHaveBeenCalledTimes(1), { timeout: 4000 });
});

it('never calls the server while the build flag is off: pending approval', async () => {
  vi.stubEnv('VITE_GARMIN_ENABLED', 'false');
  const client = api();
  render(<GarminProvider api={client}><Probe /></GarminProvider>);
  expect(await screen.findByText('ready pending disconnected')).toBeVisible();
  expect(client.status).not.toHaveBeenCalled();
});

it('does not collect deliveries while the link needs to be renewed', async () => {
  vi.stubEnv('VITE_GARMIN_ENABLED', 'true');
  const client = api();
  vi.mocked(client.status).mockResolvedValue({ available: true, connected: true, backfillAvailable: false, reconnectRequired: true });
  render(<GarminProvider api={client}><Probe /></GarminProvider>);
  expect(await screen.findByText('ready available connected')).toBeVisible();
  expect(client.list).not.toHaveBeenCalled();
});
