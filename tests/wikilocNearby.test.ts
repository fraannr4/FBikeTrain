import Dexie from 'dexie';
import { CyclingDb, db } from '../src/db/db';
import type { UserReference } from '../src/metrics/reference';
import {
  NEARBY_TTL_MS, WikilocCardSchema, WikilocMessageSchema, clearNearby, loadNearby, rankForTarget, saveNearby,
  wikilocSearchUrl, type WikilocCard,
} from '../src/routes/wikilocNearby';

// Datos sintéticos: inicio en el mar frente a la costa, ids y nombres inventados.
const START = { lat: 41.0, lng: 2.5 };
const card = (over: Partial<WikilocCard> = {}): WikilocCard => ({
  id: '1001', nombre: 'Vuelta sintética', km: 75, desnivelM: 900, dificultad: 'moderado', autor: 'Autor de prueba',
  url: 'https://es.wikiloc.com/rutas-ciclismo/vuelta-sintetica-1001', ...over,
});
const REF: UserReference = {
  source: 'history', weeks: 8, rides: 10, ridesPerWeek: 1.25, avgDistanceM: 75_000, avgElevGainM: 800,
  avgMovingTimeS: 10_000, avgSpeedMs: 7, longestDistanceM: 120_000, maxElevGainM: 1800,
};

describe('wikilocSearchUrl', () => {
  it('abre el mapa de ciclismo de carretera con un rectángulo alrededor del inicio', () => {
    const url = new URL(wikilocSearchUrl(START));
    expect(url.origin).toBe('https://es.wikiloc.com');
    expect(url.pathname).toBe('/wikiloc/map.do');
    expect(url.searchParams.get('act')).toBe('29');
    expect(url.searchParams.get('page')).toBe('1');
    const [swLat, swLng] = url.searchParams.get('sw')!.split(',').map(Number);
    const [neLat, neLng] = url.searchParams.get('ne')!.split(',').map(Number);
    // 8 km de radio: ~0,0719° de latitud y ~0,0951° de longitud a 41° N.
    expect(swLat).toBeCloseTo(41 - 8 / 111.32, 4);
    expect(neLat).toBeCloseTo(41 + 8 / 111.32, 4);
    expect(neLng - START.lng).toBeCloseTo(8 / (111.32 * Math.cos((41 * Math.PI) / 180)), 4);
    expect(START.lng - swLng).toBeCloseTo(neLng - START.lng, 5);
  });
  it('usa 5 decimales, codifica los parámetros y respeta el radio pedido', () => {
    const raw = wikilocSearchUrl(START, 4);
    expect(raw).toBe('https://es.wikiloc.com/wikiloc/map.do?sw=40.96407%2C2.45239&ne=41.03593%2C2.54761&act=29&page=1');
  });
  it('rechaza un inicio o un radio no válidos', () => {
    expect(() => wikilocSearchUrl({ lat: Number.NaN, lng: 2.5 })).toThrow();
    expect(() => wikilocSearchUrl({ lat: 95, lng: 2.5 })).toThrow();
    expect(() => wikilocSearchUrl(START, 0)).toThrow();
  });
});

describe('esquemas del mensaje del marcador', () => {
  it('acepta una lista válida, con nulos donde faltan datos', () => {
    const msg = { v: 1, kind: 'list', rutas: [card(), card({ id: '2002', desnivelM: null, dificultad: null, autor: null, url: 'https://wikiloc.com/x-2002' })] };
    expect(WikilocMessageSchema.parse(msg)).toEqual(msg);
  });
  it('acepta una lista vacía y rechaza más de 50 rutas', () => {
    expect(WikilocMessageSchema.safeParse({ v: 1, kind: 'list', rutas: [] }).success).toBe(true);
    const many = Array.from({ length: 51 }, (_, i) => card({ id: String(i + 1) }));
    expect(WikilocMessageSchema.safeParse({ v: 1, kind: 'list', rutas: many }).success).toBe(false);
  });
  it('rechaza otra versión, otro tipo y campos extra', () => {
    expect(WikilocMessageSchema.safeParse({ v: 2, kind: 'list', rutas: [] }).success).toBe(false);
    expect(WikilocMessageSchema.safeParse({ v: 1, kind: 'otro', rutas: [] }).success).toBe(false);
    expect(WikilocMessageSchema.safeParse({ v: 1, kind: 'list', rutas: [], extra: 1 }).success).toBe(false);
    expect(WikilocCardSchema.safeParse({ ...card(), lat: 41 }).success).toBe(false);
  });
  it.each([
    ['id con letras', { id: '12a' }],
    ['id vacío', { id: '' }],
    ['nombre vacío', { nombre: '' }],
    ['nombre largo', { nombre: 'x'.repeat(121) }],
    ['km negativo', { km: -1 }],
    ['km excesivo', { km: 1001 }],
    ['km no finito', { km: Number.POSITIVE_INFINITY }],
    ['desnivel excesivo', { desnivelM: 20_001 }],
    ['dificultad desconocida', { dificultad: 'imposible' }],
    ['autor largo', { autor: 'a'.repeat(81) }],
  ])('rechaza una tarjeta con %s', (_, over) => {
    expect(WikilocCardSchema.safeParse({ ...card(), ...over }).success).toBe(false);
  });
  it('acepta los límites exactos', () => {
    expect(WikilocCardSchema.safeParse(card({ nombre: 'x'.repeat(120), km: 1000, desnivelM: 20_000, autor: 'a'.repeat(80) })).success).toBe(true);
    expect(WikilocCardSchema.safeParse(card({ km: 0, desnivelM: 0, dificultad: 'experto' })).success).toBe(true);
  });
  it.each([
    'http://es.wikiloc.com/ruta-1',
    'https://user:pw@es.wikiloc.com/ruta-1',
    'https://es.wikiloc.com@evil.io/ruta-1',
    'javascript:alert(1)',
    'https://wikiloc.com.evil.io/ruta-1',
    'https://evilwikiloc.com/ruta-1',
    'https://es.wikiloc.com:8443/ruta-1',
    'no es un enlace',
  ])('rechaza el enlace %s', (url) => {
    expect(WikilocCardSchema.safeParse(card({ url })).success).toBe(false);
  });
  it('acepta un track con su GPX y rechaza uno de más de 5 MB o vacío', () => {
    const track = { v: 1, kind: 'track', id: '1001', url: card().url, nombre: 'Vuelta sintética', autor: null, gpx: '<gpx version="1.1"></gpx>' };
    expect(WikilocMessageSchema.parse(track)).toEqual(track);
    expect(WikilocMessageSchema.safeParse({ ...track, gpx: '' }).success).toBe(false);
    expect(WikilocMessageSchema.safeParse({ ...track, gpx: 'x'.repeat(5 * 1024 * 1024 + 1) }).success).toBe(false);
    // El límite es en bytes: 2,5 M caracteres de dos bytes superan los 5 MB.
    expect(WikilocMessageSchema.safeParse({ ...track, gpx: 'ñ'.repeat(2.5 * 1024 * 1024 + 1) }).success).toBe(false);
    expect(WikilocMessageSchema.safeParse({ ...track, url: 'https://wikiloc.com.evil.io/r' }).success).toBe(false);
    expect(WikilocMessageSchema.safeParse({ ...track, rutas: [] }).success).toBe(false);
  });
});

describe('almacenamiento de «Wikiloc cerca»', () => {
  beforeEach(async () => { await Promise.all(db.tables.map(table => table.clear())); });

  it('sin lista guardada, no hay nada', async () => {
    expect(await loadNearby(1_000)).toEqual({ state: 'none' });
  });
  it('guarda la lista con su fecha y la devuelve mientras no caduca', async () => {
    const rutas = [card(), card({ id: '2002' })];
    await saveNearby(rutas, 1_000);
    expect(await loadNearby(1_000 + NEARBY_TTL_MS)).toEqual({ state: 'ok', savedAt: 1_000, rutas });
  });
  it('una lista nueva sustituye a la anterior', async () => {
    await saveNearby([card()], 1_000);
    await saveNearby([card({ id: '3003' })], 2_000);
    expect(await loadNearby(2_000)).toEqual({ state: 'ok', savedAt: 2_000, rutas: [card({ id: '3003' })] });
  });
  it('a los 7 días la descarta y la borra', async () => {
    expect(NEARBY_TTL_MS).toBe(7 * 24 * 3600 * 1000);
    await saveNearby([card()], 1_000);
    expect(await loadNearby(1_000 + NEARBY_TTL_MS + 1)).toEqual({ state: 'expired', savedAt: 1_000 });
    expect(await db.wikilocNearby.count()).toBe(0);
    expect(await loadNearby(1_000 + NEARBY_TTL_MS + 1)).toEqual({ state: 'none' });
  });
  it('no guarda tarjetas que no cumplen el esquema', async () => {
    await expect(saveNearby([card({ url: 'https://wikiloc.com.evil.io/x' })], 1_000)).rejects.toThrow();
    expect(await db.wikilocNearby.count()).toBe(0);
  });
  it('clearNearby borra la lista', async () => {
    await saveNearby([card()], 1_000);
    await clearNearby();
    expect(await loadNearby(1_000)).toEqual({ state: 'none' });
  });
  it('la versión nueva conserva los datos de una base v4', async () => {
    const name = 'test-wikiloc-nearby-upgrade';
    const old = new Dexie(name);
    old.version(4).stores({ activities: 'id,startTime', tracks: 'activityId', settings: 'key', meta: 'key', climbEfforts: 'id,activityId', routeSigs: 'activityId,distanceM', calendar: 'id,date', goals: 'id,kind', referenceRoutes: 'id,updatedAt' });
    await old.table('meta').put({ key: 'keep', value: 42 });
    await old.table('referenceRoutes').put({ id: 'r1', updatedAt: 5 });
    old.close();
    const upgraded = new CyclingDb(name);
    try {
      expect((await upgraded.meta.get('keep'))?.value).toBe(42);
      expect((await upgraded.referenceRoutes.get('r1'))?.updatedAt).toBe(5);
      expect(await upgraded.wikilocNearby.count()).toBe(0);
      expect(upgraded.verno).toBe(5);
    } finally { await upgraded.delete(); }
  });
});

describe('rankForTarget', () => {
  it('admite de 0,5× a 1,6× la distancia pedida y explica cada descarte', () => {
    const cards = [
      card({ id: '1', km: 37 }), card({ id: '2', km: 37.5 }), card({ id: '3', km: 120 }), card({ id: '4', km: 121 }),
    ];
    const { ranked, discarded } = rankForTarget(cards, { distanceKm: 75 }, null);
    expect(ranked.map(r => r.card.id).sort()).toEqual(['2', '3']);
    expect(discarded).toEqual([
      { card: cards[0], motivo: 'Demasiado corta: 37 km frente a 75 km pedidos (mínimo 38 km).' },
      { card: cards[3], motivo: 'Demasiado larga: 121 km frente a 75 km pedidos (máximo 120 km).' },
    ]);
  });
  it('ordena por cercanía relativa a la distancia y dice si se recorta o se alarga', () => {
    const cards = [card({ id: '1', km: 106.44 }), card({ id: '2', km: 73 }), card({ id: '3', km: 50 }), card({ id: '4', km: 80 })];
    const { ranked } = rankForTarget(cards, { distanceKm: 75 }, null);
    expect(ranked.map(r => r.card.id)).toEqual(['2', '4', '3', '1']);
    expect(ranked.map(r => r.ajuste)).toEqual(['encaja', 'encaja', 'alargar', 'recortar']);
    expect(ranked[0].motivo).toBe('Encaja: 73 km frente a 75 km pedidos.');
    expect(ranked[2].motivo).toBe('Se alarga de 50 km a 75 km.');
    expect(ranked[3].motivo).toBe('Se recorta de 106 km a 75 km.');
  });
  it('recorta por encima de +8 % y alarga por debajo de −20 %, como la adaptación', () => {
    const { ranked } = rankForTarget([card({ id: '1', km: 81 }), card({ id: '2', km: 81.1 }), card({ id: '3', km: 60 }), card({ id: '4', km: 59.9 })], { distanceKm: 75 }, null);
    const ajuste = Object.fromEntries(ranked.map(r => [r.card.id, r.ajuste]));
    expect(ajuste).toEqual({ 1: 'encaja', 2: 'recortar', 3: 'encaja', 4: 'alargar' });
  });
  it('si se pide desnivel, también ordena por él y nunca descarta por desnivel', () => {
    const cards = [
      card({ id: '1', km: 75, desnivelM: 2400 }),
      card({ id: '2', km: 78, desnivelM: 1000 }),
      card({ id: '3', km: 76, desnivelM: null }),
    ];
    const { ranked, discarded } = rankForTarget(cards, { distanceKm: 75, elevGainM: 1000 }, null);
    expect(discarded).toEqual([]);
    expect(ranked.map(r => r.card.id)).toEqual(['2', '3', '1']);
    expect(ranked[0].motivo).toBe('Encaja: 78 km frente a 75 km pedidos. Desnivel: 1000 m frente a 1000 m pedidos.');
    expect(ranked[1].motivo).toBe('Encaja: 76 km frente a 75 km pedidos. Desnivel sin dato.');
  });
  it('sin desnivel pedido, el desnivel no cambia el orden', () => {
    const { ranked } = rankForTarget([card({ id: '1', km: 76, desnivelM: 3000 }), card({ id: '2', km: 78, desnivelM: 100 })], { distanceKm: 75 }, null);
    expect(ranked.map(r => r.card.id)).toEqual(['1', '2']);
  });
  it('el nivel solo pone la etiqueta y desempata: nunca descarta', () => {
    const cards = [
      card({ id: '1', km: 70, desnivelM: 3000 }), // Dura para la referencia
      card({ id: '2', km: 80, desnivelM: 800 }), // Media
      card({ id: '3', km: 116, desnivelM: 2000 }), // Dura y larga, pero dentro del margen
    ];
    const { ranked, discarded } = rankForTarget(cards, { distanceKm: 75 }, REF);
    expect(discarded).toEqual([]);
    // 1 y 2 están igual de cerca (5 km); desempata la Media.
    expect(ranked.map(r => r.card.id)).toEqual(['2', '1', '3']);
    expect(ranked.map(r => r.etiqueta)).toEqual(['Media', 'Dura', 'Dura']);
  });
  it('sin referencia no hay etiqueta y el empate se resuelve por id', () => {
    const { ranked } = rankForTarget([card({ id: '2', km: 80 }), card({ id: '1', km: 70 })], { distanceKm: 75 }, null);
    expect(ranked.map(r => [r.card.id, r.etiqueta])).toEqual([['1', null], ['2', null]]);
  });
  it('no modifica la lista recibida', () => {
    const cards = [card({ id: '1', km: 100 }), card({ id: '2', km: 75 })];
    const copy = structuredClone(cards);
    rankForTarget(cards, { distanceKm: 75 }, REF);
    expect(cards).toEqual(copy);
  });
  it('rechaza una distancia pedida no válida', () => {
    expect(() => rankForTarget([card()], { distanceKm: 0 }, null)).toThrow();
    expect(() => rankForTarget([card()], { distanceKm: Number.NaN }, null)).toThrow();
    expect(() => rankForTarget([card()], { distanceKm: 75, elevGainM: -1 }, null)).toThrow();
  });
});
