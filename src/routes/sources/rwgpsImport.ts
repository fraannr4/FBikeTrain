import { z } from 'zod';
import { rwgpsRouteToLibraryInput, RwgpsError, type RwgpsCredentials, type RwgpsLibraryInput } from './ridewithgps';

/**
 * Conexión con Ride with GPS (API v1 oficial, CORS abierto), colecciones e importación por lotes al catálogo.
 * Solo se usan endpoints documentados de /api/v1; nunca la web (robots.txt bloquea /routes/*.json y los GPX).
 */

const API = 'https://ridewithgps.com/api/v1';
/** Página de Ride with GPS donde el usuario crea su clave de API. */
export const RWGPS_API_CLIENTS_URL = 'https://ridewithgps.com/api/api_clients';
/** Buscador de rutas de Ride with GPS: se abre en una pestaña del usuario. */
export const RWGPS_FIND_URL = 'https://ridewithgps.com/find';
/** Como mucho, rutas por importación: cada una es una petición a Ride with GPS. */
export const MAX_RWGPS_IMPORT = 150;

export const RWGPS_UNAUTHORIZED = 'Ride with GPS no acepta tu clave o tu token. Vuelve a conectar la cuenta.';
const STATUS: Record<number, string> = {
  401: RWGPS_UNAUTHORIZED,
  403: 'La ruta no es visible para tu cuenta de Ride with GPS (privada, o falta el privacy_code en el enlace).',
  404: 'No existe en Ride with GPS.',
  429: 'Ride with GPS limita las peticiones: espera unos minutos y vuelve a probar.',
};
const statusError = (status: number) => new RwgpsError(STATUS[status] ?? `Ride with GPS respondió con el error ${status}.`);

const tokenSchema = z.object({ auth_token: z.object({ auth_token: z.string().min(8) }) });
const collectionSchema = z.object({
  collection: z.object({ name: z.string().nullish(), routes: z.array(z.object({ id: z.number().int().positive() })).nullish() }),
});

/**
 * Pide un token con el correo y la contraseña del usuario (POST /auth_tokens.json).
 * La contraseña solo viaja a Ride with GPS y nunca se guarda.
 */
export async function createRwgpsToken(apiKey: string, email: string, password: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!apiKey.trim() || !email.trim() || !password) throw new RwgpsError('Escribe la clave de API, el correo y la contraseña de Ride with GPS.');
  let response: Response;
  try {
    response = await fetchImpl(`${API}/auth_tokens.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-rwgps-api-key': apiKey.trim() },
      body: JSON.stringify({ user: { email: email.trim(), password } }),
    });
  } catch {
    throw new RwgpsError('No se pudo contactar con Ride with GPS. Revisa la conexión.');
  }
  if (response.status === 400 || response.status === 401) throw new RwgpsError('Ride with GPS no acepta esa clave de API, ese correo o esa contraseña.');
  if (!response.ok) throw statusError(response.status);
  const parsed = tokenSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new RwgpsError('Ride with GPS no ha devuelto un token válido.');
  return parsed.data.auth_token.auth_token;
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

async function getJson(path: string, credentials: RwgpsCredentials, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${API}${path}`, {
      headers: { 'x-rwgps-api-key': credentials.apiKey.trim(), 'x-rwgps-auth-token': credentials.authToken.trim() },
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new RwgpsError('No se pudo contactar con Ride with GPS. Revisa la conexión.');
  }
  if (!response.ok) throw statusError(response.status);
  return response.json().catch(() => null);
}

const withCode = (code?: string) => (code ? `?privacy_code=${encodeURIComponent(code)}` : '');

/** Ids de las rutas de una colección, o de la colección fijada si `id` es `pinned`. */
export async function fetchRwgpsCollection(
  id: string, credentials: RwgpsCredentials, privacyCode?: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal,
): Promise<{ name: string; routeIds: string[] }> {
  const path = id === 'pinned' ? '/collections/pinned.json' : `/collections/${encodeURIComponent(id)}.json${withCode(privacyCode)}`;
  const parsed = collectionSchema.safeParse(await getJson(path, credentials, fetchImpl, signal));
  if (!parsed.success) throw new RwgpsError('Ride with GPS devolvió una colección que no se entiende.');
  return { name: parsed.data.collection.name?.trim() || 'Colección', routeIds: (parsed.data.collection.routes ?? []).map((r) => String(r.id)) };
}

export type RwgpsImportResult = { routes: (RwgpsLibraryInput & { id: string })[]; failed: { ref: string; message: string }[] };

/**
 * Descarga por la API cada ruta enlazada y las de cada colección, una tras otra.
 * Una ruta que falla no detiene las demás; un 401 sí, porque las credenciales no valen.
 */
export async function fetchRwgpsRoutes(
  links: RwgpsLink[],
  credentials: RwgpsCredentials,
  opts: { fetch?: typeof fetch; signal?: AbortSignal; onProgress?: (p: { done: number; total: number }) => void } = {},
): Promise<RwgpsImportResult> {
  const fetchImpl = opts.fetch ?? fetch;
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
      const collection = await fetchRwgpsCollection(link.id, credentials, link.privacyCode, fetchImpl, opts.signal);
      collection.routeIds.forEach((id) => push(id));
    } catch (e) {
      if (opts.signal?.aborted || (e instanceof RwgpsError && e.message === RWGPS_UNAUTHORIZED)) throw e;
      failed.push({ ref: link.id === 'pinned' ? 'Colección fijada' : `Colección ${link.id}`, message: e instanceof Error ? e.message : 'No se pudo leer.' });
    }
  }
  for (const extra of queue.splice(MAX_RWGPS_IMPORT)) failed.push({ ref: `Ruta ${extra.id}`, message: `Se importan ${MAX_RWGPS_IMPORT} rutas por vez como máximo.` });
  const routes: RwgpsImportResult['routes'] = [];
  for (const [i, item] of queue.entries()) {
    opts.signal?.throwIfAborted();
    opts.onProgress?.({ done: i, total: queue.length });
    try {
      const json = await getJson(`/routes/${encodeURIComponent(item.id)}.json${withCode(item.privacyCode)}`, credentials, fetchImpl, opts.signal);
      const url = `https://ridewithgps.com/routes/${item.id}${withCode(item.privacyCode)}`;
      routes.push({ ...rwgpsRouteToLibraryInput(json, url), id: item.id });
    } catch (e) {
      if (opts.signal?.aborted || (e instanceof RwgpsError && e.message === RWGPS_UNAUTHORIZED)) throw e;
      failed.push({ ref: `Ruta ${item.id}`, message: e instanceof Error ? e.message : 'No se pudo leer.' });
    }
  }
  return { routes, failed };
}
