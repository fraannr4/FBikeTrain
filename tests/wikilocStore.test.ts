import { db } from '../src/db/db';
import {
  NEARBY_TTL_MS, clearReceivedTrack, loadNearby, loadReceivedTrack, loadWikilocRequest, saveNearby, saveReceivedTrack,
  saveWikilocRequest, type WikilocTrackMessage,
} from '../src/routes/wikilocNearby';

// Datos sintéticos: GPX inventado en el mar, frente a la costa.
const GPX = '<gpx version="1.1"><trk><name>Vuelta sintética</name><trkseg><trkpt lat="41" lon="2.5"><ele>10</ele></trkpt><trkpt lat="41.01" lon="2.5"><ele>20</ele></trkpt></trkseg></trk></gpx>';
const TRACK: WikilocTrackMessage = {
  v: 1, kind: 'track', id: '1001', url: 'https://es.wikiloc.com/rutas-ciclismo/vuelta-sintetica-1001', nombre: 'Vuelta sintética', autor: 'Autor de prueba', gpx: GPX,
};
const NOW = Date.parse('2026-11-11T10:00:00Z');

beforeEach(async () => {
  await db.wikilocNearby.clear();
});

describe('ruta recibida de Wikiloc', () => {
  it('sin ruta recibida, no hay nada', async () => {
    expect(await loadReceivedTrack(NOW)).toEqual({ state: 'none' });
  });
  it('guarda la ruta con su fecha y la devuelve mientras no caduca', async () => {
    await saveReceivedTrack(TRACK, NOW);
    expect(await loadReceivedTrack(NOW + 1000)).toEqual({ state: 'ok', savedAt: NOW, track: TRACK });
  });
  it('a los 7 días la descarta y la borra', async () => {
    await saveReceivedTrack(TRACK, NOW);
    expect(await loadReceivedTrack(NOW + NEARBY_TTL_MS + 1)).toEqual({ state: 'expired', savedAt: NOW });
    expect(await loadReceivedTrack(NOW + NEARBY_TTL_MS + 2)).toEqual({ state: 'none' });
  });
  it('no guarda un mensaje que no cumple el esquema', async () => {
    await expect(saveReceivedTrack({ ...TRACK, url: 'https://wikiloc.com.evil.io/x' }, NOW)).rejects.toThrow();
    expect(await loadReceivedTrack(NOW)).toEqual({ state: 'none' });
  });
  it('convive con la lista: guardar o borrar una no toca la otra', async () => {
    await saveNearby([], NOW);
    await saveReceivedTrack(TRACK, NOW);
    await clearReceivedTrack();
    expect(await loadNearby(NOW)).toEqual({ state: 'ok', savedAt: NOW, rutas: [] });
    expect(await loadReceivedTrack(NOW)).toEqual({ state: 'none' });
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
