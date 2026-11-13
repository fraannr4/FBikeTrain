import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildWaypointQuery, loadWaypoints, osmWaypointsSchema, OVERPASS_ENDPOINTS, parseWaypoints } from '../src/routes/sources/waypoints';
import { RouteSourceError } from '../src/routes/sources/schema';
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
  it('solo cuenta una carretera de paso: ni pistas probables ni calles de urbanización', () => {
    const peak = node(3, 0.2, { natural: 'peak', name: 'Cima inventada', ele: '900', wikidata: 'Q2' });
    const access = (tags: Record<string, string>) => way(30, [31, 32], [[0.19, 0.0004], [0.21, 0.0004]], tags);
    const found = (tags: Record<string, string>) => parseWaypoints({ elements: [peak, access(tags)] }, search).length;
    // Una vía menor sin firme declarado suele ser una pista.
    expect(found({ highway: 'unclassified' })).toBe(0);
    // Una calle o un acceso asfaltados acaban en fondo de saco: la vuelta tendría que volver por donde entró.
    expect(found({ highway: 'service', surface: 'asphalt' })).toBe(0);
    expect(found({ highway: 'residential', surface: 'asphalt' })).toBe(0);
    expect(found({ highway: 'unclassified', surface: 'asphalt' })).toBe(1);
    expect(found({ highway: 'tertiary' })).toBe(1);
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
  it('un pueblo entra sin cruzarlo con vías: basta con que sea village o town', () => {
    const town = node(2, 0.1, { place: 'town', name: 'Villa inventada' });
    expect(names(parseWaypoints({ elements: [town] }, search))).toEqual(['Villa inventada']);
  });
  it('descarta lo que queda a menos de 3 km del inicio o de un quinto del radio', () => {
    const near = node(4, 0.018, { place: 'village', name: 'Cerca' });
    expect(parseWaypoints({ elements: [near] }, { ...search, radiusM: 8_000 })).toEqual([]);
    // 0,05 grados son 5,6 km: sirve para un radio de 10 km, no para uno de 30 km (mínimo 6 km).
    const mid = node(5, 0.05, { place: 'village', name: 'Medio' });
    expect(parseWaypoints({ elements: [mid] }, { ...search, radiusM: 10_000 })).toHaveLength(1);
    expect(parseWaypoints({ elements: [mid] }, search)).toEqual([]);
  });
  it('limita a 40 por tipo y a 120 en total, primero los de más interés', () => {
    const elements: object[] = [];
    for (let i = 0; i < 50; i++) elements.push(node(100 + i, 0.1 + i * 0.001, { place: 'village', name: `Pueblo ${i}`, ...(i === 49 ? { wikidata: 'Q9' } : {}) }));
    const found = parseWaypoints({ elements }, search);
    expect(found).toHaveLength(40);
    expect(found[0].name).toBe('Pueblo 49');
    expect(osmWaypointsSchema.safeParse(Array.from({ length: 121 }, () => found[0])).success).toBe(false);
  });
  it('a igual interés reparte por rumbos y distancias en vez de quedarse con los más cercanos', () => {
    const elements: object[] = [];
    for (let i = 0; i < 60; i++) elements.push(node(100 + i, 0.08 + i * 0.0002, { place: 'village', name: `Norte ${i}` }));
    elements.push(node(900, -0.2, { place: 'village', name: 'Sur lejano' }));
    elements.push({ type: 'node', id: 901, lat: 0, lon: 0.15, tags: { place: 'village', name: 'Este' } });
    const found = names(parseWaypoints({ elements }, search));
    expect(found).toHaveLength(40);
    expect(found).toContain('Sur lejano');
    expect(found).toContain('Este');
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
  it('la consulta cabe en memoria: solo cimas con cota y ficha, sin vías de los pueblos', () => {
    const query = buildWaypointQuery(search);
    expect(query).toContain('node[natural=peak][name][ele][~"^(wikidata|wikipedia)$"~"."]');
    expect(query).not.toContain('around.towns');
    expect(Number(/\[maxsize:(\d+)\]/.exec(query)?.[1])).toBeGreaterThanOrEqual(64 * 1024 * 1024);
  });
  it('lee una respuesta real recortada de Overpass (datos públicos de OSM)', () => {
    const raw = JSON.parse(readFileSync(resolve('tests/fixtures/route-sources/overpass-waypoints.json'), 'utf8'));
    const found = parseWaypoints(raw, { lat: 41.63, lon: 2.16, radiusM: 30_000 });
    const byName = new Map(found.map(w => [w.name, w]));
    expect(byName.get("Coll d'Estenalles")).toMatchObject({ kind: 'puerto', interes: 3 });
    expect(byName.get('Collformic')).toMatchObject({ kind: 'puerto' });
    // Al Turó de l'Home se llega por una vía de servicio: no es carretera de paso y no entra.
    expect(byName.has("Turó de l'Home")).toBe(false);
    expect(byName.get('el Tibidabo')).toMatchObject({ kind: 'cima', deadEnd: true });
    expect(byName.get('Sant Llorenç Savall')).toMatchObject({ kind: 'pueblo', ele: null });
    expect(found.every(w => w.distanceM >= 3_000 && w.distanceM <= 30_000)).toBe(true);
    // El collado sin carretera asfaltada cerca no entra.
    const passNodes = raw.elements.filter((e: { tags?: Record<string, string> }) => e.tags?.mountain_pass === 'yes' || e.tags?.natural === 'saddle');
    expect(found.filter(w => w.kind === 'puerto').length).toBeLessThan(passNodes.length);
  });
  describe('loadWaypoints reintenta', () => {
    const good = JSON.stringify({ elements: [node(2, 0.1, { place: 'town', name: 'Villa inventada' })] });
    const memory = JSON.stringify({ elements: [], remark: 'runtime error: Query ran out of memory in "query" at line 1. It would need at least 32 MB of RAM to continue.' });
    it('un remark de runtime error es un fallo reintentable, no «sin puntos»', async () => {
      const transport = vi.fn().mockResolvedValueOnce(memory).mockResolvedValueOnce(memory).mockResolvedValue(good);
      expect(names(await loadWaypoints(search, transport))).toEqual(['Villa inventada']);
      expect(transport).toHaveBeenCalledTimes(4);
      await expect(loadWaypoints(search, vi.fn().mockResolvedValue(memory))).rejects.toMatchObject({ code: 'invalid_response' });
    });
    it('pregunta a los dos servidores a la vez y se queda con el primero que responde bien', async () => {
      const transport = vi.fn((url: string) => (url === OVERPASS_ENDPOINTS[0] ? new Promise<string>(() => {}) : Promise.resolve(good)));
      expect(await loadWaypoints(search, transport)).toHaveLength(1);
      expect(transport.mock.calls.map(c => c[0])).toEqual([...OVERPASS_ENDPOINTS]);
      const half = vi.fn((url: string) => (url === OVERPASS_ENDPOINTS[0] ? Promise.reject(new RouteSourceError('blocked')) : Promise.resolve(good)));
      expect(await loadWaypoints(search, half)).toHaveLength(1);
      expect(half).toHaveBeenCalledTimes(2);
    });
    it('si fallan los dos (502/504/429) repite la ronda una vez', async () => {
      const down = vi.fn().mockRejectedValue(new RouteSourceError('blocked'));
      await expect(loadWaypoints(search, down)).rejects.toMatchObject({ code: 'blocked' });
      expect(down).toHaveBeenCalledTimes(4);
    });
    it('un corte de red se reintenta; una cancelación no', async () => {
      const transport = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValue(good);
      expect(await loadWaypoints(search, transport)).toHaveLength(1);
      const cancelled = vi.fn().mockRejectedValue(new RouteSourceError('cancelled'));
      await expect(loadWaypoints(search, cancelled)).rejects.toMatchObject({ code: 'cancelled' });
      expect(cancelled).toHaveBeenCalledTimes(2);
      const aborted = vi.fn().mockRejectedValue(new DOMException('Cancelado', 'AbortError'));
      await expect(loadWaypoints(search, aborted)).rejects.toMatchObject({ name: 'AbortError' });
      expect(aborted).toHaveBeenCalledTimes(2);
    });
  });
  it('el cliente envía kind waypoints con punto cuantizado a 2 decimales y radio de 5 km', async () => {
    const invoke = vi.fn<RouteSourceInvoker['invoke']>().mockResolvedValue({ data: { data: [] }, error: null });
    await findWaypoints({ lat: 41.60049, lng: 2.16051 }, 21_000, { invoke });
    expect(invoke).toHaveBeenCalledWith('route-sources', { body: { lat: 41.6, lon: 2.16, radiusM: 25_000, source: 'osm', kind: 'waypoints' }, signal: undefined });
    invoke.mockResolvedValue({ data: null, error: {} });
    await expect(findWaypoints({ lat: 0, lng: 0 }, 20_000, { invoke })).rejects.toThrow();
  });
});
