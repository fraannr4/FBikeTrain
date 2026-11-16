import { buildLibraryZone, circleBox } from '../src/routes/library/zoneResponse';
import { encodeLibraryZone, libraryZoneSchema, MAX_LIBRARY_ROUTES, normalizeLibrarySearch, type LibrarySearch } from '../src/routes/library/schema';
import type { HeatCell } from '../src/routes/library/heat';
import { squareRow, START } from './fixtures/libraryZone';

const search: LibrarySearch = { lat: START.lat, lon: START.lng, radiusM: 20_000, distanceKm: 60, elevGainM: null };
const cell = (lat: number, lng: number, routes: number): HeatCell => ({ cell: `${lat}:${lng}`, lat, lng, routes, climbMPerKm: 12, ele: 300 });

describe('buildLibraryZone', () => {
  it('cuenta solo las rutas que pasan por el círculo', () => {
    const zone = buildLibraryZone(search, [squareRow(1, { km: 60 }), squareRow(2, { km: 10, eastKm: 60 })], [], 'none');
    expect(zone.routeCount).toBe(1);
    expect(zone.fill).toBe('none');
  });

  it('propone como candidatas B las de 70-140 % de la longitud que pasan a 5 km o menos, por parecido', () => {
    const rows = [40, 42, 60, 84, 85].map((km, i) => squareRow(i + 1, { km }));
    rows.push(squareRow(9, { km: 60, eastKm: 7 }));
    const zone = buildLibraryZone(search, rows, [], 'none');
    expect(zone.routeCount).toBe(6);
    expect(zone.routes.map(r => r.distanceM)).toEqual([60_000, 42_000, 84_000]);
    expect(zone.routes[0]).toMatchObject({ id: rows[2].id, source: 'rwgps', url: rows[2].url, name: rows[2].name, author: 'Autor sintético', elevGainM: null, loop: true });
    expect(zone.routes[0].passM).toBeLessThan(50);
    expect(zone.routes[0].line).toEqual(rows[2].line);
  });

  it('devuelve como mucho 6 candidatas, las más parecidas', () => {
    const rows = [50, 52, 55, 58, 61, 63, 66, 75].map((km, i) => squareRow(i + 1, { km }));
    const zone = buildLibraryZone(search, rows, [], 'none');
    expect(zone.routes).toHaveLength(MAX_LIBRARY_ROUTES);
    expect(zone.routes.map(r => r.distanceM / 1000)).toEqual([61, 58, 63, 55, 66, 52]);
  });

  it('con desnivel pedido, las rutas sin desnivel van detrás de las que lo tienen', () => {
    const rows = [squareRow(1, { km: 60, elevGainM: null }), squareRow(2, { km: 70, elevGainM: 800 }), squareRow(3, { km: 58, elevGainM: 400 })];
    const zone = buildLibraryZone({ ...search, elevGainM: 800 }, rows, [], 'none');
    expect(zone.routes.map(r => r.id)).toEqual([rows[1].id, rows[2].id, rows[0].id]);
  });

  it('solo da las celdas del círculo, de más a menos rutas', () => {
    const zone = buildLibraryZone(search, [], [cell(40.01, -3, 1), cell(40.5, -3, 9), cell(40, -2.99, 5)], 'none');
    expect(zone.cells).toEqual([
      { lat: 40, lng: -2.99, routes: 5, climbMPerKm: 12 },
      { lat: 40.01, lng: -3, routes: 1, climbMPerKm: 12 },
    ]);
  });

  it('con 3 circulares usa el factor por defecto y da la subida típica', () => {
    const rows = [1, 2, 3].map(n => squareRow(n, { km: 60, elevGainM: 600 }));
    const zone = buildLibraryZone(search, rows, [], 'imported');
    expect(zone).toMatchObject({ zoneFactor: 1.7, factorSamples: 3, fill: 'imported' });
    expect(zone.climbMPerKm).toBeCloseTo(10, 5);
  });

  it('sin rutas: 0 rutas, 0 celdas y subida desconocida', () => {
    expect(buildLibraryZone(search, [], [], 'nothing-found')).toEqual({
      routeCount: 0, cells: [], routes: [], zoneFactor: 1.7, factorSamples: 0, climbMPerKm: null, fill: 'nothing-found',
    });
  });
});

describe('circleBox', () => {
  it('contiene el círculo entero', () => {
    const box = circleBox(40, -3, 20_000);
    expect((box.maxLat - box.minLat) * 111_195).toBeCloseTo(40_000, -1);
    expect((box.maxLng - box.minLng) * 111_195 * Math.cos((40 * Math.PI) / 180)).toBeCloseTo(40_000, -1);
    expect((box.minLat + box.maxLat) / 2).toBeCloseTo(40, 9);
  });
});

describe('esquemas de la operación library', () => {
  it('normaliza el punto, el radio, los km y el desnivel', () => {
    expect(normalizeLibrarySearch({ lat: 41.63271, lon: 2.16774, radiusM: 26_100, distanceKm: 60.4, elevGainM: 820 }))
      .toEqual({ lat: 41.633, lon: 2.168, radiusM: 27_000, distanceKm: 60, elevGainM: 800 });
    expect(normalizeLibrarySearch({ ...search, elevGainM: null }).elevGainM).toBeNull();
  });

  it('las celdas viajan como tuplas y vuelven como objetos', () => {
    const zone = buildLibraryZone(search, [squareRow(1, { km: 60, elevGainM: 600 })], [cell(40, -2.99, 5), { ...cell(40.01, -3, 2), climbMPerKm: null }], 'none');
    const wire = JSON.parse(JSON.stringify(encodeLibraryZone(zone)));
    expect(wire.cells).toEqual([[40, -2.99, 5, 12], [40.01, -3, 2, null]]);
    expect(libraryZoneSchema.parse(wire)).toEqual(zone);
  });

  it('rechaza más de 6 rutas, una celda mal formada o un fill desconocido', () => {
    const zone = buildLibraryZone(search, [squareRow(1, { km: 60 })], [], 'none');
    const wire = JSON.parse(JSON.stringify(encodeLibraryZone(zone)));
    expect(libraryZoneSchema.safeParse({ ...wire, routes: Array(7).fill(wire.routes[0]) }).success).toBe(false);
    expect(libraryZoneSchema.safeParse({ ...wire, cells: [[40, -3, 0, null]] }).success).toBe(false);
    expect(libraryZoneSchema.safeParse({ ...wire, fill: 'maybe' }).success).toBe(false);
    expect(libraryZoneSchema.safeParse({ ...wire, extra: 1 }).success).toBe(false);
  });
});
