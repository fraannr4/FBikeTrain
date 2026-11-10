/* Solo recepción de ficheros. Ninguna petición GET ni recurso de la app se cachea. */
const SHARE_CACHE = 'fbiketrain-shares-v1';
const base = new URL('./', self.location.href);
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'POST' || event.request.url !== new URL('share-target', base).href) return;
  event.respondWith((async () => {
    try {
      const data = await event.request.formData();
      const files = data.getAll('files').filter(value => value instanceof File);
      if (!files.length) return Response.redirect(new URL('#/compartido?error=empty', base), 303);
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
