import source from '../public/sw.js?raw';

const BASE = 'https://fran.example/FBikeTrain/';
type FetchEvent = { request: Request; respondWith: (r: Promise<Response>) => void; waitUntil: (p: Promise<unknown>) => void };

function loadWorker() {
  const store = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (key: string) => store.get(key)?.clone()),
    put: vi.fn(async (key: string, response: Response) => { store.delete(key); store.set(key, response); }),
    keys: vi.fn(async () => [...store.keys()]),
    delete: vi.fn(async (key: string) => store.delete(key)),
  };
  const open = vi.fn(async () => cache);
  vi.stubGlobal('caches', { open });
  const network = vi.fn<(request: Request) => Promise<Response>>();
  vi.stubGlobal('fetch', network);
  let handler: (event: FetchEvent) => void = () => {};
  const self = {
    location: { href: `${BASE}sw.js` },
    addEventListener: (type: string, added: typeof handler) => { if (type === 'fetch') handler = added; },
    skipWaiting: vi.fn(), clients: { claim: vi.fn() },
  };
  new Function('self', source)(self);
  /** Devuelve la respuesta del worker, o `undefined` si deja pasar la petición sin tocarla. */
  const request = async (url: string, init?: RequestInit) => {
    let answer: Promise<Response> | undefined;
    const pending: Promise<unknown>[] = [];
    handler({ request: new Request(url, init), respondWith: r => { answer = r; }, waitUntil: p => pending.push(p) });
    const response = answer ? await answer : undefined;
    await Promise.all(pending);
    return response;
  };
  return { request, network, store, open };
}
const page = (text: string, init?: ResponseInit) => {
  const response = new Response(text, init);
  Object.defineProperty(response, 'type', { value: 'basic' });
  response.clone = () => page(text, init);
  return response;
};

afterEach(() => vi.unstubAllGlobals());

describe('service worker: arranque sin red', () => {
  it('sirve un fichero de assets/ desde la copia guardada sin volver a la red', async () => {
    const { request, network } = loadWorker();
    network.mockResolvedValueOnce(page('código'));
    expect(await (await request(`${BASE}assets/App-abc.js`))!.text()).toBe('código');
    expect(await (await request(`${BASE}assets/App-abc.js`))!.text()).toBe('código');
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('pide la página a la red y, si la red falla, entrega la última guardada', async () => {
    const { request, network } = loadWorker();
    network.mockResolvedValueOnce(page('versión 1')).mockResolvedValueOnce(page('versión 2')).mockRejectedValueOnce(new TypeError('sin red'));
    expect(await (await request(BASE))!.text()).toBe('versión 1');
    expect(await (await request(BASE))!.text()).toBe('versión 2');
    expect(await (await request(BASE))!.text()).toBe('versión 2');
  });

  it('sin red y sin copia, la petición falla como fallaría sin worker', async () => {
    const { request, network } = loadWorker();
    network.mockRejectedValue(new TypeError('sin red'));
    await expect(request(BASE)).rejects.toThrow('sin red');
    await expect(request(`${BASE}assets/Rutas-abc.js`)).rejects.toThrow('sin red');
  });

  it('no toca otros orígenes, el propio worker, los envíos compartidos ni las peticiones parciales', async () => {
    const { request, network, open } = loadWorker();
    for (const url of ['https://proyecto.supabase.co/rest/v1/profiles', 'https://a.tile-cyclosm.example/1/2/3.png', 'https://fran.example/otra-app/', `${BASE}sw.js`, `${BASE}shared-inbox/abc`]) {
      expect(await request(url)).toBeUndefined();
    }
    expect(await request(`${BASE}assets/video.mp4`, { headers: { range: 'bytes=0-1' } })).toBeUndefined();
    expect(network).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('no guarda respuestas de error', async () => {
    const { request, network, store } = loadWorker();
    network.mockResolvedValueOnce(page('no existe', { status: 404 }));
    expect((await request(`${BASE}assets/viejo-abc.js`))!.status).toBe(404);
    expect(store.size).toBe(0);
  });

  it('borra las copias más antiguas al pasar de 200', async () => {
    const { request, network, store } = loadWorker();
    network.mockImplementation(async () => page('x'));
    for (let index = 0; index < 203; index++) await request(`${BASE}assets/f-${index}.js`);
    expect(store.size).toBe(200);
    expect(store.has(`${BASE}assets/f-0.js`)).toBe(false);
    expect(store.has(`${BASE}assets/f-202.js`)).toBe(true);
  });
});
