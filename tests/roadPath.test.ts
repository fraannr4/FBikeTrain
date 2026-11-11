import { fetchRoadPath } from '../src/routes/roadPath';
import { db } from '../src/db/db';

const start = { lat: 41, lng: 2.5 };
const end = { lat: 41.001, lng: 2.501 };
function response(coords: unknown) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ features: [{ geometry: { type: 'LineString', coordinates: coords }, properties: { extras: {
    surface: { summary: [{ value: 3, distance: 200, amount: 100 }], values: [] }, waytypes: { summary: [{ value: 3, distance: 200, amount: 100 }], values: [] }, steepness: { summary: [], values: [] },
  } } }] }), { status: 200 }));
}
describe('conexiones por carretera', () => {
  beforeEach(async () => { await db.meta.clear(); });
  it('pide el recorrido de los puntos, no una circular ni un segmento recto inventado', async () => {
    const f = response([[2.5, 41, 100], [2.5005, 41.0005, 110], [2.501, 41.001, 120]]);
    const path = await fetchRoadPath('test-key', [start, end], undefined, f);
    expect(path).toHaveLength(3);
    const body = JSON.parse(f.mock.calls[0][1]?.body as string);
    expect(body.coordinates).toEqual([[2.5, 41], [2.501, 41.001]]);
    expect(body.options.round_trip).toBeUndefined();
    expect(f.mock.calls[0][0]).toBe('https://api.heigit.org/openrouteservice/v2/directions/cycling-road/geojson');
  });
  it('no consume cuota con puntos inválidos', async () => {
    const f = response([]);
    await expect(fetchRoadPath('key', [start, { lat: NaN, lng: 2 }], undefined, f)).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
  it('rechaza geometría vacía o que no conecta con los puntos pedidos', async () => {
    await expect(fetchRoadPath('key', [start, end], undefined, response([]))).rejects.toThrow();
    await expect(fetchRoadPath('key', [start, end], undefined, response([[3, 42, 0], [3.01, 42, 0]]))).rejects.toThrow();
  });
  it('rechaza una conexión que pasa por autopista', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ features: [{ geometry: { type: 'LineString', coordinates: [[2.5, 41, 0], [2.501, 41.001, 0]] }, properties: { extras: {
      surface: { summary: [{ value: 3, distance: 200, amount: 100 }], values: [] }, waytypes: { summary: [{ value: 3, distance: 200, amount: 100 }], values: [] }, steepness: { summary: [], values: [] },
      waycategory: { summary: [{ value: 1, distance: 200, amount: 100 }], values: [[0, 1, 1]] },
    } } }] }), { status: 200 }));
    await expect(fetchRoadPath('key', [start, end], undefined, f)).rejects.toThrow(/autopista/);
  });
  it('no rellena con cero la altura ausente', async () => {
    const path = await fetchRoadPath('key', [start, end], undefined, response([[2.5, 41], [2.501, 41.001]]));
    expect(path[0]).toEqual(start);
  });
});
