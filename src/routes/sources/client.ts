import { routeReferencesSchema, routeSearchSchema, RouteSourceError, type RouteReference, type RouteSearch } from './schema.ts';
import type { LatLng } from '../../domain/types.ts';
import { normalizeWaypointSearch, osmWaypointsSchema, type OsmWaypoint, type WaypointSearch } from './waypoints.ts';
import { mountainPassesSchema, normalizePassSearch, type MountainPass, type PassSearch } from './passes.ts';

/** Rutas conocidas en Rutas con IA: solo cuando la función `route-sources` esté desplegada y verificada. */
export const routeSourcesEnabled = () => import.meta.env.VITE_ROUTE_SOURCES_ENABLED === 'true';

// Compatible con supabase.functions, sin importar sesiones ni claves a este módulo.
export type RouteSourceInvoker = {
  invoke: (name: string, options: { body: (RouteSearch & { source: 'wikiloc' | 'osm' }) | (PassSearch & { source: 'osm'; kind: 'passes' }) | (WaypointSearch & { source: 'osm'; kind: 'waypoints' }); signal?: AbortSignal }) => PromiseLike<{ data: unknown; error: unknown }>;
};
/** El buscador recibe un punto cuantizado; el modelo nunca recibe estas coordenadas. */
export async function findMountainPasses(start: LatLng, functions: RouteSourceInvoker, signal?: AbortSignal): Promise<MountainPass[]> {
  signal?.throwIfAborted();
  const search = normalizePassSearch({ lat: start.lat, lon: start.lng, radiusM: 40_000 });
  const result = await functions.invoke('route-sources', { body: { ...search, source: 'osm', kind: 'passes' }, signal });
  signal?.throwIfAborted();
  if (result.error) throw new RouteSourceError('unavailable');
  const envelope = result.data as { data?: unknown } | null;
  const parsed = mountainPassesSchema.safeParse(envelope?.data);
  if (!parsed.success) throw new RouteSourceError('invalid_response');
  return parsed.data;
}
/** Puertos, cimas y pueblos de la zona; el punto viaja cuantizado y el radio redondeado a 5 km. */
export async function findWaypoints(start: LatLng, radiusM: number, functions: RouteSourceInvoker, signal?: AbortSignal): Promise<OsmWaypoint[]> {
  signal?.throwIfAborted();
  const search = normalizeWaypointSearch({ lat: start.lat, lon: start.lng, radiusM: Math.max(8_000, Math.min(35_000, Math.round(radiusM))) });
  const result = await functions.invoke('route-sources', { body: { ...search, source: 'osm', kind: 'waypoints' }, signal });
  signal?.throwIfAborted();
  if (result.error) throw new RouteSourceError('unavailable');
  const envelope = result.data as { data?: unknown } | null;
  const parsed = osmWaypointsSchema.safeParse(envelope?.data);
  if (!parsed.success) throw new RouteSourceError('invalid_response');
  return parsed.data;
}
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
