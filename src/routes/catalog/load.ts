import type { LatLng } from '../../domain/types';
import { saveCatalogRoutes, type CatalogRouteInput, type ReferenceRoute } from '../library';
import type { OrsAccess } from '../ors';
import { fetchRoadPath } from '../roadPath';
import { buildPassQuery, parsePasses, type MountainPass } from '../sources/passes';
import { withDemElevation } from './dem';
import { buildCatalogQuery, fetchOverpass, OSM_ATTRIBUTION, parseCatalog, roundedCentre } from './osm';

/** Subidas a puertos que se calculan con ORS: una consulta cada una. */
export const MAX_PASS_ROUTES = 5;
/** Puertos entre 15 km (mínimo de `parsePasses`) y esto. */
const PASS_RADIUS_M = 30_000;

export type CatalogProgress =
  | { step: 'osm' }
  | { step: 'elevation'; done: number; total: number }
  | { step: 'passes'; done: number; total: number };
export type CatalogLoadResult = { osm: number; passes: number; withoutElevation: number; saved: ReferenceRoute[] };
export type CatalogDeps = {
  ors: OrsAccess | null;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  onProgress?: (p: CatalogProgress) => void;
  road?: typeof fetchRoadPath;
};

/** Circuito inicio → vertiente de subida → puerto → vertiente de bajada → inicio, calculado por ORS con altitud. */
async function passRoute(start: LatLng, pass: MountainPass, deps: CatalogDeps): Promise<CatalogRouteInput | null> {
  if (!deps.ors) return null;
  const top = { lat: pass.lat, lng: pass.lng };
  const waypoints = [start, ...(pass.approach ? [pass.approach] : []), top, ...(pass.departure ? [pass.departure] : []), start];
  const points = await (deps.road ?? fetchRoadPath)(deps.ors, waypoints, deps.signal, deps.fetch);
  if (points.length < 2) return null;
  const node = pass.id.replace('osm-pass-', '');
  return {
    name: `Subida a ${pass.name} (${Math.round(pass.ele)} m)`,
    points,
    sourceUrl: `https://www.openstreetmap.org/node/${node}`,
    author: `${OSM_ATTRIBUTION}; trazado de openrouteservice`,
    catalog: { kind: 'puerto', ref: pass.id, tipo: 'puerto' },
  };
}

/**
 * Precarga del catálogo desde la app: rutas ciclistas de OpenStreetMap con altitud estimada y
 * subidas a los puertos cercanos. Vuelve a lanzarla sustituye las mismas rutas, sin duplicar.
 * Un fallo de altitud o de un puerto no detiene el resto.
 */
export async function loadOsmCatalog(start: LatLng, deps: CatalogDeps): Promise<CatalogLoadResult> {
  const fetchImpl = deps.fetch ?? fetch;
  deps.onProgress?.({ step: 'osm' });
  const routes = parseCatalog(await fetchOverpass(buildCatalogQuery(start), deps.signal, fetchImpl), start);
  const inputs: CatalogRouteInput[] = [];
  let withoutElevation = 0;
  for (const [i, route] of routes.entries()) {
    deps.signal?.throwIfAborted();
    deps.onProgress?.({ step: 'elevation', done: i, total: routes.length });
    let points: CatalogRouteInput['points'] = route.points;
    let elevation: 'dem' | undefined;
    try {
      points = await withDemElevation(route.points, deps.signal, fetchImpl);
      elevation = 'dem';
    } catch (e) {
      if (deps.signal?.aborted) throw e;
      withoutElevation++;
    }
    inputs.push({ name: route.name, points, sourceUrl: route.url, author: route.author, catalog: { kind: 'osm', ref: route.ref, tipo: route.tipo }, ...(elevation ? { elevation } : {}) });
  }

  let passCount = 0;
  if (deps.ors) {
    const c = roundedCentre(start);
    const search = { lat: c.lat, lon: c.lng, radiusM: PASS_RADIUS_M };
    let passes: MountainPass[] = [];
    try {
      passes = parsePasses(await fetchOverpass(buildPassQuery(search), deps.signal, fetchImpl), search).slice(0, MAX_PASS_ROUTES);
    } catch (e) {
      if (deps.signal?.aborted) throw e;
    }
    for (const [i, pass] of passes.entries()) {
      deps.signal?.throwIfAborted();
      deps.onProgress?.({ step: 'passes', done: i, total: passes.length });
      try {
        const input = await passRoute(start, pass, deps);
        if (input) {
          inputs.push(input);
          passCount++;
        }
      } catch (e) {
        if (deps.signal?.aborted) throw e;
      }
    }
  }
  const saved = await saveCatalogRoutes(inputs);
  return { osm: routes.length, passes: passCount, withoutElevation, saved };
}
