import { applyRoadEdit } from '../src/routes/libraryEdit';
import { parseReferenceRoute, type ReferenceRoute } from '../src/routes/library';
const xml = '<gpx><trk><trkseg><trkpt lat="41" lon="2.5"/><trkpt lat="41.001" lon="2.5"/><trkpt lat="41.002" lon="2.5"/></trkseg></trk></gpx>';
function route(): ReferenceRoute { return { ...parseReferenceRoute(xml, 'test.gpx'), id: 'test', createdAt: 1, updatedAt: 1 }; }
describe('cambios de ruta con un punto de paso', () => {
  it('prolonga con la geometría real calculada y conserva el original', async () => {
    const source = route();
    const point = { lat: 41.003, lng: 2.5 };
    const fetchPath = vi.fn().mockResolvedValue([source.points[2], point]);
    const next = await applyRoadEdit(source, { kind: 'extend', point }, 'key', undefined, fetchPath);
    expect(next.points).toHaveLength(4);
    expect(next.originalXml).toBe(xml);
    expect(source.points).toHaveLength(3);
  });
  it('sustituye solo el tramo seleccionado y permite elegir otro inicio', async () => {
    const source = route();
    const point = { lat: 41.001, lng: 2.501 };
    const road = vi.fn().mockResolvedValue([source.points[0], point, source.points[2]]);
    const next = await applyRoadEdit(source, { kind: 'detour', point, from: 0, to: 2 }, 'key', undefined, road);
    expect(next.points[1]).toEqual(point);
    const start = { lat: 40.999, lng: 2.5 };
    const before = await applyRoadEdit(source, { kind: 'prepend', point: start }, 'key', undefined, vi.fn().mockResolvedValue([start, source.points[0]]));
    expect(before.points[0]).toEqual(start);
  });
  it('no concatena una conexión que deja un salto', async () => {
    await expect(applyRoadEdit(route(), { kind: 'extend', point: { lat: 41.003, lng: 2.5 } }, 'key', undefined, vi.fn().mockResolvedValue([{ lat: 42, lng: 3 }, { lat: 42.001, lng: 3 }]))).rejects.toThrow();
  });
});
