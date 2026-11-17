import source from '../public/sw.js?raw';

type Handler = (event: Record<string, unknown>) => void;

function loadWorker(windows: Array<{ url: string; focus: ReturnType<typeof vi.fn>; navigate?: ReturnType<typeof vi.fn> }> = []) {
  const handlers: Record<string, Handler> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const self = {
    location: { href: 'https://fran.example/FBikeTrain/sw.js' },
    addEventListener: (type: string, handler: Handler) => { handlers[type] = handler; },
    skipWaiting: vi.fn(), clients: { claim: vi.fn(), matchAll: vi.fn().mockResolvedValue(windows), openWindow },
    registration: { showNotification },
  };
  new Function('self', source)(self);
  const run = async (type: string, event: Record<string, unknown>) => {
    const pending: Promise<unknown>[] = [];
    handlers[type]({ ...event, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  };
  return { handlers, showNotification, openWindow, self, run };
}
const pushEvent = (payload: unknown) => ({ data: { json: () => { if (payload instanceof Error) throw payload; return payload; } } });
const click = (url: unknown) => ({ notification: { close: vi.fn(), data: { url } } });

describe('service worker: avisos push', () => {
  it('muestra el aviso con el icono de la app y una etiqueta por tipo para no apilarlos', async () => {
    const { showNotification, run } = loadWorker();
    await run('push', pushEvent({ title: 'Te han retado', body: 'Tienes una invitación a un reto.', url: '#/retos/comunidad/abc', tag: 'reto' }));
    expect(showNotification).toHaveBeenCalledWith('Te han retado', expect.objectContaining({
      body: 'Tienes una invitación a un reto.', tag: 'reto', icon: 'https://fran.example/FBikeTrain/brand-mark-192.png', data: { url: '#/retos/comunidad/abc' },
    }));
  });
  it('siempre muestra algo, también con una carga ilegible o vacía (Chrome lo exige)', async () => {
    for (const payload of [new Error('no es JSON'), null, {}, { title: 42 }]) {
      const { showNotification, run } = loadWorker();
      await run('push', pushEvent(payload));
      expect(showNotification).toHaveBeenCalledWith('FBikeTrain', expect.objectContaining({ body: 'Tienes un aviso nuevo.', data: { url: '#/' } }));
    }
    const { showNotification, run } = loadWorker();
    await run('push', { data: null });
    expect(showNotification).toHaveBeenCalledTimes(1);
  });
  it('descarta etiquetas y rutas que no son de la app', async () => {
    const { showNotification, run } = loadWorker();
    await run('push', pushEvent({ title: 'T', body: 'B', url: 'https://evil.example/', tag: 'x'.repeat(80) }));
    const options = showNotification.mock.calls[0][1];
    expect(options.data).toEqual({ url: '#/' });
    expect(options.tag).toBe('fbiketrain');
  });
  it('al pulsar, enfoca una ventana abierta de la app y navega a la ruta', async () => {
    const focus = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn().mockResolvedValue(undefined);
    const { run, openWindow } = loadWorker([{ url: 'https://otra.example/', focus: vi.fn() }, { url: 'https://fran.example/FBikeTrain/#/', focus, navigate }]);
    const event = click('#/perfil/amigos');
    await run('notificationclick', event);
    expect(event.notification.close).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('https://fran.example/FBikeTrain/#/perfil/amigos');
    expect(openWindow).not.toHaveBeenCalled();
  });
  it('sin ventana abierta, abre una nueva en la ruta', async () => {
    const { run, openWindow } = loadWorker([]);
    await run('notificationclick', click('#/retos/comunidad/abc'));
    expect(openWindow).toHaveBeenCalledWith('https://fran.example/FBikeTrain/#/retos/comunidad/abc');
  });
  it('si no se puede navegar la ventana existente, abre una nueva', async () => {
    const { run, openWindow } = loadWorker([{ url: 'https://fran.example/FBikeTrain/', focus: vi.fn().mockResolvedValue(undefined), navigate: vi.fn().mockRejectedValue(new Error('no controlada')) }]);
    await run('notificationclick', click('#/retos'));
    expect(openWindow).toHaveBeenCalledWith('https://fran.example/FBikeTrain/#/retos');
  });
  it('una ruta ajena a la app abre solo la portada', async () => {
    const { run, openWindow } = loadWorker([]);
    await run('notificationclick', click('https://evil.example/'));
    expect(openWindow).toHaveBeenCalledWith('https://fran.example/FBikeTrain/#/');
  });
  it('conserva la recepción de ficheros compartidos', () => {
    const { handlers } = loadWorker();
    expect(Object.keys(handlers).sort()).toEqual(['activate', 'fetch', 'install', 'notificationclick', 'push']);
  });
});
