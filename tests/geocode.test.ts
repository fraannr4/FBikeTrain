import { searchPlaces } from '../src/social/geocode';

const ok = (rows: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(rows), { status: 200 }));

describe('búsqueda de pueblos en Nominatim', () => {
  it('con menos de 3 letras no llama', async () => {
    const fetchImpl = ok([]);
    expect(await searchPlaces('  ab ', fetchImpl)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pide solo poblaciones, en castellano, y convierte cada resultado en un lugar', async () => {
    const long = `Pueblo Sintético, ${'Comarca Larga '.repeat(8)}, España`;
    const fetchImpl = ok([
      { display_name: 'Villa Prueba, Provincia Ficticia, España', lat: '41.6077', lon: '2.2876' },
      { display_name: long, lat: '40.1', lon: '-3.5' },
      { display_name: 'Sin coordenadas', lat: 'x', lon: '1' },
    ]);
    const places = await searchPlaces('Villa Prueba', fetchImpl);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: 'jsonv2', limit: '5', 'accept-language': 'es', featureType: 'settlement', q: 'Villa Prueba',
    });
    expect(places).toEqual([
      { name: 'Villa Prueba, Provincia Ficticia, España', lat: 41.6077, lng: 2.2876 },
      { name: long.slice(0, 80).trim(), lat: 40.1, lng: -3.5 },
    ]);
  });

  it('un fallo de red o una respuesta de error dan un mensaje claro', async () => {
    await expect(searchPlaces('Villa', vi.fn().mockRejectedValue(new TypeError('offline')))).rejects.toThrow('No se ha podido buscar el pueblo.');
    await expect(searchPlaces('Villa', vi.fn().mockResolvedValue(new Response('', { status: 503 })))).rejects.toThrow('No se ha podido buscar el pueblo.');
  });

  it('una búsqueda cancelada no se convierte en error de red', async () => {
    const abort = new AbortController();
    abort.abort();
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(searchPlaces('Villa', fetchImpl, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
