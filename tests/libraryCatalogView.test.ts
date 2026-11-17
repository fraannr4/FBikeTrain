import type { CatalogRoute } from '../src/routes/library/catalog';
import { activeFilterCount, applyCatalogFilter, NO_FILTER, parseBound, sourcesOf, terrainFeel, type CatalogFilter } from '../src/routes/library/catalogView';

const centre = { lat: 40, lng: -3 };
const route = (n: number, over: Partial<CatalogRoute> = {}): CatalogRoute => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, source: 'rwgps', url: `https://ridewithgps.com/routes/${n}`,
  name: `Ruta ${n}`, author: 'Autora', distanceM: 50_000, elevGainM: 500, loop: true, unpavedPct: null,
  startLat: 40 + n * 0.01, startLng: -3, thumb: [[40, -3], [40.1, -3.1]], ...over,
});
const f = (over: Partial<CatalogFilter>): CatalogFilter => ({ ...NO_FILTER, ...over });
const names = (list: ReturnType<typeof applyCatalogFilter>) => list.map(r => r.route.name);

describe('parseBound', () => {
  it('lee números con coma o punto y trata lo vacío o inválido como sin límite', () => {
    expect(parseBound('45,5')).toBe(45.5);
    expect(parseBound(' 80 ')).toBe(80);
    expect(parseBound('')).toBeNull();
    expect(parseBound('abc')).toBeNull();
    expect(parseBound('-3')).toBeNull();
  });
});

describe('applyCatalogFilter', () => {
  const all = [
    route(1, { name: 'Vuelta al Pantano', author: 'Ana Gómez', distanceM: 40_000, elevGainM: 200 }),
    route(2, { name: 'Puerto de Navacerrada', author: 'Luis', distanceM: 90_000, elevGainM: 1800, loop: false, source: 'komoot' }),
    route(3, { name: 'Sin altitud', distanceM: 60_000, elevGainM: null, source: 'wikiloc' }),
  ];
  it('sin filtros devuelve todas, de la más cercana a la más lejana', () => {
    expect(names(applyCatalogFilter(all, NO_FILTER, centre))).toEqual(['Vuelta al Pantano', 'Puerto de Navacerrada', 'Sin altitud']);
  });
  it('busca por nombre o autor sin distinguir mayúsculas ni tildes', () => {
    expect(names(applyCatalogFilter(all, f({ text: 'pantano' }), centre))).toEqual(['Vuelta al Pantano']);
    expect(names(applyCatalogFilter(all, f({ text: 'GOMEZ' }), centre))).toEqual(['Vuelta al Pantano']);
    expect(names(applyCatalogFilter(all, f({ text: 'zzz' }), centre))).toEqual([]);
  });
  it('filtra por rango de distancia, inclusivo', () => {
    expect(names(applyCatalogFilter(all, f({ minKm: 60 }), centre))).toEqual(['Puerto de Navacerrada', 'Sin altitud']);
    expect(names(applyCatalogFilter(all, f({ maxKm: 40 }), centre))).toEqual(['Vuelta al Pantano']);
  });
  it('filtra por desnivel y descarta las rutas sin altitud', () => {
    expect(names(applyCatalogFilter(all, f({ minGain: 1000 }), centre))).toEqual(['Puerto de Navacerrada']);
    expect(names(applyCatalogFilter(all, f({ maxGain: 1000 }), centre))).toEqual(['Vuelta al Pantano']);
  });
  it('filtra por fuente y por circulares', () => {
    expect(names(applyCatalogFilter(all, f({ source: 'komoot' }), centre))).toEqual(['Puerto de Navacerrada']);
    expect(names(applyCatalogFilter(all, f({ loopOnly: true }), centre))).toEqual(['Vuelta al Pantano', 'Sin altitud']);
  });
  it('ordena por distancia, desnivel y nombre; las rutas sin altitud van las últimas', () => {
    expect(names(applyCatalogFilter(all, f({ sort: 'long' }), centre))).toEqual(['Puerto de Navacerrada', 'Sin altitud', 'Vuelta al Pantano']);
    expect(names(applyCatalogFilter(all, f({ sort: 'short' }), centre))[0]).toBe('Vuelta al Pantano');
    expect(names(applyCatalogFilter(all, f({ sort: 'climb' }), centre))).toEqual(['Puerto de Navacerrada', 'Vuelta al Pantano', 'Sin altitud']);
    expect(names(applyCatalogFilter(all, f({ sort: 'flat' }), centre))).toEqual(['Vuelta al Pantano', 'Puerto de Navacerrada', 'Sin altitud']);
    expect(names(applyCatalogFilter(all, f({ sort: 'name' }), centre))).toEqual(['Puerto de Navacerrada', 'Sin altitud', 'Vuelta al Pantano']);
  });
  it('lleva la distancia al inicio de cada ruta', () => {
    const [first] = applyCatalogFilter(all, NO_FILTER, centre);
    expect(first.awayM).toBeGreaterThan(1000);
    expect(first.awayM).toBeLessThan(1200);
  });
  it('no cambia la lista de entrada', () => {
    const copy = [...all];
    applyCatalogFilter(all, f({ sort: 'name' }), centre);
    expect(all).toEqual(copy);
  });
});

describe('terrainFeel', () => {
  it('describe el terreno por metros de subida por km', () => {
    expect(terrainFeel(route(1, { distanceM: 50_000, elevGainM: 200 }))).toBe('Llana');
    expect(terrainFeel(route(1, { distanceM: 50_000, elevGainM: 600 }))).toBe('Ondulada');
    expect(terrainFeel(route(1, { distanceM: 50_000, elevGainM: 1500 }))).toBe('Montañosa');
    expect(terrainFeel(route(1, { elevGainM: null }))).toBeNull();
  });
});

describe('utilidades de filtros', () => {
  it('cuenta los filtros activos, sin contar el orden', () => {
    expect(activeFilterCount(NO_FILTER)).toBe(0);
    expect(activeFilterCount(f({ minKm: 10, maxKm: 90, loopOnly: true, sort: 'name' }))).toBe(2);
    expect(activeFilterCount(f({ text: '  ' }))).toBe(0);
  });
  it('lista las fuentes presentes, ordenadas por nombre', () => {
    expect(sourcesOf([route(1), route(2, { source: 'komoot' }), route(3, { source: 'rwgps' })])).toEqual(['komoot', 'rwgps']);
  });
});
