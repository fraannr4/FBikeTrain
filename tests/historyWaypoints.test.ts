import { describe, expect, it, vi } from 'vitest';
import { haversineM } from '../src/import/summary';
import { HABITUAL_SPACING_M, historyWaypoints, MIN_REPEATS } from '../src/routes/historyWaypoints';
import type { LatLng, TrackPoint } from '../src/domain/types';

const M_PER_DEG_LAT = 111_320;
const start: LatLng = { lat: 41.0, lng: 2.5 };
const band = { minM: 5_000, maxM: 30_000 };
/** Un punto a `northM` metros al norte del inicio. */
const northOf = (northM: number): LatLng => ({ lat: start.lat + northM / M_PER_DEG_LAT, lng: start.lng });
const pass = (...places: LatLng[]): TrackPoint[] => places.map((p, i) => ({ t: i, lat: p.lat, lng: p.lng, ele: 300 }));
const tracksOf = (tracks: TrackPoint[][]) => async function* () { for (const t of tracks) yield t; };
const repeated = (n: number, ...places: LatLng[]) => Array.from({ length: n }, () => pass(...places));

describe('historyWaypoints', () => {
  it('includes a past climb inside the band even when it tops out closer than 15 km', async () => {
    const top = northOf(10_000);
    const points: TrackPoint[] = [9_000, 9_500, 10_000, 10_500].map((m, i) => ({ t: i * 1000, ...northOf(m), ele: 400 + i * 100 }));
    const climb = { id: 'c1', activityId: 'a1', activityStart: 1, startIdx: 0, endIdx: 2, start: northOf(9_000), end: top, startDistM: 0, lengthM: 1000, gainM: 200, avgGradePct: 7, timeS: 600, avgSpeedMs: 5, vamMh: 1200 };
    const out = await historyWaypoints(start, band, { climbs: [climb], track: async () => points, listTracks: tracksOf([]) });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'hist-climb-1', kind: 'habitual', name: 'Subida habitual 1', ele: 600 });
    expect(await historyWaypoints(start, { minM: 12_000, maxM: 30_000 }, { climbs: [climb], track: async () => points, listTracks: tracksOf([]) })).toEqual([]);
  });

  it('returns a habitual stretch repeated at least MIN_REPEATS times inside the band', async () => {
    const spot = northOf(10_000);
    const out = await historyWaypoints(start, band, { climbs: [], listTracks: tracksOf(repeated(MIN_REPEATS, spot)) });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'hist-cell-1', kind: 'habitual', name: 'Tramo habitual 1', lat: spot.lat, lng: spot.lng });
    expect(haversineM(start.lat, start.lng, out[0].lat, out[0].lng)).toBeCloseTo(out[0].distanceM, 0);
  });

  it('drops a stretch repeated fewer than MIN_REPEATS times and one outside the band', async () => {
    const few = northOf(10_000);
    const far = northOf(band.maxM + 5_000);
    const near = northOf(band.minM - 2_000);
    const tracks = [...repeated(MIN_REPEATS - 1, few), ...repeated(MIN_REPEATS, far), ...repeated(MIN_REPEATS, near)];
    expect(await historyWaypoints(start, band, { climbs: [], listTracks: tracksOf(tracks) })).toEqual([]);
  });

  it('keeps only the most repeated of two stretches closer than HABITUAL_SPACING_M', async () => {
    const a = northOf(10_000);
    const b = northOf(10_000 + HABITUAL_SPACING_M * 0.4);
    const tracks = [...repeated(MIN_REPEATS, a), ...repeated(MIN_REPEATS + 1, b)];
    const out = await historyWaypoints(start, band, { climbs: [], listTracks: tracksOf(tracks) });
    expect(out).toHaveLength(1);
    expect(out[0].lat).toBeCloseTo(b.lat, 6);
  });

  it('keeps two stretches separated by at least HABITUAL_SPACING_M', async () => {
    const a = northOf(10_000);
    const b = northOf(10_000 + HABITUAL_SPACING_M * 1.5);
    const tracks = [...repeated(MIN_REPEATS + 1, a), ...repeated(MIN_REPEATS, b)];
    const out = await historyWaypoints(start, band, { climbs: [], listTracks: tracksOf(tracks) });
    expect(out.map((w) => w.name)).toEqual(['Tramo habitual 1', 'Tramo habitual 2']);
  });

  it('aborts with AbortError without reading any track when the signal is already aborted', async () => {
    const listTracks = vi.fn(tracksOf(repeated(MIN_REPEATS, northOf(10_000))));
    const controller = new AbortController();
    controller.abort();
    await expect(historyWaypoints(start, band, { climbs: [], listTracks, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(listTracks).not.toHaveBeenCalled();
  });

  it('stops reading tracks once the signal aborts midway', async () => {
    const controller = new AbortController();
    let read = 0;
    const listTracks = async function* () {
      for (const t of repeated(5, northOf(10_000))) { read++; controller.abort(); yield t; }
    };
    await expect(historyWaypoints(start, band, { climbs: [], listTracks, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).toBe(1);
  });

  it('adds habitual climbs from the history inside the band as separate waypoints', async () => {
    const top = northOf(20_000);
    const climb = { id: 'c1', activityId: 'a1', activityStart: 1, startIdx: 0, endIdx: 1, start: northOf(17_000), end: top, startDistM: 0, lengthM: 3000, gainM: 200, avgGradePct: 7, timeS: 600, avgSpeedMs: 5, vamMh: 1200 };
    const points = pass(northOf(17_000), top, northOf(20_500));
    const out = await historyWaypoints(start, band, { climbs: [{ ...climb, endIdx: 1 }], listTracks: tracksOf([]), track: async () => points });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'hist-climb-1', name: 'Subida habitual 1', kind: 'habitual', ele: 300 });
    expect(out[0].approach).toBeDefined();
    expect(out[0].departure).toBeDefined();
  });

  it('drops a habitual stretch closer than HABITUAL_SPACING_M to a climb', async () => {
    const top = northOf(20_000);
    const climb = { id: 'c1', activityId: 'a1', activityStart: 1, startIdx: 0, endIdx: 1, start: northOf(17_000), end: top, startDistM: 0, lengthM: 3000, gainM: 200, avgGradePct: 7, timeS: 600, avgSpeedMs: 5, vamMh: 1200 };
    const points = pass(northOf(17_000), top, northOf(20_500));
    const tracks = repeated(MIN_REPEATS, northOf(20_000 + HABITUAL_SPACING_M * 0.5));
    const out = await historyWaypoints(start, band, { climbs: [climb], listTracks: tracksOf(tracks), track: async () => points });
    expect(out.map((w) => w.id)).toEqual(['hist-climb-1']);
  });
});
