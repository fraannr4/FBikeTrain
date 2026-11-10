import { metres } from './overpass.ts';
import { routeSearchSchema, type RouteReference, type RouteSearch } from './schema.ts';

export function normalizeRouteSearch(input: RouteSearch): RouteSearch {
  const value = routeSearchSchema.parse(input);
  return { lat: Number(value.lat.toFixed(3)) || 0, lon: Number(value.lon.toFixed(3)) || 0,
    radiusM: Math.ceil(value.radiusM / 5000) * 5000 };
}

export const MAX_REFERENCE_POINTS = 2000;
/** Simplificación radial en metros, con tolerancia creciente y extremos por segmento. */
export function simplifyRouteReference(route: RouteReference): RouteReference {
  const geometry = route.geometry;
  if (!geometry || geometry.coordinates.reduce((n, line) => n + line.length, 0) <= MAX_REFERENCE_POINTS) return route;
  let toleranceM = 10;
  for (;;) {
    const coordinates = geometry.coordinates.map(line => {
      const kept = [line[0]];
      for (let i = 1; i < line.length - 1; i++) {
        if (metres(kept[kept.length - 1], line[i]) >= toleranceM) kept.push(line[i]);
      }
      kept.push(line[line.length - 1]);
      return kept;
    });
    if (coordinates.reduce((n, line) => n + line.length, 0) <= MAX_REFERENCE_POINTS) {
      return { ...route, geometry: { type: 'MultiLineString', coordinates } };
    }
    // La entrada validada permite hasta 500 segmentos: sus 1000 extremos siempre caben.
    toleranceM *= 2;
  }
}
