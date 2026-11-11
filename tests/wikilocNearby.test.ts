import Dexie from 'dexie';
import { CyclingDb, db } from '../src/db/db';
import { clearLegacyWikilocRows, loadWikilocRequest, saveWikilocRequest, wikilocSearchUrl } from '../src/routes/wikilocNearby';

// Datos sintéticos: inicio en el mar frente a la costa.
const START = { lat: 41.0, lng: 2.5 };

beforeEach(async () => {
  await db.wikilocNearby.clear();
});

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

describe('lo que pide el usuario para Wikiloc', () => {
  it('sin petición guardada, devuelve null', async () => {
    expect(await loadWikilocRequest()).toBeNull();
  });
  it('guarda la distancia, el desnivel opcional y el inicio', async () => {
    const request = { distanceKm: 75, elevGainM: null, start: { lat: 41, lng: 2.5 } };
    await saveWikilocRequest(request);
    expect(await loadWikilocRequest()).toEqual(request);
    await saveWikilocRequest({ ...request, elevGainM: 1200 });
    expect(await loadWikilocRequest()).toEqual({ ...request, elevGainM: 1200 });
  });
  it('rechaza cifras o un inicio no válidos', async () => {
    await expect(saveWikilocRequest({ distanceKm: 0, elevGainM: null, start: { lat: 41, lng: 2.5 } })).rejects.toThrow();
    await expect(saveWikilocRequest({ distanceKm: 75, elevGainM: -1, start: { lat: 41, lng: 2.5 } })).rejects.toThrow();
    await expect(saveWikilocRequest({ distanceKm: 75, elevGainM: null, start: { lat: 95, lng: 2.5 } })).rejects.toThrow();
    expect(await loadWikilocRequest()).toBeNull();
  });
});


describe('restos del marcador retirado', () => {
  it('borra la lista y la ruta recibida, y conserva la petición', async () => {
    const request = { distanceKm: 60, elevGainM: 700, start: START };
    await saveWikilocRequest(request);
    await db.wikilocNearby.put({ key: 'nearby' });
    await db.wikilocNearby.put({ key: 'track' });
    await clearLegacyWikilocRows();
    expect((await db.wikilocNearby.toCollection().primaryKeys()).sort()).toEqual(['request']);
    expect(await loadWikilocRequest()).toEqual(request);
  });
  it('la base v5 se abre desde una v4 sin perder datos', async () => {
    const name = 'test-wikiloc-nearby-upgrade';
    const old = new Dexie(name);
    old.version(4).stores({ activities: 'id,startTime', tracks: 'activityId', settings: 'key', meta: 'key', climbEfforts: 'id,activityId', routeSigs: 'activityId,distanceM', calendar: 'id,date', goals: 'id,kind', referenceRoutes: 'id,updatedAt' });
    await old.table('meta').put({ key: 'keep', value: 42 });
    old.close();
    const upgraded = new CyclingDb(name);
    try {
      expect((await upgraded.meta.get('keep'))?.value).toBe(42);
      expect(upgraded.verno).toBe(5);
    } finally { await upgraded.delete(); }
  });
});
