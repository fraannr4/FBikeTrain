import { z } from 'zod';
import { rwgpsReferenceRow, type ReferenceRouteRow } from '../library/rows.ts';

/**
 * Sincronización de la cuenta común de Ride with GPS hacia la biblioteca común (`reference_routes`,
 * `source = 'rwgps'`): sus colecciones y sus rutas, con el trazado completo y la altura. Portable:
 * solo zod y módulos locales, y `get` llega inyectado para probarlo sin red. Las rutas de la API las
 * construye este módulo; nadie de fuera elige ninguna.
 */

export type ReferenceSyncDependencies = {
  get: (path: string, signal: AbortSignal) => Promise<{ status: number; json: unknown }>;
  /** `imported_at` (ms) de los `source_id` que ya están en la biblioteca. */
  importedAt: (sourceIds: string[]) => Promise<Map<string, number>>;
  upsert: (row: ReferenceRouteRow) => Promise<void>;
  remove: (sourceId: string) => Promise<void>;
  now?: () => number;
};

export type RwgpsSyncResult = { fetched: number; indexed: number; removed: number; error: null | 'provider_busy' | 'unavailable' | 'provider_error' | 'timeout' };

export const MAX_SYNC_ROUTE_FETCHES = 80;
const PAGE_SIZE = 200;
const MAX_LIST_PAGES = 10;
const MAX_COLLECTIONS = 100;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

const routeId = z.number().int().positive().max(999_999_999_999);
const summary = z.object({ id: routeId, visibility: z.string().nullish() });
const collectionsPage = z.object({ collections: z.array(z.object({ id: routeId })) });
const collectionDetail = z.object({ collection: z.object({ routes: z.array(summary).nullish() }) });
const routesPage = z.object({ routes: z.array(summary), meta: z.object({ pagination: z.object({ next_page_url: z.string().nullish() }) }).nullish() });

const listPath = (kind: 'routes' | 'collections', page: number) => `/api/v1/${kind}.json?page=${page}&page_size=${PAGE_SIZE}`;

type SyncError = Exclude<RwgpsSyncResult['error'], null>;

class SyncStop extends Error {
  constructor(readonly code: SyncError) { super(code); }
}

function statusError(status: number): SyncError {
  if (status === 429) return 'provider_busy';
  if (status === 401) return 'unavailable';
  return 'provider_error';
}

function stopCode(err: unknown, signal: AbortSignal): SyncError {
  if (err instanceof SyncStop) return err.code;
  if (signal.aborted) return 'timeout';
  return 'provider_error';
}

/** Ids públicos (o sin visibilidad en el resumen) de las colecciones y las rutas de la cuenta común. */
async function listRouteIds(read: (path: string) => Promise<unknown>): Promise<number[]> {
  const ids = new Set<number>();
  const add = (routes: z.infer<typeof summary>[]) => { for (const r of routes) if (!r.visibility || r.visibility === 'public') ids.add(r.id); };
  const collections: number[] = [];
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const parsed = collectionsPage.safeParse(await read(listPath('collections', page)));
    if (!parsed.success) throw new SyncStop('provider_error');
    collections.push(...parsed.data.collections.map(c => c.id));
    if (parsed.data.collections.length < PAGE_SIZE) break;
  }
  for (const id of collections.slice(0, MAX_COLLECTIONS)) {
    const parsed = collectionDetail.safeParse(await read(`/api/v1/collections/${id}.json`));
    if (parsed.success) add(parsed.data.collection.routes ?? []);
  }
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const parsed = routesPage.safeParse(await read(listPath('routes', page)));
    if (!parsed.success) throw new SyncStop('provider_error');
    add(parsed.data.routes);
    if (!parsed.data.meta?.pagination.next_page_url || parsed.data.routes.length === 0) break;
  }
  return [...ids];
}

/** Una pasada: como mucho 80 rutas nuevas o importadas hace más de 30 días. Nunca lanza; devuelve un código. */
export async function syncReferenceRoutes(deps: ReferenceSyncDependencies, signal: AbortSignal): Promise<RwgpsSyncResult> {
  const result: RwgpsSyncResult = { fetched: 0, indexed: 0, removed: 0, error: null };
  const now = (deps.now ?? Date.now)();
  /** 200 → cuerpo; 403/404 → null; el resto para la pasada. */
  const read = async (path: string): Promise<unknown> => {
    if (signal.aborted) throw new SyncStop('timeout');
    const { status, json } = await deps.get(path, signal);
    if (status === 200) return json;
    if (status === 403 || status === 404) return null;
    throw new SyncStop(statusError(status));
  };
  try {
    const ids = (await listRouteIds(read)).map(String);
    const known = await deps.importedAt(ids);
    const due = ids.filter(id => !known.has(id) || now - known.get(id)! > REFRESH_MS)
      .sort((a, b) => (known.get(a) ?? 0) - (known.get(b) ?? 0))
      .slice(0, MAX_SYNC_ROUTE_FETCHES);
    for (const id of due) {
      const json = await read(`/api/v1/routes/${id}.json`);
      result.fetched++;
      const row = rwgpsReferenceRow(Number(id), json);
      if (row) { await deps.upsert(row); result.indexed++; }
      else if (known.has(id)) { await deps.remove(id); result.removed++; }
    }
  } catch (err) {
    result.error = stopCode(err, signal);
  }
  return result;
}
