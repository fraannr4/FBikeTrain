import { WikilocCardSchema } from '../src/routes/wikilocNearby';
import {
  WIKILOC_FORMAT, mapQueryUrl, parseQuantity, readFindResponse, readListFromDocument, readTrackPage,
} from '../src/bookmarklet/wikilocReader';

// HTML y JSON sintéticos: imitan la forma de una vista de Wikiloc, con ids, nombres y autores inventados.
const PAGE = 'https://es.wikiloc.com/wikiloc/map.do?sw=40.9,2.4&ne=41.1,2.6&act=29&page=1';
const html = (body: string) => new DOMParser().parseFromString(`<!doctype html><html><body>${body}</body></html>`, 'text/html');

const LIST = `
<ul>
  <li class="trail-card" data-trail-id="2001">
    <h3 class="trail-title"><a href="/rutas-ciclismo-de-carretera/vuelta-sintetica-al-mar-2001?utm=x#mapa">Vuelta sintética al mar</a></h3>
    <a class="trail-author" href="/wikiloc/user.do?id=9">Autora Prueba</a>
    <dl>
      <dt>Distancia</dt><dd>106,44 km</dd>
      <dt>Desnivel positivo:</dt><dd>2.405 m</dd>
      <dt>Dificultad técnica</dt><dd>Difícil</dd>
    </dl>
  </li>
  <li class="trail-card">
    <h3 class="trail-title"><a href="https://es.wikiloc.com/rutas-ciclismo-de-carretera/llano-de-prueba-2002">Llano de prueba</a></h3>
    <span data-stat="distance">48 km</span>
    <span data-stat="elevation-gain">310 m</span>
    <span data-stat="difficulty">Fácil</span>
  </li>
</ul>`;

describe('parseQuantity', () => {
  it('lee cifras en castellano con miles y decimales', () => {
    expect(parseQuantity('106,44 km', 'km')).toBe(106.44);
    expect(parseQuantity('2.405 m', 'm')).toBe(2405);
    expect(parseQuantity('2405 m', 'm')).toBe(2405);
    expect(parseQuantity('1.234,5 km', 'km')).toBe(1234.5);
    expect(parseQuantity('106.44 km', 'km')).toBe(106.44);
  });
  it('convierte metros a km en la distancia y no confunde km con m', () => {
    expect(parseQuantity('850 m', 'km')).toBe(0.85);
    expect(parseQuantity('12 km', 'm')).toBe(12_000);
  });
  it('devuelve null sin cifra o con otra unidad', () => {
    expect(parseQuantity('—', 'km')).toBeNull();
    expect(parseQuantity('66 mi', 'km')).toBeNull();
    expect(parseQuantity('7890 ft', 'm')).toBeNull();
  });
});

describe('readListFromDocument', () => {
  it('lee nombre, km, desnivel, dificultad, autor, enlace e id de cada tarjeta', () => {
    const cards = readListFromDocument(html(LIST), PAGE);
    expect(cards).toEqual([
      {
        id: '2001', nombre: 'Vuelta sintética al mar', km: 106.44, desnivelM: 2405, dificultad: 'dificil',
        autor: 'Autora Prueba', url: 'https://es.wikiloc.com/rutas-ciclismo-de-carretera/vuelta-sintetica-al-mar-2001',
      },
      {
        id: '2002', nombre: 'Llano de prueba', km: 48, desnivelM: 310, dificultad: 'facil',
        autor: null, url: 'https://es.wikiloc.com/rutas-ciclismo-de-carretera/llano-de-prueba-2002',
      },
    ]);
    for (const card of cards) expect(WikilocCardSchema.safeParse(card).success).toBe(true);
  });

  it('descarta tarjetas sin km o con un enlace que no es una ruta de wikiloc.com', () => {
    const doc = html(`
      <div class="trail-card"><h3 class="trail-title"><a href="/rutas-ciclismo-de-carretera/sin-km-3001">Sin km</a></h3></div>
      <div class="trail-card"><h3 class="trail-title"><a href="https://es.wikiloc.com.evil.io/rutas-ciclismo-de-carretera/falsa-3002">Falsa</a></h3><span data-stat="distance">50 km</span></div>
      <div class="trail-card"><h3 class="trail-title"><a href="javascript:alert(1)">Script</a></h3><span data-stat="distance">50 km</span></div>
      <div class="trail-card"><h3 class="trail-title"><a href="/wikiloc/user.do?id=4">Perfil</a></h3><span data-stat="distance">50 km</span></div>
      <div class="trail-card"><h3 class="trail-title"><a href="/rutas-ciclismo-de-carretera/valida-3003">Válida</a></h3><span data-stat="distance">50 km</span><span data-stat="elevation-gain">99999 m</span><span data-stat="difficulty">Rara</span></div>`);
    expect(readListFromDocument(doc, PAGE)).toEqual([{
      id: '3003', nombre: 'Válida', km: 50, desnivelM: null, dificultad: null, autor: null,
      url: 'https://es.wikiloc.com/rutas-ciclismo-de-carretera/valida-3003',
    }]);
  });

  it('quita duplicados, recorta textos largos y entrega como mucho 50 rutas', () => {
    const long = 'N'.repeat(130);
    const cards = Array.from({ length: 60 }, (_, i) => `
      <div class="trail-card"><h3 class="trail-title"><a href="/rutas-ciclismo-de-carretera/r-${4000 + i}">${long}</a></h3>
      <span class="trail-author">${'A'.repeat(90)}</span><span data-stat="distance">${60 + i} km</span></div>`).join('');
    const doc = html(cards + cards);
    const read = readListFromDocument(doc, PAGE);
    expect(read).toHaveLength(WIKILOC_FORMAT.maxCards);
    expect(new Set(read.map(c => c.id)).size).toBe(50);
    expect(read[0].nombre).toHaveLength(120);
    expect(read[0].autor).toHaveLength(80);
    for (const card of read) expect(WikilocCardSchema.safeParse(card).success).toBe(true);
  });

  it('no lee nada en una página sin tarjetas', () => {
    expect(readListFromDocument(html('<main><p>Sin resultados</p></main>'), PAGE)).toEqual([]);
  });
});

describe('mapQueryUrl', () => {
  it('pide la consulta del propio mapa para la misma vista y en el mismo origen', () => {
    const url = new URL(mapQueryUrl(PAGE));
    expect(url.origin).toBe('https://es.wikiloc.com');
    expect(url.pathname).toBe(WIKILOC_FORMAT.find.path);
    expect(url.searchParams.get('event')).toBe('map');
    expect(url.searchParams.get('sw')).toBe('40.9,2.4');
    expect(url.searchParams.get('ne')).toBe('41.1,2.6');
    expect(url.searchParams.get('act')).toBe('29');
    expect(url.searchParams.get('page')).toBe('1');
  });
});

describe('readFindResponse', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    id: 5001, name: 'Circuito sintético', distance: 75_300, elevationGain: 940, difficulty: 3,
    author: { name: 'Autor Prueba' }, prettyURL: '/rutas-ciclismo-de-carretera/circuito-sintetico-5001', ...over,
  });

  it('lee las rutas de la respuesta del mapa con las claves de WIKILOC_FORMAT', () => {
    const cards = readFindResponse({ spas: [item(), item({ id: 5002, name: 'Otro', distance: '48,5 km', elevationGain: '300 m', difficulty: 'Moderado', author: null, prettyURL: '/rutas-ciclismo-de-carretera/otro-5002' })] }, PAGE);
    expect(cards).toEqual([
      { id: '5001', nombre: 'Circuito sintético', km: 75.3, desnivelM: 940, dificultad: 'dificil', autor: 'Autor Prueba', url: 'https://es.wikiloc.com/rutas-ciclismo-de-carretera/circuito-sintetico-5001' },
      { id: '5002', nombre: 'Otro', km: 48.5, desnivelM: 300, dificultad: 'moderado', autor: null, url: 'https://es.wikiloc.com/rutas-ciclismo-de-carretera/otro-5002' },
    ]);
    for (const card of cards!) expect(WikilocCardSchema.safeParse(card).success).toBe(true);
  });

  it('acepta una lista en la raíz y descarta las entradas no válidas', () => {
    expect(readFindResponse([item({ prettyURL: 'https://evil.example/x-5003' }), item({ id: 'abc', prettyURL: '/rutas-ciclismo-de-carretera/b-5004' })], PAGE))
      .toEqual([expect.objectContaining({ id: '5004' })]);
  });

  it('devuelve null si la respuesta no tiene el formato esperado', () => {
    expect(readFindResponse({ otra: 'cosa' }, PAGE)).toBeNull();
    expect(readFindResponse('texto', PAGE)).toBeNull();
    expect(readFindResponse(null, PAGE)).toBeNull();
  });
});

describe('readTrackPage', () => {
  const TRACK = 'https://es.wikiloc.com/rutas-ciclismo-de-carretera/vuelta-sintetica-al-mar-2001?utm=x';
  it('lee id, enlace limpio, nombre y autor de la ficha', () => {
    const doc = html('<h1> Vuelta  sintética al mar </h1><div itemprop="author"><span itemprop="name">Autora Prueba</span></div>');
    expect(readTrackPage(doc, TRACK)).toEqual({
      id: '2001', url: 'https://es.wikiloc.com/rutas-ciclismo-de-carretera/vuelta-sintetica-al-mar-2001',
      nombre: 'Vuelta sintética al mar', autor: 'Autora Prueba',
    });
  });
  it('devuelve null fuera de una ficha o sin nombre', () => {
    expect(readTrackPage(html('<h1>Mapa</h1>'), PAGE)).toBeNull();
    expect(readTrackPage(html('<p>Sin título</p>'), TRACK)).toBeNull();
  });
});
