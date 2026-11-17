import { buildLibraryCatalog, catalogRequestSchema, catalogResponseSchema, detailRequestSchema, detailResponseSchema, MAX_CATALOG_ROUTES, normalizeCatalogRequest, thumbLine, toLibraryDetail } from '../src/routes/library/catalog';
import { squareRow } from './fixtures/libraryZone';

const base = { lat: 40, lon: -3, radiusM: 50_000 };

describe('catálogo de la biblioteca: peticiones', () => {
  it('acepta un centro y un radio, y rechaza campos de más o fuera de rango', () => {
    expect(catalogRequestSchema.safeParse(base).success).toBe(true);
    for (const bad of [{ ...base, radiusM: 1000 }, { ...base, radiusM: 200_000 }, { ...base, lat: 91 }, { ...base, extra: 1 }, { ...base, radiusM: 10.5 }])
      expect(catalogRequestSchema.safeParse(bad).success).toBe(false);
  });
  it('agrupa el punto a 3 decimales y el radio hacia arriba al km', () => {
    expect(normalizeCatalogRequest({ lat: 40.12345, lon: -3.98765, radiusM: 25_100 })).toEqual({ lat: 40.123, lon: -3.988, radiusM: 26_000 });
  });
  it('la ruta se pide por id uuid', () => {
    expect(detailRequestSchema.safeParse({ id: '00000000-0000-4000-8000-000000000001' }).success).toBe(true);
    expect(detailRequestSchema.safeParse({ id: '1; drop table' }).success).toBe(false);
  });
});

describe('catálogo de la biblioteca: respuesta', () => {
  const rows = [
    squareRow(1, { km: 40, eastKm: 20, elevGainM: 300 }),
    squareRow(2, { km: 80, eastKm: 2, elevGainM: null }),
    squareRow(3, { km: 60, eastKm: 300 }),
  ];
  it('lista solo rutas con el inicio dentro del círculo, de la más cercana a la más lejana', () => {
    const out = buildLibraryCatalog(base, rows);
    expect(out.routes.map(r => r.name)).toEqual(['Vuelta sintética 2', 'Vuelta sintética 1']);
    expect(out.total).toBe(2);
  });
  it('lleva el inicio a 3 decimales y una línea de miniatura sin altitud', () => {
    const [first] = buildLibraryCatalog(base, rows).routes;
    expect(first.startLat).toBe(Math.round(rows[1].start_lat * 1000) / 1000);
    expect(first.thumb.length).toBeLessThanOrEqual(60);
    expect(first.thumb.every(p => p.length === 2)).toBe(true);
    expect(catalogResponseSchema.parse(JSON.parse(JSON.stringify(buildLibraryCatalog(base, rows))))).toBeTruthy();
  });
  it('limita la respuesta y avisa del total', () => {
    const many = Array.from({ length: MAX_CATALOG_ROUTES + 20 }, (_, i) => squareRow(i + 1, { km: 30 }));
    const out = buildLibraryCatalog(base, many);
    expect(out.routes).toHaveLength(MAX_CATALOG_ROUTES);
    expect(out.total).toBe(MAX_CATALOG_ROUTES + 20);
  });
  it('sin rutas devuelve una lista vacía válida', () => {
    expect(catalogResponseSchema.parse(buildLibraryCatalog(base, []))).toEqual({ total: 0, routes: [] });
  });
});

describe('thumbLine', () => {
  const long = Array.from({ length: 2000 }, (_, i) => [-3 + i * 1e-5, 40 + i * 1e-5, 500] as [number, number, number]);
  it('reduce a 48 puntos con el primero y el último, sin altitud y a 4 decimales', () => {
    const t = thumbLine(long);
    expect(t).toHaveLength(48);
    expect(t[0]).toEqual([40, -3]);
    expect(t[47]).toEqual([40.02, -2.98]);
  });
  it('conserva una línea corta entera', () => {
    expect(thumbLine([[1, 2], [3, 4]])).toEqual([[2, 1], [4, 3]]);
  });
});

describe('detalle de una ruta', () => {
  it('devuelve la línea completa con altitud y no filtra campos internos', () => {
    const row = { ...squareRow(1, { km: 40 }), line: [[-3, 40, 100], [-3.01, 40.01, 120]] as [number, number, number][] };
    const detail = toLibraryDetail(row);
    expect(detail.line).toEqual(row.line);
    expect(Object.keys(detail)).not.toContain('start_lat');
    expect(detailResponseSchema.parse(JSON.parse(JSON.stringify(detail)))).toEqual(detail);
  });
});
