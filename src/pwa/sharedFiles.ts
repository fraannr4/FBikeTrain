import { descendants, parseXml } from '../import/xml';

export const SHARE_CACHE = 'fbiketrain-shares-v1';
export type SharedDestination = 'route' | 'activity';

/** Una fecha de metadata GPX no demuestra que se haya grabado una actividad. */
export async function sharedDestination(file: File): Promise<SharedDestination> {
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  if (extension === 'fit') return 'activity';
  if (extension !== 'gpx' && extension !== 'tcx') throw new Error('Formato no admitido. Usa GPX, TCX o FIT.');
  if (file.size > 10 * 1024 * 1024) throw new Error('El fichero XML supera el límite de 10 MB.');
  const xml = await file.text();
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('No se admiten declaraciones DOCTYPE ni entidades.');
  const doc = parseXml(xml);
  if (extension === 'gpx' && doc.documentElement?.localName === 'gpx') {
    const tracks = descendants(doc, 'trk');
    const wikilocReference = descendants(doc, 'author').length > 0 && descendants(doc, 'link').some(link => {
      try { return /(^|\.)wikiloc\.com$/i.test(new URL(link.getAttribute('href') ?? '').hostname); }
      catch { return false; }
    });
    if (tracks.length === 1 && wikilocReference && descendants(doc, 'rte').length === 0) return 'route';
    const recorded = descendants(doc, 'trkpt').some(point => descendants(point, 'time').length > 0);
    if (recorded) return 'activity';
    if (tracks.length === 1 && descendants(doc, 'rte').length === 0) return 'route';
    throw new Error('Comparte un GPX con un solo track o una actividad con tiempos.');
  }
  if (extension === 'tcx' && doc.documentElement?.localName === 'TrainingCenterDatabase') {
    if (descendants(doc, 'Activity').length > 0) return 'activity';
    if (descendants(doc, 'Course').length === 1) return 'route';
    throw new Error('Comparte un TCX con un solo recorrido.');
  }
  throw new Error('El contenido no corresponde a la extensión del fichero.');
}

export function sharedCacheKey(id: string, base = new URL(import.meta.env.BASE_URL, window.location.origin).href): string {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('El envío no es válido.');
  return new URL(`shared-inbox/${id}`, base).href;
}

/** Solo se llama tras Auth. No enumera ni mezcla envíos de otras ventanas. */
export async function readSharedFiles(id: string, storage: CacheStorage = caches): Promise<File[]> {
  const key = sharedCacheKey(id);
  const cache = await storage.open(SHARE_CACHE);
  const response = await cache.match(key);
  if (!response) return [];
  if (Number(response.headers.get('X-Shared-At') ?? 0) < Date.now() - 86400000) {
    await cache.delete(key);
    return [];
  }
  const data = await response.formData();
  const files = data.getAll('files').filter((value): value is File => typeof value !== 'string');
  await cache.delete(key);
  return files;
}

// StrictMode monta dos veces los efectos: cada envío se consume una sola vez.
const deliveries = new Map<string, Promise<File[]>>();
export function takeSharedFiles(id: string): Promise<File[]> {
  let delivery = deliveries.get(id);
  if (!delivery) {
    delivery = readSharedFiles(id).catch(error => { deliveries.delete(id); throw error; });
    deliveries.set(id, delivery);
  }
  return delivery;
}
export function releaseSharedFiles(id: string): void { deliveries.delete(id); }

const PENDING = 'fbt-pending-share';
export function rememberSharedLocation(): void {
  try {
    if (/^#\/compartido\?envio=[a-zA-Z0-9-]{1,80}$/.test(location.hash)) sessionStorage.setItem(PENDING, location.hash);
  } catch { /* El hash sigue disponible para el login con contraseña. */ }
}
export function restoreSharedLocation(): void {
  try {
    const hash = sessionStorage.getItem(PENDING);
    if (hash && /^#\/compartido\?envio=[a-zA-Z0-9-]{1,80}$/.test(hash)) {
      history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
      sessionStorage.removeItem(PENDING);
    }
  } catch { /* Almacenamiento bloqueado. */ }
}
