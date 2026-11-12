import { buildWaypointQuery, osmWaypointsSchema, parseWaypoints } from '../src/routes/sources/waypoints';
import { findWaypoints, type RouteSourceInvoker } from '../src/routes/sources/client';

// Sintético, en el mar: ni tracks ni carreteras reales.
const search = { lat: 0, lon: 0, radiusM: 30_000 };
const node = (id: number, lat: number, tags: Record<string, string>) => ({ type: 'node', id, lat, lon: 0, tags });
const way = (id: number, nodes: number[], geometry: [number, number][], tags: Record<string, string> = { highway: 'secondary', surface: 'asphalt' }) =>
  ({ type: 'way', id, nodes, tags, geometry: geometry.map(([lat, lon]) => ({ lat, lon })) });
// 0,2 grados de latitud son unos 22 km al norte.
const pass = (tags = {}) => node(1, 0.2, { mountain_pass: 'yes', name: 'Collado inventado', ele: '1150', wikidata: 'Q1', ...tags });
const passRoad = (tags?: Record<string, string>) => way(10, [11, 1, 12], [[0.19, 0], [0.2, 0.0007], [0.21, 0]], tags);
const names = (list: { name: string }[]) => list.map(w => w.name);

describe('puntos de paso de Overpass', () => {
  it('puntúa el interés: puerto con ficha y cota alta 3, pueblo sin ficha 0', () => {
    const town = node(2, 0.1, { place: 'village', name: 'Pueblo inventado' });
    const townRoad = way(20, [21, 22], [[0.1, 0.001], [0.11, 0.001]], { highway: 'tertiary' });
    const found = parseWaypoints({ elements: [pass(), passRoad(), town, townRoad] }, search);
    expect(found.find(w => w.kind === 'puerto')).toMatchObject({ id: 'osm-pass-1', interes: 3, ele: 1150 });
    expect(found.find(w => w.kind === 'pueblo')).toMatchObject({ id: 'osm-place-2', interes: 0, ele: null });
  });
  it('descarta el puerto cuya única vía no está asfaltada', () => {
    expect(parseWaypoints({ elements: [pass(), passRoad({ highway: 'secondary', surface: 'gravel' })] }, search)).toEqual([]);
    expect(names(parseWaypoints({ elements: [pass(), passRoad()] }, search))).toEqual(['Collado inventado']);
  });
  it('marca deadEnd si la carretera acaba junto a la cima y no si pasa de largo', () => {
    const peak = node(3, 0.2, { natural: 'peak', name: 'Cima inventada', ele: '1400' });
    const ends = way(30, [31, 32], [[0.15, 0], [0.2009, 0]]); // acaba a 100 m
    const passes = way(33, [34, 35], [[0.19, 0.0004], [0.21, 0.0004]]); // pasa a 45 m y sigue
    const a = parseWaypoints({ elements: [peak, ends] }, search)[0];
    const b = parseWaypoints({ elements: [peak, passes] }, search)[0];
    expect(a).toMatchObject({ id: 'osm-peak-3', kind: 'cima', deadEnd: true, interes: 2 });
    expect(b.deadEnd).toBeUndefined();
  });
  it('un pueblo entra junto a una tertiary pero no junto a una residential', () => {
    const town = node(2, 0.1, { place: 'town', name: 'Villa inventada' });
    const road = (highway: string) => way(20, [21, 22], [[0.1, 0.001], [0.11, 0.001]], { highway });
    expect(parseWaypoints({ elements: [town, road('tertiary')] }, search)).toHaveLength(1);
    expect(parseWaypoints({ elements: [town, road('residential')] }, search)).toEqual([]);
  });
  it('descarta lo que queda a menos de 3 km del inicio', () => {
    const near = node(4, 0.018, { place: 'village', name: 'Cerca' });
    const road = way(40, [41, 42], [[0.018, 0.001], [0.03, 0.001]], { highway: 'tertiary' });
    expect(parseWaypoints({ elements: [near, road] }, search)).toEqual([]);
  });
  it('limita a 20 por tipo y a 60 en total, primero los de más interés', () => {
    const elements: object[] = [];
    for (let i = 0; i < 30; i++) {
      elements.push(node(100 + i, 0.1 + i * 0.001, { place: 'village', name: `Pueblo ${i}`, ...(i === 29 ? { wikidata: 'Q9' } : {}) }));
      elements.push(way(200 + i, [300 + i, 400 + i], [[0.1 + i * 0.001, 0.001], [0.101 + i * 0.001, 0.001]], { highway: 'tertiary' }));
    }
    const found = parseWaypoints({ elements }, search);
    expect(found).toHaveLength(20);
    expect(found[0].name).toBe('Pueblo 29');
    expect(osmWaypointsSchema.safeParse(Array.from({ length: 61 }, () => found[0])).success).toBe(false);
  });
  it('rechaza una respuesta con remark', () => {
    expect(() => parseWaypoints({ elements: [], remark: 'timeout' }, search)).toThrow();
  });
  it('la consulta usa bbox y rechaza radios de 40 km', () => {
    const query = buildWaypointQuery(search);
    expect(query).toMatch(/\[bbox:[-\d.,]+\]/);
    expect(query).not.toMatch(/node\(around:/);
    expect(() => buildWaypointQuery({ ...search, radiusM: 40_000 })).toThrow();
  });
  it('el cliente envía kind waypoints con punto cuantizado y radio de 5 km', async () => {
    const invoke = vi.fn<RouteSourceInvoker['invoke']>().mockResolvedValue({ data: { data: [] }, error: null });
    await findWaypoints({ lat: 41.60049, lng: 2.16051 }, 21_000, { invoke });
    expect(invoke).toHaveBeenCalledWith('route-sources', { body: { lat: 41.6, lon: 2.161, radiusM: 25_000, source: 'osm', kind: 'waypoints' }, signal: undefined });
    invoke.mockResolvedValue({ data: null, error: {} });
    await expect(findWaypoints({ lat: 0, lng: 0 }, 20_000, { invoke })).rejects.toThrow();
  });
});
