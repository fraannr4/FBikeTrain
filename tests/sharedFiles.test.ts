import { describe, expect, it, vi } from 'vitest';
import { readSharedFiles, savePendingSharedFiles, sharedCacheKey, sharedDestination, SHARE_CACHE } from '../src/pwa/sharedFiles';

const gpx = (inside: string) => `<gpx><metadata><time>2026-01-01T00:00:00Z</time></metadata><trk><trkseg>${inside}</trkseg></trk></gpx>`;
describe('destino de ficheros compartidos', () => {
  it('FIT siempre va al importador de actividades; extensión sin distinguir mayúsculas', async () => {
    expect(await sharedDestination(new File([''], 'SALIDA.FIT'))).toBe('activity');
  });
  it('GPX con un track sin tiempos es referencia, aunque metadata tenga fecha, autor y enlace', async () => {
    expect(await sharedDestination(new File([gpx('<trkpt lat="0" lon="0"/>')], 'wikiloc.gpx'))).toBe('route');
  });
  it('GPX con horas en puntos es actividad', async () => {
    expect(await sharedDestination(new File([gpx('<trkpt><time>2026-01-01T00:00:00Z</time></trkpt>')], 'salida.gpx'))).toBe('activity');
  });
  it('un track de Wikiloc con autor y enlace sigue siendo referencia aunque conserve tiempos', async () => {
    const xml = gpx('<trkpt><time>2026-01-01T00:00:00Z</time></trkpt>').replace('<metadata>', '<metadata><author><name>Sintético</name></author><link href="https://es.wikiloc.com/rutas/sintetica"/>');
    expect(await sharedDestination(new File([xml], 'wikiloc.gpx'))).toBe('route');
  });
  it.each(['<Course><Track/></Course>', '<ns:Course xmlns:ns="urn:tcx"><ns:Track/></ns:Course>'])('TCX Course es referencia (%s)', async xml => {
    expect(await sharedDestination(new File([`<TrainingCenterDatabase>${xml}</TrainingCenterDatabase>`], 'ruta.TCX'))).toBe('route');
  });
  it('TCX Activity va a actividades', async () => {
    expect(await sharedDestination(new File(['<TrainingCenterDatabase><Activities><Activity/></Activities></TrainingCenterDatabase>'], 'a.tcx'))).toBe('activity');
  });
  it.each(['archivo.zip', 'archivo.gpx.exe', 'archivo'])('rechaza extensión no admitida %s', async name => {
    await expect(sharedDestination(new File([''], name))).rejects.toThrow('Formato no admitido');
  });
  it.each(['<gpx><trk/><trk/></gpx>', '<gpx><rte/></gpx>', '<html/>', '<gpx>', '<!DOCTYPE gpx><gpx/>'])('rechaza XML ambiguo o inválido %s', async xml => {
    await expect(sharedDestination(new File([xml], 'ruta.gpx'))).rejects.toThrow();
  });
});

describe('bandeja temporal Cache API', () => {
  function storage(response?: { headers: Headers; formData: () => Promise<FormData> }) {
    const cache = { match: vi.fn().mockResolvedValue(response), delete: vi.fn().mockResolvedValue(true), put: vi.fn().mockResolvedValue(undefined) };
    const mock = { open: vi.fn().mockResolvedValue(cache) };
    return { cache, mock, api: mock as unknown as CacheStorage };
  }
  it('reconstruye varios ficheros y conserva el envío para una recarga antes de importar', async () => {
    const data = new FormData();
    data.append('files', new File(['synthetic'], 'ruta.gpx'));
    data.append('files', new File(['synthetic'], 'salida.fit'));
    data.append('files', 'texto ajeno');
    const { api, cache, mock } = storage({ headers: new Headers({ 'X-Shared-At': String(Date.now()) }), formData: async () => data });
    const files = await readSharedFiles('synthetic-1', api);
    expect(files.map(file => file.name)).toEqual(['ruta.gpx', 'salida.fit']);
    expect(await files[0].text()).toBe('synthetic');
    expect(mock.open).toHaveBeenCalledWith(SHARE_CACHE);
    expect(cache.delete).not.toHaveBeenCalled();
    expect((await readSharedFiles('synthetic-1', api)).map(file => file.name)).toEqual(['ruta.gpx', 'salida.fit']);
  });
  it('guarda solo los ficheros pendientes conservando la caducidad original', async () => {
    const at = String(Date.now() - 1000);
    const { api, cache } = storage({ headers: new Headers({ 'X-Shared-At': at }), formData: async () => new FormData() });
    // Response de Node no reconoce FormData de jsdom; el multipart real se prueba en Playwright.
    const responseConstructor = vi.spyOn(globalThis, 'Response').mockImplementation(body => ({ headers: new Headers(), formData: async () => body }) as Response);
    try { await savePendingSharedFiles('partial', [new File(['synthetic'], 'pendiente.gpx')], api); }
    finally { responseConstructor.mockRestore(); }
    expect(cache.put).toHaveBeenCalledOnce();
    const [key, response] = cache.put.mock.calls[0] as [string, Response];
    expect(key).toBe(sharedCacheKey('partial'));
    expect(response.headers.get('X-Shared-At')).toBe(at);
    expect(((await response.formData()).get('files') as File).name).toBe('pendiente.gpx');
    expect(cache.delete).not.toHaveBeenCalled();
  });
  it('borra solo el envío procesado o descartado expresamente', async () => {
    const { api, cache } = storage();
    await savePendingSharedFiles('completed', [], api);
    expect(cache.delete).toHaveBeenCalledWith(sharedCacheKey('completed'));
    expect(cache.put).not.toHaveBeenCalled();
  });
  it('envío ausente o ya consumido devuelve lista vacía', async () => {
    const { api, cache } = storage();
    expect(await readSharedFiles('absent', api)).toEqual([]);
    expect(cache.delete).not.toHaveBeenCalled();
  });
  it('elimina un envío caducado sin leer los ficheros', async () => {
    const formData = vi.fn();
    const { api, cache } = storage({ headers: new Headers({ 'X-Shared-At': '1' }), formData });
    expect(await readSharedFiles('old', api)).toEqual([]);
    expect(cache.delete).toHaveBeenCalledOnce();
    expect(formData).not.toHaveBeenCalled();
  });
  it('conserva la entrada si falla su lectura', async () => {
    const { api, cache } = storage({ headers: new Headers({ 'X-Shared-At': String(Date.now()) }), formData: async () => { throw new Error('read failed'); } });
    await expect(readSharedFiles('broken', api)).rejects.toThrow('read failed');
    expect(cache.delete).not.toHaveBeenCalled();
  });
  it('no permite claves fuera de la bandeja y respeta la subruta de Pages', () => {
    expect(sharedCacheKey('one', 'https://example.invalid/FBikeTrain/')).toBe('https://example.invalid/FBikeTrain/shared-inbox/one');
    expect(() => sharedCacheKey('../other')).toThrow();
  });
});
