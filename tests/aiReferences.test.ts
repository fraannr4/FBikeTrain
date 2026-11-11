import { pickReferences, libraryReferences, MAX_AI_REFERENCES } from '../src/ai/references';
import { parseReferenceRoute, type ReferenceRoute } from '../src/routes/library';
import type { RouteReference } from '../src/routes/sources/schema';

/** Referencias sintéticas: nombres y enlaces inventados, geometría en el mar (lat 41.0, lng 2.5). */
function reference(i: number, o: Partial<RouteReference> = {}): RouteReference {
  return {
    source: 'osm',
    url: `https://www.openstreetmap.org/relation/90000${i}`,
    author: `Autor ficticio ${i}`,
    name: `Vuelta sintética ${i}`,
    distanceM: 20_000 + i * 5000,
    ascentM: 500 + i * 10,
    geometry: { type: 'MultiLineString', coordinates: [[[2.5, 41.0], [2.51, 41.01]]] },
    fetchedAt: '2026-11-09T12:00:00.000Z',
    ...o,
  };
}

describe('pickReferences', () => {
  it('convierte cada referencia en cifras resumidas con un id propio', () => {
    const { forAi } = pickReferences([reference(1, { source: 'wikiloc', url: 'https://es.wikiloc.com/rutas-ciclismo/vuelta-900000001', distanceM: 42_345, ascentM: 612.4 })], 100);
    expect(forAi).toEqual([{ id: 'ref1', nombre: 'Vuelta sintética 1', fuente: 'wikiloc', distanciaKm: 42.3, desnivelM: 612 }]);
  });

  it('desnivel desconocido sigue siendo null, nunca cero', () => {
    const { forAi } = pickReferences([reference(1, { ascentM: null })], 100);
    expect(forAi[0].desnivelM).toBeNull();
  });

  it('envía como mucho 6', () => {
    const refs = Array.from({ length: 10 }, (_, i) => reference(i + 1));
    const { forAi, byId } = pickReferences(refs, 100);
    expect(MAX_AI_REFERENCES).toBe(6);
    expect(forAi).toHaveLength(6);
    expect(byId.size).toBe(6);
  });

  it('lo que se envía no lleva URL, autor, geometría ni coordenadas', () => {
    const { forAi } = pickReferences([reference(1), reference(2)], 100);
    const sent = JSON.stringify(forAi);
    expect(sent).not.toContain('openstreetmap');
    expect(sent).not.toContain('http');
    expect(sent).not.toContain('Autor ficticio');
    expect(sent).not.toContain('41.0');
    expect(sent).not.toContain('2.5');
    expect(Object.keys(forAi[0]).sort()).toEqual(['desnivelM', 'distanciaKm', 'fuente', 'id', 'nombre']);
  });

  it('descarta las que superan la distancia máxima en más de un 20 %', () => {
    const refs = [reference(1, { distanceM: 60_000 }), reference(2, { distanceM: 60_100 }), reference(3, { distanceM: 30_000 })];
    const { forAi } = pickReferences(refs, 50);
    expect(forAi.map((r) => r.nombre)).toEqual(['Vuelta sintética 1', 'Vuelta sintética 3']);
  });

  it('cada id lleva a su referencia original, con su enlace', () => {
    const refs = [reference(1, { distanceM: 90_000 }), reference(2)];
    const { forAi, byId } = pickReferences(refs, 50);
    expect(forAi.map((r) => r.id)).toEqual(['ref1']);
    expect(byId.get('ref1')).toBe(refs[1]);
  });

  it('acorta los nombres largos a 80 caracteres', () => {
    const { forAi } = pickReferences([reference(1, { name: 'x'.repeat(300) })], 100);
    expect(forAi[0].nombre).toHaveLength(80);
  });
});

describe('referencias de la biblioteca', () => {
  function local(id: string, offset = 0, sourceUrl?: string): ReferenceRoute {
    const parsed = parseReferenceRoute(`<gpx><trk><name>${id}</name><trkseg><trkpt lat="${41 + offset}" lon="2.5"><ele>10</ele></trkpt><trkpt lat="${41.001 + offset}" lon="2.501"><ele>20</ele></trkpt></trkseg></trk></gpx>`, 'sintetica.gpx', sourceUrl);
    return { ...parsed, id, author: 'Autora sintética', createdAt: 0, updatedAt: 0 };
  }
  it('filtra por cercanía y conserva el esqueleto solo en el mapa local', () => {
    const nearby = local('Cerca', 0, 'https://es.wikiloc.com/rutas-ciclismo/sintetica-1234');
    const refs = libraryReferences([nearby, local('Lejos', 1)], { lat: 41, lng: 2.5 }, 15_000);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ source: 'wikiloc', libraryId: 'Cerca', author: 'Autora sintética', points: nearby.points });
    const { forAi, byId } = pickReferences(refs, 50);
    expect(Object.keys(forAi[0]).sort()).toEqual(['desnivelM', 'distanciaKm', 'fuente', 'id', 'nombre']);
    expect(byId.get(forAi[0].id)?.libraryId).toBe('Cerca');
    expect(JSON.stringify(forAi)).not.toMatch(/author|points|https|lat|lng|libraryId/);
  });
  it('prioriza biblioteca, elimina duplicados y permite recortar una referencia larga', () => {
    const library = libraryReferences([local('Larga')], { lat: 41, lng: 2.5 }, 15_000);
    library[0].distanceM = 100_000;
    const refs = [reference(1, { name: ' larga ', distanceM: 40_000 }), ...library, reference(2, { distanceM: 45_000 }), reference(3, { distanceM: 45_100 })];
    const { forAi } = pickReferences(refs, 50);
    expect(forAi.map(r => r.nombre)).toEqual(['Larga', 'Vuelta sintética 2']);
    expect(forAi[0].fuente).toBe('biblioteca');
    expect(forAi[0].distanciaKm).toBe(100);
  });
  it('mantiene ids acotados aunque haya muchas rutas descartadas', () => {
    const distant = Array.from({ length: 20 }, (_, i) => reference(i, { distanceM: 150_000 }));
    const library = libraryReferences([local('Cerca')], { lat: 41, lng: 2.5 }, 15_000);
    expect(pickReferences([...distant, ...library], 50).forAi[0].id).toBe('ref1');
  });
});
