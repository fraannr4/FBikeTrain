import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { ConnectionsProvider, useConnections } from '../src/connections/ConnectionsProvider';
import { IntervalsError } from '../src/connections/intervalsClient';
import { loadConnection, loadSyncState, saveConnection, syncIntervals } from '../src/connections/intervalsSync';
import { ToastProvider } from '../src/ui/components/Toast';

vi.mock('../src/connections/intervalsSync', async importOriginal => ({
  ...await importOriginal<typeof import('../src/connections/intervalsSync')>(),
  loadConnection: vi.fn(), loadSyncState: vi.fn(), saveConnection: vi.fn(), syncIntervals: vi.fn(),
}));

let controls: NonNullable<ReturnType<typeof useConnections>>;
function Probe() {
  const connection = useConnections()!;
  controls = connection;
  return <><output>{connection.busy ? 'ocupado' : 'listo'}</output><button onClick={() => void connection.sync()}>manual</button></>;
}
beforeEach(() => {
  vi.mocked(loadConnection).mockResolvedValue({ athleteId: '0', apiKey: 'synthetic-key', autoSync: true });
  vi.mocked(loadSyncState).mockResolvedValue({});
  vi.mocked(syncIntervals).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function mount() { return render(<ToastProvider><ConnectionsProvider><Probe /></ConnectionsProvider></ToastProvider>); }
const idle = () => waitFor(() => expect(screen.getByText('listo')).toBeInTheDocument());

it('checks on opening and resuming visibility, ignores hidden events, and removes listeners on unmount', async () => {
  const view = mount();
  await waitFor(() => expect(syncIntervals).toHaveBeenCalledTimes(1));
  await idle();
  expect(vi.mocked(syncIntervals).mock.calls[0][2]).toBe(true);
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  visibility.mockReturnValue('hidden');
  fireEvent(document, new Event('visibilitychange'));
  expect(syncIntervals).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(syncIntervals).toHaveBeenCalledTimes(2));
  await idle();
  fireEvent(window, new Event('pageshow'));
  await waitFor(() => expect(syncIntervals).toHaveBeenCalledTimes(3));
  await idle();
  view.unmount();
  fireEvent(document, new Event('visibilitychange'));
  expect(syncIntervals).toHaveBeenCalledTimes(3);
});

it('deduplicates simultaneous resume events while a request is in flight and aborts it on unmount', async () => {
  let finish!: () => void;
  vi.mocked(syncIntervals).mockImplementationOnce((_db, _importer, _auto, signal) => new Promise(resolve => {
    finish = () => resolve(undefined);
    signal.addEventListener('abort', finish);
  }));
  const view = mount();
  await waitFor(() => expect(syncIntervals).toHaveBeenCalledTimes(1));
  fireEvent(document, new Event('visibilitychange'));
  fireEvent(window, new Event('pageshow'));
  expect(syncIntervals).toHaveBeenCalledTimes(1);
  const signal = vi.mocked(syncIntervals).mock.calls[0][3];
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => finish());
});

it('shows the safe Spanish permission error after a manual request without navigating to Settings', async () => {
  mount();
  await waitFor(() => expect(syncIntervals).toHaveBeenCalledTimes(1));
  await idle();
  vi.mocked(syncIntervals).mockRejectedValueOnce(new IntervalsError('La clave de Intervals.icu no es válida o ha caducado.'));
  fireEvent.click(screen.getByRole('button', { name: 'manual' }));
  expect(await screen.findByText('La clave de Intervals.icu no es válida o ha caducado.')).toBeInTheDocument();
  expect(vi.mocked(syncIntervals).mock.calls[1][2]).toBe(false);
});

it('reserves saving before crypto starts so resume, another save and stop cannot race it', async () => {
  mount();
  await waitFor(() => expect(syncIntervals).toHaveBeenCalledTimes(1));
  await idle();
  let release!: () => void;
  vi.mocked(saveConnection).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  let saving!: Promise<void>;
  act(() => { saving = controls.save({ athleteId: '0', apiKey: 'synthetic-key', autoSync: true }); });
  expect(screen.getByText('ocupado')).toBeInTheDocument();
  fireEvent(document, new Event('visibilitychange'));
  await expect(controls.save()).rejects.toThrow('Espera');
  expect(syncIntervals).toHaveBeenCalledTimes(1);
  let stopped = false;
  const stopping = controls.stop().then(() => { stopped = true; });
  await act(async () => { await Promise.resolve(); });
  expect(stopped).toBe(false);
  await act(async () => { release(); await saving; await stopping; });
  expect(stopped).toBe(true);
  expect(saveConnection).toHaveBeenCalledTimes(1);
});
