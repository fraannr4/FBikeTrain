import { act, render, screen, waitFor } from '@testing-library/react';
import { ActivitySource, GarminAttributionProvider, GarminHistoryAttribution } from '../src/ui/components/ActivitySource';
import { CyclingDb, db, useDatabase } from '../src/db/db';
import type { StoredActivity } from '../src/domain/types';

it('attributes direct Garmin data with its model and falls back to Garmin', () => {
  const garmin = { origin: 'garmin-connect', sourceDevice: 'gArMiN Edge 530' } as StoredActivity;
  const { rerender } = render(<ActivitySource activity={garmin} />);
  expect(screen.getByText('Garmin Edge 530')).toBeVisible();
  rerender(<ActivitySource activity={{ ...garmin, sourceDevice: undefined }} />);
  expect(screen.getByText('Garmin', { exact: true })).toBeVisible();
  rerender(<ActivitySource activity={{ ...garmin, origin: undefined }} />);
  expect(screen.queryByText('Garmin', { exact: true })).not.toBeInTheDocument();
});

it('updates aggregate attribution when Garmin data is imported, deleted or the account database changes', async () => {
  const originalName = db.name;
  const firstName = 'synthetic-garmin-attribution-a';
  const secondName = 'synthetic-garmin-attribution-b';
  useDatabase(firstName);
  let unmount: (() => void) | undefined;
  try {
    await act(async () => { await db.activities.clear(); });
    const view = render(<GarminAttributionProvider><GarminHistoryAttribution /></GarminAttributionProvider>);
    const { rerender } = view; unmount = view.unmount;
    expect(screen.queryByText('Tu historial incluye datos de dispositivos Garmin.')).not.toBeInTheDocument();
    const ride: StoredActivity = { id: 'synthetic-garmin', origin: 'garmin-connect', sourceDevice: 'Garmin Edge 530', startTime: 1, sport: 'cycling', source: 'fit', importedAt: 1, hasTrack: false, totals: { distanceM: 1000, movingTimeS: 100, elapsedTimeS: 100, elevGainM: 0, avgSpeedMs: 10, maxSpeedMs: 10 } };
    await act(async () => { await db.activities.put(ride); });
    expect(await screen.findByText('Tu historial incluye datos de dispositivos Garmin.')).toBeVisible();
    await act(async () => { await db.activities.clear(); });
    await waitFor(() => expect(screen.queryByText('Tu historial incluye datos de dispositivos Garmin.')).not.toBeInTheDocument());
    await act(async () => { await db.activities.put(ride); });
    expect(await screen.findByText('Tu historial incluye datos de dispositivos Garmin.')).toBeVisible();
    useDatabase(secondName);
    await act(async () => { await db.activities.clear(); });
    rerender(<GarminAttributionProvider><GarminHistoryAttribution /></GarminAttributionProvider>);
    await waitFor(() => expect(screen.queryByText('Tu historial incluye datos de dispositivos Garmin.')).not.toBeInTheDocument());
  } finally {
    unmount?.();
    db.close();
    await new CyclingDb(firstName).delete();
    await new CyclingDb(secondName).delete();
    useDatabase(originalName);
  }
});