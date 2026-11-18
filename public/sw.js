/* Recepción de ficheros y enlaces compartidos, avisos push y arranque sin red con los recursos propios de la app. */
const SHARE_CACHE = 'fbiketrain-shares-v1';
const base = new URL('./', self.location.href);
// Sin la puntuación final de una frase («… esta ruta: https://ridewithgps.com/routes/123.»).
const RWGPS_LINK = /https:\/\/(?:www\.)?ridewithgps\.com\/(?:routes|collections)\/\d+(?:-[\w-]*)?(?:\?[\w=&%-]+)?/g;
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
/* Arranque sin red. Solo recursos propios de la app, guardados al usarlos: nada de otros orígenes (cuenta, mapas, datos). */
const APP_CACHE = 'fbiketrain-app-v1';
const APP_CACHE_MAX = 200;
async function keepCopy(request, response) {
  if (!response.ok || response.type !== 'basic') return;
  const cache = await caches.open(APP_CACHE);
  await cache.put(request, response);
  // Cada despliegue trae ficheros con nombre nuevo: se borran los más antiguos para no crecer sin límite.
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - APP_CACHE_MAX))) await cache.delete(key);
}
async function fromNetwork(event, key) {
  const response = await fetch(event.request);
  event.waitUntil(keepCopy(key, response.clone()).catch(() => { /* Sin espacio: la app sigue con la red. */ }));
  return response;
}
/** Ruta dentro de la app de un recurso propio que se puede guardar; `null` para todo lo demás. */
function appPath(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return null;
  const path = url.pathname.slice(base.pathname.length);
  return path === 'sw.js' || path.startsWith('shared-inbox/') ? null : path;
}
function appResource(event) {
  const path = appPath(event.request.url);
  if (path === null || event.request.headers.has('range')) return;
  const key = base.href + path;
  event.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    // Los ficheros de assets/ llevan su contenido en el nombre: la copia guardada nunca queda vieja.
    if (path.startsWith('assets/')) return (await cache.match(key)) ?? fromNetwork(event, key);
    // La página y los iconos, siempre de la red si la hay: un despliegue nuevo se ve al momento.
    try { return await fromNetwork(event, key); } catch (error) {
      const saved = await cache.match(key);
      if (saved) return saved;
      throw error;
    }
  })());
}
/* En la primera visita la página carga antes de que este worker mande: ella misma avisa de qué ha usado para guardarlo. */
self.addEventListener('message', event => {
  const data = event.data;
  if (!data || data.type !== 'keep' || !Array.isArray(data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    for (const value of data.urls.slice(0, 150)) {
      const path = typeof value === 'string' ? appPath(value) : null;
      if (path === null) continue;
      const key = base.href + path;
      try { if (!(await cache.match(key))) await keepCopy(key, await fetch(key)); } catch { /* Sin red o sin espacio: se guardará al usarlo. */ }
    }
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method === 'GET') { appResource(event); return; }
  if (event.request.method !== 'POST' || event.request.url !== new URL('share-target', base).href) return;
  event.respondWith((async () => {
    try {
      const data = await event.request.formData();
      const files = data.getAll('files').filter(value => value instanceof File);
      if (!files.length) {
        // Sin ficheros: un enlace de Ride with GPS (en `url`, `text` o `title`) abre «Una ruta de Explore».
        const shared = ['url', 'text', 'title'].map(name => data.get(name)).filter(value => typeof value === 'string').join(' ');
        const links = [...new Set(shared.match(RWGPS_LINK) ?? [])].slice(0, 20);
        if (links.length) return Response.redirect(new URL(`#/rutas/compartida?enlaces=${encodeURIComponent(links.join(' '))}`, base), 303);
        return Response.redirect(new URL('#/compartido?error=empty', base), 303);
      }
      if (files.length > 20 || files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) {
        return Response.redirect(new URL('#/compartido?error=size', base), 303);
      }
      const cache = await caches.open(SHARE_CACHE);
      // Los envíos abandonados caducan al cabo de 24 horas, sin tocar otras cachés.
      for (const key of await cache.keys()) {
        const saved = await cache.match(key);
        if (Number(saved?.headers.get('X-Shared-At') ?? 0) < Date.now() - 86400000) await cache.delete(key);
      }
      const id = crypto.randomUUID();
      const body = new FormData();
      files.forEach(file => body.append('files', file, file.name));
      const response = new Response(body);
      response.headers.set('X-Shared-At', String(Date.now()));
      await cache.put(new URL(`shared-inbox/${id}`, base), response);
      return Response.redirect(new URL(`#/compartido?envio=${id}`, base), 303);
    } catch {
      return Response.redirect(new URL('#/compartido?error=storage', base), 303);
    }
  })());
});

/* Avisos push: la Edge Function envía { title, body, url, tag }. La ruta siempre es un hash de la app. */
const appRoute = value => (typeof value === 'string' && /^#\/[\w\-\/]*$/.test(value) && value.length <= 120 ? value : '#/');
self.addEventListener('push', event => {
  let data = null;
  try { data = event.data ? event.data.json() : null; } catch { data = null; }
  const valid = data && typeof data.title === 'string' && data.title;
  const icon = new URL('brand-mark-192.png', base).href;
  // Chrome exige mostrar siempre un aviso (userVisibleOnly): con una carga ilegible, uno genérico.
  event.waitUntil(self.registration.showNotification(valid ? data.title.slice(0, 80) : 'FBikeTrain', {
    body: valid && typeof data.body === 'string' ? data.body.slice(0, 200) : 'Tienes un aviso nuevo.',
    icon, badge: icon,
    // Una etiqueta por tipo: un aviso nuevo del mismo tipo sustituye al anterior en lugar de apilarse.
    tag: valid && typeof data.tag === 'string' && /^[a-z-]{1,20}$/.test(data.tag) ? data.tag : 'fbiketrain',
    data: { url: valid ? appRoute(data.url) : '#/' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(appRoute(event.notification.data && event.notification.data.url), base).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(client => client.url.startsWith(base.href));
    if (open) {
      try { await open.focus(); await open.navigate(target); return; } catch { /* Sin permiso para navegarla: se abre otra. */ }
    }
    await self.clients.openWindow(target);
  })());
});
