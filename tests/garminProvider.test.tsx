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
  connect: vi.fn(), disconnect: vi.fn(), file: vi.fn(), sendCourse: vi.fn(),
});
afterEach(() => vi.unstubAllEnvs());

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
