import { routeReferencesSchema, routeSearchSchema, RouteSourceError, type RouteReference, type RouteSearch } from './schema';

/** Rutas conocidas en Rutas con IA: solo cuando la función `route-sources` esté desplegada y verificada. */
export const routeSourcesEnabled = () => import.meta.env.VITE_ROUTE_SOURCES_ENABLED === 'true';

// Compatible con supabase.functions, sin importar sesiones ni claves a este módulo.
export type RouteSourceInvoker = {
  invoke: (name: string, options: { body: RouteSearch & { source: 'wikiloc' | 'osm' }; signal?: AbortSignal }) => PromiseLike<{ data: unknown; error: unknown }>;
};
export async function findRouteReferences(input: RouteSearch, functions: RouteSourceInvoker, signal?: AbortSignal): Promise<RouteReference[]> {
  const search = routeSearchSchema.parse(input);
  for (const source of ['wikiloc', 'osm'] as const) {
    signal?.throwIfAborted();
    try {
      const result = await functions.invoke('route-sources', { body: { ...search, source }, signal });
      signal?.throwIfAborted();
      if (result.error) throw new RouteSourceError('unavailable');
      const envelope = result.data as { data?: unknown } | null;
      const routes = routeReferencesSchema.parse(envelope?.data);
      if (routes.some(route => route.source !== source)) throw new RouteSourceError('invalid_response');
      if (routes.length || source === 'osm') return routes;
    } catch {
      signal?.throwIfAborted();
      if (source === 'osm') throw new RouteSourceError('unavailable');
    }
  }
  return [];
}
