import { FILL_MAX_ROUTES, fillCentre, fillZone, parseRwgpsSearch, rwgpsSearchUrl } from '../src/routes/library/fill';
import type { LibrarySearch } from '../src/routes/library/schema';
import type { ReferenceRouteRow } from '../src/routes/library/rows';
import { routeDetailJson, searchHit, searchJson } from './fixtures/libraryZone';

const search: LibrarySearch = { lat: 40.0123, lon: -3.0234, radiusM: 20_000, distanceKm: 60, elevGainM: null };
afterEach(() => vi.useRealTimers());

describe('centro y URL de búsqueda', () => {
  it('redondea el centro a la rejilla de 0,05°', () => {
    expect(fillCentre(41.6327, 2.1677)).toEqual({ lat: 41.65, lng: 2.15 });
    expect(fillCentre(40.0123, -3.0234)).toEqual({ lat: 40, lng: -3 });
    expect(fillCentre(-33.874, 151.226)).toEqual({ lat: -33.85, lng: 151.25 });
  });

  it('busca en find/search.json con el centro redondeado, el radio y la longitud en km', () => {
    const url = rwgpsSearchUrl(fillCentre(41.6327, 2.1677), 27, 60);
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://ridewithgps.com/find/search.json');
    expect(parsed.searchParams.get('search[lat]')).toBe('41.65');
    expect(parsed.searchParams.get('search[lng]')).toBe('2.15');
    expect(parsed.searchParams.get('search[start_distance]')).toBe('27');
    expect(parsed.searchParams.get('search[model_types]')).toBe('route');
    expect(Number(parsed.searchParams.get('search[length_min]'))).toBeGreaterThanOrEqual(20);
    expect(Number(parsed.searchParams.get('search[length_max]'))).toBeLessThanOrEqual(200);
    expect(decodeURIComponent(url)).not.toMatch(/\d\.\d{3,}/);
  });
});

describe('parseRwgpsSearch', () => {
  it('se queda con las rutas de carretera con poca tierra', () => {
    const json = searchJson([
      searchHit(1),
      searchHit(2, { unpaved_pct: 30 }),
      searchHit(3, { activity_types: ['cycling:gravel'] }),
      { type: 'trip', trip: { id: 4 } },
      searchHit(5, { is_trip: true }),
      searchHit(6, { unpaved_pct: null, track_type: 'out_and_back', activity_types: ['cycling:generic', 'cycling:road'] }),
      searchHit(7, { id: 'x' }),
    ]);
    expect(parseRwgpsSearch(json)).toEqual([
      { id: 1, distanceM: 60_000, unpavedPct: 0, loop: true, road: true },
      { id: 6, distanceM: 60_000, unpavedPct: null, loop: false, road: true },
    ]);
  });

  it('una respuesta que no es una búsqueda da una lista vacía', () => {
    expect(parseRwgpsSearch(null)).toEqual([]);
    expect(parseRwgpsSearch({ results: 'x' })).toEqual([]);
  });
});

describe('fillZone', () => {
  type Deps = Parameters<typeof fillZone>[1];
  const deps = (hits: unknown[], over: Partial<Deps> = {}) => {
    const events: string[] = [];
    const d: Deps = {
      transport: vi.fn().mockResolvedValue(JSON.stringify(searchJson(hits))),
      claim: vi.fn().mockImplementation(async () => { events.push('claim'); return true; }),
      routeDetail: vi.fn().mockImplementation(async (id: number) => { events.push(`detail:${id}`); return { status: 200, json: routeDetailJson(id) }; }),
      upsert: vi.fn().mockImplementation(async (rows: ReferenceRouteRow[]) => rows.length),
      signal: new AbortController().signal,
      ...over,
    };
    return { d, events };
  };
  const run = async (d: Deps) => {
    vi.useFakeTimers();
    const pending = fillZone(search, d);
    await vi.runAllTimersAsync();
    return pending;
  };

  it('importa como mucho 15, reclama el turno antes de cada detalle y solo envía el centro redondeado', async () => {
    const { d, events } = deps(Array.from({ length: 20 }, (_, i) => searchHit(i + 1)));
    const result = await run(d);
    expect(result).toEqual({ found: 20, imported: FILL_MAX_ROUTES, ids: Array.from({ length: 15 }, (_, i) => i + 1) });
    expect(d.routeDetail).toHaveBeenCalledTimes(15);
    expect(events.slice(0, 4)).toEqual(['claim', 'detail:1', 'claim', 'detail:2']);
    expect(events.filter(e => e === 'claim')).toHaveLength(15);
    const rows = vi.mocked(d.upsert).mock.calls[0][0];
    expect(rows).toHaveLength(15);
    expect(rows[0]).toMatchObject({ source: 'rwgps', source_id: '1', url: 'https://ridewithgps.com/routes/1', loop: true });
    const url = String(vi.mocked(d.transport).mock.calls[0][0]);
    expect(url).toContain('search%5Blat%5D=40&');
    expect(url).not.toContain('40.012');
    expect(url).not.toContain('3.023');
  });

  it('espera al menos un segundo entre peticiones a Ride with GPS', async () => {
    vi.useFakeTimers();
    const { d } = deps([searchHit(1), searchHit(2)]);
    const pending = fillZone(search, d);
    await vi.advanceTimersByTimeAsync(1000);
    expect(d.routeDetail).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(d.routeDetail).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(d.routeDetail).toHaveBeenCalledTimes(2);
    await pending;
  });

  it('para al primer turno denegado y conserva lo ya importado', async () => {
    let n = 0;
    const { d } = deps(Array.from({ length: 6 }, (_, i) => searchHit(i + 1)), { claim: vi.fn().mockImplementation(async () => ++n <= 3) });
    const result = await run(d);
    expect(result).toEqual({ found: 6, imported: 3, ids: [1, 2, 3] });
    expect(d.routeDetail).toHaveBeenCalledTimes(3);
    expect(vi.mocked(d.upsert).mock.calls[0][0]).toHaveLength(3);
  });

  it('descarta longitudes fuera de 20-200 km, rutas no públicas o con tierra en el detalle', async () => {
    const { d } = deps([searchHit(1, { distance: 15_000 }), searchHit(2, { distance: 250_000 }), searchHit(3), searchHit(4), searchHit(5)], {
      routeDetail: vi.fn().mockImplementation(async (id: number) => (id === 4 ? { status: 404, json: null }
        : id === 5 ? { status: 200, json: { route: { ...routeDetailJson(5).route, unpaved_pct: 40 } } } : { status: 200, json: routeDetailJson(id) })),
    });
    const result = await run(d);
    expect(result).toEqual({ found: 3, imported: 1, ids: [3] });
  });

  it('sin resultados no pide detalles ni escribe', async () => {
    const { d } = deps([]);
    expect(await run(d)).toEqual({ found: 0, imported: 0, ids: [] });
    expect(d.claim).not.toHaveBeenCalled();
    expect(d.upsert).not.toHaveBeenCalled();
  });

  it('un 429 en el detalle corta conservando lo importado; sin credenciales falla como no disponible', async () => {
    const busy = deps([searchHit(1), searchHit(2), searchHit(3)], {
      routeDetail: vi.fn().mockImplementation(async (id: number) => (id === 2 ? { status: 429, json: null } : { status: 200, json: routeDetailJson(id) })),
    });
    expect(await run(busy.d)).toEqual({ found: 3, imported: 1, ids: [1] });
    expect(busy.d.routeDetail).toHaveBeenCalledTimes(2);
    const locked = deps([searchHit(1)], { routeDetail: vi.fn().mockResolvedValue({ status: 401, json: null }) });
    vi.useFakeTimers();
    const pending = expect(fillZone(search, locked.d)).rejects.toThrow('unavailable');
    await vi.runAllTimersAsync();
    await pending;
    expect(locked.d.upsert).not.toHaveBeenCalled();
  });

  it('una búsqueda que no es JSON es una respuesta no válida', async () => {
    const { d } = deps([], { transport: vi.fn().mockResolvedValue('<html>captcha</html>') });
    await expect(fillZone(search, d)).rejects.toThrow('invalid_response');
  });
});
