import { z } from 'zod';
import { ACCOUNT_PROJECT_URL, ACCOUNT_PUBLIC_KEY } from '../../auth/config';
import { rwgpsRouteToLibraryInput, RwgpsError, type RwgpsLibraryInput } from './ridewithgps';
import type { RwgpsRequest } from './rwgpsService';

/**
 * Ride with GPS compartido: la función `rwgps` lee la API v1 oficial con la cuenta común de FBikeTrain.
 * El navegador solo manda la sesión y el id de la ruta o colección; nunca ve la clave ni el token.
 */

/** Buscador de rutas de Ride with GPS: se abre en una pestaña del usuario. La API no busca por zona. */
export const RWGPS_FIND_URL = 'https://ridewithgps.com/find';
/** Como mucho, rutas por importación: cada una es una petición a Ride with GPS. */
export const MAX_RWGPS_IMPORT = 150;
/** Límite por persona de `consume_shared_rwgps_quota`. */
export const RWGPS_USER_DAY = 300;

export type RwgpsAccess = { getToken: () => Promise<string | null>; fetch?: typeof fetch };

const collectionSchema = z.object({
  collection: z.object({ name: z.string().nullish(), routes: z.array(z.object({ id: z.number().int().positive() })).nullish() }),
});

const MSG = {
  session: 'Tu sesión ha caducado. Vuelve a iniciar sesión para traer rutas de Ride with GPS.',
  unreachable: 'No se pudo conectar con el servicio de Ride with GPS. Revisa la conexión y vuelve a probar.',
  unavailable: 'Ride with GPS no está disponible ahora. Prueba más tarde.',
  busy: 'Ride with GPS limita las peticiones: espera unos minutos y vuelve a probar.',
  private: 'No es pública en Ride with GPS: solo se pueden traer rutas y colecciones públicas.',
  missing: 'No existe en Ride with GPS.',
  invalid: 'Ride with GPS no ha devuelto datos válidos.',
};

function quotaMessage(retryAfterS: number): string {
  const hours = Math.max(1, Math.round(retryAfterS / 3600));
  return `Has llegado al límite de Ride with GPS (${RWGPS_USER_DAY} rutas al día por persona, o el total compartido). Se renueva en unas ${hours} h.`;
}

/** Una lectura por la función `rwgps`. Los errores marcados como `fatal` paran el lote entero. */
async function callShared(request: RwgpsRequest, access: RwgpsAccess, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const token = await access.getToken();
  if (!token) throw new RwgpsError(MSG.session, true);
  let response: Response;
  try {
    response = await (access.fetch ?? fetch)(`${ACCOUNT_PROJECT_URL}/functions/v1/rwgps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: ACCOUNT_PUBLIC_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new RwgpsError(MSG.unreachable, true);
  }
  const body = (await response.json().catch(() => null)) as { data?: unknown; retryAfterS?: unknown; error?: { code?: unknown } } | null;
  if (response.ok) return body?.data ?? null;
  if (response.status === 401) throw new RwgpsError(MSG.session, true);
  if (response.status === 429) {
    if (body?.error?.code !== 'quota_exceeded') throw new RwgpsError(MSG.busy, true);
    const seconds = Number(body?.retryAfterS ?? response.headers.get('retry-after'));
    throw new RwgpsError(quotaMessage(Number.isFinite(seconds) && seconds > 0 ? seconds : 3600), true);
  }
  if (response.status === 403 && body?.error?.code === 'not_visible') throw new RwgpsError(MSG.private);
  if (response.status === 404 && body?.error?.code === 'not_found') throw new RwgpsError(MSG.missing);
  // Un 404 o 403 sin código propio es la función sin desplegar o un origen no permitido.
  if (response.status === 503 || response.status === 403 || response.status === 404) throw new RwgpsError(MSG.unavailable, true);
  throw new RwgpsError(MSG.invalid);
}

export type RwgpsLink =
  | { kind: 'route'; id: string; privacyCode?: string }
  | { kind: 'collection'; id: string; privacyCode?: string };

/** Enlaces de rutas (`/routes/{id}`) o colecciones (`/collections/{id}`) de ridewithgps.com en un texto libre. */
export function parseRwgpsLinks(text: string): { links: RwgpsLink[]; invalid: string[] } {
  const links: RwgpsLink[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\s,;<>"']+/).map((t) => t.trim()).filter(Boolean)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      invalid.push(raw);
      continue;
    }
    const route = /^\/routes\/(\d+)(?:[-/].*)?$/.exec(url.pathname);
    const collection = /^\/collections\/(\d+)(?:[-/].*)?$/.exec(url.pathname);
    if (url.protocol !== 'https:' || !/^(www\.)?ridewithgps\.com$/.test(url.hostname) || (!route && !collection)) {
      invalid.push(raw);
      continue;
    }
    const privacyCode = url.searchParams.get('privacy_code') ?? undefined;
    const link: RwgpsLink = { kind: route ? 'route' : 'collection', id: (route ?? collection)![1], ...(privacyCode ? { privacyCode } : {}) };
    const key = `${link.kind}:${link.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      links.push(link);
    }
  }
  return { links, invalid };
}

const withCode = (code?: string) => (code ? `?privacy_code=${encodeURIComponent(code)}` : '');

/** Ids de las rutas de una colección pública. */
export async function fetchRwgpsCollection(
  id: string, access: RwgpsAccess, signal?: AbortSignal,
): Promise<{ name: string; routeIds: string[] }> {
  const parsed = collectionSchema.safeParse(await callShared({ kind: 'collection', id }, access, signal));
  if (!parsed.success) throw new RwgpsError('Ride with GPS devolvió una colección que no se entiende.');
  return { name: parsed.data.collection.name?.trim() || 'Colección', routeIds: (parsed.data.collection.routes ?? []).map((r) => String(r.id)) };
}

export type RwgpsImportResult = { routes: (RwgpsLibraryInput & { id: string })[]; failed: { ref: string; message: string }[] };

/**
 * Descarga por la función compartida cada ruta enlazada y las de cada colección, una tras otra.
 * Una ruta que falla no detiene las demás; un error `fatal` (sesión, cuota, servicio caído) sí.
 */
export async function fetchRwgpsRoutes(
  links: RwgpsLink[],
  access: RwgpsAccess,
  opts: { signal?: AbortSignal; onProgress?: (p: { done: number; total: number }) => void } = {},
): Promise<RwgpsImportResult> {
  const failed: RwgpsImportResult['failed'] = [];
  const queue: { id: string; privacyCode?: string }[] = [];
  const seen = new Set<string>();
  const push = (id: string, privacyCode?: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    queue.push({ id, ...(privacyCode ? { privacyCode } : {}) });
  };
  for (const link of links) {
    opts.signal?.throwIfAborted();
    if (link.kind === 'route') {
      push(link.id, link.privacyCode);
      continue;
    }
    try {
      const collection = await fetchRwgpsCollection(link.id, access, opts.signal);
      collection.routeIds.forEach((id) => push(id));
    } catch (e) {
      if (opts.signal?.aborted || (e instanceof RwgpsError && e.fatal)) throw e;
      failed.push({ ref: `Colección ${link.id}`, message: e instanceof Error ? e.message : 'No se pudo leer.' });
    }
  }
  for (const extra of queue.splice(MAX_RWGPS_IMPORT)) failed.push({ ref: `Ruta ${extra.id}`, message: `Se importan ${MAX_RWGPS_IMPORT} rutas por vez como máximo.` });
  const routes: RwgpsImportResult['routes'] = [];
  for (const [i, item] of queue.entries()) {
    opts.signal?.throwIfAborted();
    opts.onProgress?.({ done: i, total: queue.length });
    try {
      const json = await callShared({ kind: 'route', id: item.id }, access, opts.signal);
      const url = `https://ridewithgps.com/routes/${item.id}${withCode(item.privacyCode)}`;
      routes.push({ ...rwgpsRouteToLibraryInput(json, url), id: item.id });
    } catch (e) {
      if (opts.signal?.aborted || (e instanceof RwgpsError && e.fatal)) throw e;
      failed.push({ ref: `Ruta ${item.id}`, message: e instanceof Error ? e.message : 'No se pudo leer.' });
    }
  }
  return { routes, failed };
}
