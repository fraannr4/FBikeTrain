import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeRouteSearch, simplifyRouteReference } from '../src/routes/sources/limits';
import { loadWikiloc } from '../src/routes/sources/providers';
import { RouteSourceError, type RouteReference } from '../src/routes/sources/schema';

const fixture = (name: string) => readFileSync(resolve('tests/fixtures/route-sources', name), 'utf8');
const search = { lat: 0, lon: 0, radiusM: 5000 };
const at = '2026-11-09T12:00:00.000Z';
const template = 'https://es.wikiloc.com/public-search?lat={lat}&lon={lon}&radius={radiusM}';
const urls = [1, 2, 3].map(id => `https://es.wikiloc.com/rutas-ciclismo/prueba-90000000${id}`);
const searchHtml = urls.map(url => `<a href="${url}">Ruta ficticia</a>`).join('');

describe('límites de caché y geometría', () => {
  it('agrupa coordenadas a tres decimales y radios hacia arriba en pasos de 5 km', () => {
    expect(normalizeRouteSearch({ lat: 40.12341, lon: -3.12341, radiusM: 5001 })).toEqual({ lat: 40.123, lon: -3.123, radiusM: 10000 });
    expect(normalizeRouteSearch({ lat: -0.0001, lon: 180, radiusM: 100 })).toEqual({ lat: 0, lon: 180, radiusM: 5000 });
    expect(normalizeRouteSearch({ lat: 85, lon: -180, radiusM: 25000 })).toEqual({ lat: 85, lon: -180, radiusM: 25000 });
  });
  it('simplifica el total por ruta a 2000 puntos conservando segmentos y extremos', () => {
    const coordinates: [number, number][][] = [0, 1].map(y => Array.from({ length: 3000 }, (_, i) => [i / 100000, y + Math.sin(i / 10) / 10000]));
    const route: RouteReference = { source: 'osm', url: 'https://www.openstreetmap.org/relation/900001', author: 'Sintético', name: 'Sintética', fetchedAt: at, distanceM: 6000, ascentM: null, geometry: { type: 'MultiLineString', coordinates } };
    const result = simplifyRouteReference(route);
    const lines = result.geometry!.coordinates;
    expect(lines.reduce((n, line) => n + line.length, 0)).toBeLessThanOrEqual(2000);
    expect(lines).toHaveLength(2);
    lines.forEach((line, index) => { expect(line[0]).toEqual(coordinates[index][0]); expect(line.at(-1)).toEqual(coordinates[index].at(-1)); });
    expect(result.distanceM).toBe(6000); expect(route.geometry!.coordinates[0]).toHaveLength(3000);
    expect(simplifyRouteReference({ ...route, geometry: undefined }).geometry).toBeUndefined();
  });
  it('mantiene 500 segmentos sin superar el presupuesto conjunto ni unir huecos', () => {
    const route: RouteReference = { source: 'osm', url: 'https://www.openstreetmap.org/relation/900001', author: 'Sintético', name: 'Sintética', fetchedAt: at, distanceM: 10000, ascentM: null,
      geometry: { type: 'MultiLineString', coordinates: Array.from({ length: 500 }, (_, j) => Array.from({ length: 10 }, (_, i): [number, number] => [j / 100, i / 100000])) } };
    const lines = simplifyRouteReference(route).geometry!.coordinates;
    expect(lines).toHaveLength(500); expect(lines.reduce((n, line) => n + line.length, 0)).toBeLessThanOrEqual(2000);
    expect(lines.every(line => line.length >= 2)).toBe(true);
  });
});

describe('Wikiloc se detiene ante bloqueo/cambio en una ficha o GPX', () => {
  it.each(['blocked', 'html_changed'] as const)('conserva fichas anteriores ante %s y no consulta la siguiente', async code => {
    const detail = fixture('wikiloc-detail.html').replace(/<a href="\/public\/synthetic.gpx"[^>]*>.*?<\/a>/, '');
    const transport = vi.fn().mockResolvedValueOnce(searchHtml).mockResolvedValueOnce(detail).mockRejectedValueOnce(new RouteSourceError(code));
    const result = await loadWikiloc(search, at, transport, template);
    expect(result).toHaveLength(1); expect(result[0].url).toBe(urls[0]); expect(transport).toHaveBeenCalledTimes(3);
  });
  it.each(['blocked', 'html_changed'] as const)('conserva la ficha actual si su GPX devuelve %s', async code => {
    const transport = vi.fn().mockResolvedValueOnce(searchHtml).mockResolvedValueOnce(fixture('wikiloc-detail.html')).mockRejectedValueOnce(new RouteSourceError(code));
    const result = await loadWikiloc(search, at, transport, template);
    expect(result).toHaveLength(1); expect(result[0].geometry).toBeUndefined(); expect(transport).toHaveBeenCalledTimes(3);
  });
  it('devuelve metadatos previos al detectar cambio de HTML en la segunda ficha', async () => {
    const detail = fixture('wikiloc-detail.html').replace(/<a href="\/public\/synthetic.gpx"[^>]*>.*?<\/a>/, '');
    const transport = vi.fn().mockResolvedValueOnce(searchHtml).mockResolvedValueOnce(detail).mockResolvedValueOnce('<html>Formato nuevo</html>');
    expect(await loadWikiloc(search, at, transport, template)).toHaveLength(1); expect(transport).toHaveBeenCalledTimes(3);
  });
  it('devuelve error controlado si no hay fichas válidas, sin insistir ni aparentar búsqueda vacía', async () => {
    const transport = vi.fn().mockResolvedValueOnce(searchHtml).mockRejectedValueOnce(new RouteSourceError('blocked'));
    await expect(loadWikiloc(search, at, transport, template)).rejects.toThrow('blocked'); expect(transport).toHaveBeenCalledTimes(2);
  });
  it('detecta captcha en el GPX antes de intentar leerlo como XML', async () => {
    const transport = vi.fn().mockResolvedValueOnce(searchHtml).mockResolvedValueOnce(fixture('wikiloc-detail.html')).mockResolvedValueOnce(fixture('wikiloc-blocked.html'));
    expect(await loadWikiloc(search, at, transport, template)).toHaveLength(1); expect(transport).toHaveBeenCalledTimes(3);
  });
});
