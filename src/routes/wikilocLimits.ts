/** Solo https, sin credenciales ni puerto, y host wikiloc.com o un subdominio suyo. */
export function isWikilocUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && !url.username && !url.password && !url.port
    && (host === 'wikiloc.com' || host.endsWith('.wikiloc.com'));
}
