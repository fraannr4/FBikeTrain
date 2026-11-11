import { historyPasses } from '../src/routes/historyPasses';
import type { ClimbEffort, TrackPoint } from '../src/domain/types';

const start = { lat: 0, lng: 0 };
const climb: ClimbEffort = { id: 'c1', activityId: 'a1', activityStart: 1, startIdx: 0, endIdx: 2, start: { lat: 0.17, lng: 0 }, end: { lat: 0.2, lng: 0 }, startDistM: 0, lengthM: 3000, gainM: 200, avgGradePct: 7, timeS: 600, avgSpeedMs: 5, vamMh: 1200 };
const points: TrackPoint[] = [0.17, 0.19, 0.2, 0.21].map((lat, i) => ({ t: i * 1000, lat, lng: 0, ele: 400 + i * 100 }));

it('suma la cima del historial con acceso/salida observados y deduplica pasadas', async () => {
  const track = vi.fn().mockResolvedValue(points);
  const out = await historyPasses(start, [climb, { ...climb, id: 'c2' }], track);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ name: 'Subida habitual 1', ele: 600, approach: { lat: 0.19 }, departure: { lat: 0.21 } });
  expect(track).toHaveBeenCalledTimes(1);
});

it('no inventa salida ni cota; sin continuación descarta la cima', async () => {
  expect(await historyPasses(start, [climb], async () => points.slice(0, 3))).toEqual([]);
  const out = await historyPasses(start, [climb], async () => points.map(({ ele: _ele, ...p }) => p));
  expect(out[0].ele).toBeNull();
});

it('el anillo se filtra antes de leer tracks y cancelar detiene la lectura', async () => {
  const track = vi.fn();
  expect(await historyPasses(start, [{ ...climb, end: start }], track)).toEqual([]);
  expect(track).not.toHaveBeenCalled();
  const controller = new AbortController(); controller.abort();
  await expect(historyPasses(start, [climb], track, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
