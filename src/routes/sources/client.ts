import { RouteSourceError } from './schema.ts';
import { libraryZoneSchema, librarySearchSchema, normalizeLibrarySearch, type LibrarySearch, type LibraryZone } from '../library/schema.ts';
import {
  catalogRequestSchema, catalogResponseSchema, detailRequestSchema, detailResponseSchema, normalizeCatalogRequest,
  type CatalogRequest, type LibraryCatalog, type LibraryDetail,
} from '../library/catalog.ts';

// Compatible con supabase.functions, sin importar sesiones ni claves a este módulo.
export type RouteSourceInvoker = {
  invoke: (name: string, options: { body: { source: 'library'; kind: string } & Record<string, unknown>; signal?: AbortSignal }) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** Llama a `route-sources` y devuelve `data` sin validar; los errores de la función pasan a `RouteSourceError`. */
async function invokeLibrary(kind: string, body: Record<string, unknown>, functions: RouteSourceInvoker, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const result = await functions.invoke('route-sources', { body: { source: 'library', kind, ...body }, signal });
  signal?.throwIfAborted();
  if (result.error) {
    // FunctionsHttpError lleva la respuesta en `context`: un 429 es la cuota o el turno del proveedor.
    const status = (result.error as { context?: { status?: unknown } }).context?.status;
    throw new RouteSourceError(status === 429 ? 'busy' : status === 404 ? 'not_found' : 'unavailable');
  }
  return (result.data as { data?: unknown } | null)?.data;
}

/**
 * Biblioteca común de la zona: cuadrículas, rutas candidatas y factor de carretera. El punto viaja a
 * 3 decimales; el servidor solo envía a Ride with GPS un centro redondeado a 0,05°.
 */
export async function findLibrary(search: LibrarySearch, functions: RouteSourceInvoker, signal?: AbortSignal): Promise<LibraryZone> {
  signal?.throwIfAborted();
  const body = librarySearchSchema.parse(normalizeLibrarySearch(search));
  const parsed = libraryZoneSchema.safeParse(await invokeLibrary('library', body, functions, signal));
  if (!parsed.success) throw new RouteSourceError('invalid_response');
  return parsed.data;
}

/** Catálogo de la biblioteca común cerca de un punto (a 3 decimales): rutas con miniatura, de la más cercana a la más lejana. */
export async function findLibraryCatalog(search: CatalogRequest, functions: RouteSourceInvoker, signal?: AbortSignal): Promise<LibraryCatalog> {
  signal?.throwIfAborted();
  const body = catalogRequestSchema.parse(normalizeCatalogRequest(search));
  const parsed = catalogResponseSchema.safeParse(await invokeLibrary('library-list', body, functions, signal));
  if (!parsed.success) throw new RouteSourceError('invalid_response');
  return parsed.data;
}

/** Una ruta de la biblioteca común con su línea completa. */
export async function findLibraryRoute(id: string, functions: RouteSourceInvoker, signal?: AbortSignal): Promise<LibraryDetail> {
  signal?.throwIfAborted();
  const body = detailRequestSchema.parse({ id });
  const parsed = detailResponseSchema.safeParse(await invokeLibrary('library-route', body, functions, signal));
  if (!parsed.success) throw new RouteSourceError('invalid_response');
  return parsed.data;
}
