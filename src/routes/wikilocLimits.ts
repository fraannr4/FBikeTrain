/**
 * Límites del mensaje de «Wikiloc cerca», compartidos por la app y el marcador.
 * Sin dependencias: el marcador los incluye sin arrastrar zod ni la base de datos.
 */

export const MAX_NEARBY_CARDS = 50;
export const MAX_WIKILOC_GPX_BYTES = 5 * 1024 * 1024;
export const WIKILOC_NAME_MAX = 120;
export const WIKILOC_AUTHOR_MAX = 80;

/** Solo https, sin credenciales ni puerto, y host wikiloc.com o un subdominio suyo. */
export function isWikilocUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && !url.username && !url.password && !url.port
    && (host === 'wikiloc.com' || host.endsWith('.wikiloc.com'));
}

/** Tamaño en bytes UTF-8; un texto con más caracteres que el límite ya lo supera sin codificarlo. */
export const fitsGpx = (gpx: string) => gpx.length <= MAX_WIKILOC_GPX_BYTES && new TextEncoder().encode(gpx).length <= MAX_WIKILOC_GPX_BYTES;
