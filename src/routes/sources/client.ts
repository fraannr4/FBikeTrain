import { RouteSourceError } from './schema.ts';
import { libraryZoneSchema, librarySearchSchema, normalizeLibrarySearch, type LibrarySearch, type LibraryZone } from '../library/schema.ts';

// Compatible con supabase.functions, sin importar sesiones ni claves a este módulo.
export type RouteSourceInvoker = {
  invoke: (name: string, options: { body: LibrarySearch & { source: 'library'; kind: 'library' }; signal?: AbortSignal }) => PromiseLike<{ data: unknown; error: unknown }>;
};
/**
 * Biblioteca común de la zona: cuadrículas, rutas candidatas y factor de carretera. El punto viaja a
 * 3 decimales; el servidor solo envía a Ride with GPS un centro redondeado a 0,05°.
 */
export async function findLibrary(search: LibrarySearch, functions: RouteSourceInvoker, signal?: AbortSignal): Promise<LibraryZone> {
  signal?.throwIfAborted();
  const body = librarySearchSchema.parse(normalizeLibrarySearch(search));
  const result = await functions.invoke('route-sources', { body: { source: 'library', kind: 'library', ...body }, signal });
  signal?.throwIfAborted();
  if (result.error) {
    // FunctionsHttpError lleva la respuesta en `context`: un 429 es la cuota o el turno del proveedor.
    const status = (result.error as { context?: { status?: unknown } }).context?.status;
    throw new RouteSourceError(status === 429 ? 'busy' : 'unavailable');
  }
  const parsed = libraryZoneSchema.safeParse((result.data as { data?: unknown } | null)?.data);
  if (!parsed.success) throw new RouteSourceError('invalid_response');
  return parsed.data;
}
