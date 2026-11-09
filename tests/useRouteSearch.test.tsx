import { readFileSync } from 'node:fs';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { db } from '../src/db/db';
import { fetchRoundTrip, OrsError, type OrsFeature } from '../src/routes/ors';
import { DEFAULT_SETTINGS, saveSettings } from '../src/settings/settings';
import { useRouteSearch } from '../src/ui/routes/useRouteSearch';

// Nunca se llama a ORS: la petición se sustituye y devuelve el fixture sintético de la Puerta del Sol.
vi.mock('../src/routes/ors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/routes/ors')>()),
  fetchRoundTrip: vi.fn(),
}));
vi.mock('../src/routes/history', () => ({ loadVisitedCells: vi.fn(async () => new Set<string>()) }));

const fixture = JSON.parse(readFileSync('tests/fixtures/ors/round-trip-ok.json', 'utf8')) as { features: OrsFeature[] };
const SOL = { lat: 40.4168, lng: -3.7038 };
const TARGET = { distanceM: 30_000, elevGainM: 120, preferNew: true };
const fetchOne = fetchRoundTrip as unknown as Mock<typeof fetchRoundTrip>;

describe('useRouteSearch', () => {
  beforeEach(async () => {
    fetchOne.mockReset();
    await Promise.all([db.activities.clear(), db.settings.clear()]);
    await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), ors: { apiKey: 'test-key' } });
  });

  it('runs the search with the key from Ajustes and counts the requests', async () => {
    fetchOne.mockResolvedValue(fixture.features[0]);
    const { result } = renderHook(() => useRouteSearch());
    let out: Awaited<ReturnType<typeof result.current.run>> = null;
    await act(async () => {
      out = await result.current.run(SOL, TARGET, { seeds: 3 });
    });
    expect(fetchOne).toHaveBeenCalledTimes(3);
    expect(fetchOne.mock.calls[0][0]).toBe('test-key');
    expect(out!.routes).toHaveLength(1); // las tres vueltas son iguales: queda una
    expect(result.current.busy).toBe(false);
    expect(result.current.progress).toBeNull();
  });

  it('reports progress while ORS answers', async () => {
    const pending: ((f: OrsFeature) => void)[] = [];
    fetchOne.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const { result } = renderHook(() => useRouteSearch());
    let done!: Promise<unknown>;
    act(() => {
      done = result.current.run(SOL, TARGET, { seeds: 2 });
    });
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(result.current.busy).toBe(true);
    expect(result.current.progress).toEqual({ done: 0, total: 2 });
    await act(async () => pending[0](fixture.features[0]));
    await waitFor(() => expect(result.current.progress).toEqual({ done: 1, total: 2 }));
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => {
      pending[1](fixture.features[0]);
      await done;
    });
  });

  it('cancel stops asking ORS and returns nothing', async () => {
    const pending: ((f: OrsFeature) => void)[] = [];
    fetchOne.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const { result } = renderHook(() => useRouteSearch());
    let out: unknown = 'sin terminar';
    act(() => {
      void result.current.run(SOL, TARGET, { seeds: 5 }).then((r) => (out = r));
    });
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => result.current.cancel());
    expect(result.current.busy).toBe(false);
    await act(async () => pending[0](fixture.features[0]));
    await waitFor(() => expect(out).toBeNull());
    expect(fetchOne).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it('an ORS error becomes the message and its kind', async () => {
    fetchOne.mockRejectedValue(new OrsError('unreachable', 'ORS no responde.'));
    const { result } = renderHook(() => useRouteSearch());
    await act(async () => {
      expect(await result.current.run(SOL, TARGET)).toBeNull();
    });
    expect(result.current.error).toBe('ORS no responde.');
    expect(result.current.errorKind).toBe('unreachable');
  });

  it('with an account and the shared mode on, goes through the server without a personal key', async () => {
    await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), ors: { apiKey: '' } });
    vi.stubEnv('VITE_SHARED_ORS_ENABLED', 'true');
    try {
      fetchOne.mockResolvedValue(fixture.features[0]);
      const account = { client: {} as SupabaseClient, user: { id: 'u1' } as User };
      const wrapper = ({ children }: { children: ReactNode }) => <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
      const { result } = renderHook(() => useRouteSearch(), { wrapper });
      await act(async () => {
        await result.current.run(SOL, TARGET, { seeds: 1 });
      });
      expect(fetchOne.mock.calls[0][0]).toMatchObject({ kind: 'shared' });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
