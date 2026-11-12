/* Solo recepción de ficheros y enlaces compartidos. Ninguna petición GET ni recurso de la app se cachea. */
const SHARE_CACHE = 'fbiketrain-shares-v1';
const base = new URL('./', self.location.href);
// Sin la puntuación final de una frase («… esta ruta: https://ridewithgps.com/routes/123.»).
const RWGPS_LINK = /https:\/\/(?:www\.)?ridewithgps\.com\/(?:routes|collections)\/\d+(?:-[\w-]*)?(?:\?[\w=&%-]+)?/g;
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
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
