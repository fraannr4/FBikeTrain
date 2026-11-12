import { ParseError } from '../domain/types';
import { parseReferenceRoute, RouteLibraryError, type ParsedReferenceRoute } from '../routes/library';
import { findActivitiesCsv, type ArchiveEntries } from './stravaArchive';

/**
 * Rutas planificadas de la carpeta `routes/` de la exportación de Strava.
 * Supuestos (docs/superpowers/plans/2026-11-12-strava-routes.md): un GPX por ruta con nombres
 * correlativos (`routes/1.gpx`), así que el nombre del fichero no identifica la ruta entre exportaciones.
 */
export type ArchiveRouteItem =
  | { ok: true; route: ParsedReferenceRoute; ref: string; file: string }
  | { ok: false; file: string; reason: string }
  | { ok: false; notCycling: true; file: string };

/** Deportes que no son de bici en `<type>`. Un tipo ausente o numérico cuenta como bici, para no perder rutas. */
const NOT_CYCLING = /run|walk|hik|foot|trail|swim|ski/i;
const ROUTE_FILE = /\.(gpx|tcx)$/i;

/** Huella de la geometría: puntos, inicio, final (5 decimales, ~1 m) y distancia al metro. */
export function stravaRouteRef(route: Pick<ParsedReferenceRoute, 'points' | 'summary'>): string {
  const at = (i: number) => `${route.points[i].lat.toFixed(5)},${route.points[i].lng.toFixed(5)}`;
  return `${route.summary.pointCount}|${at(0)}|${at(route.points.length - 1)}|${Math.round(route.summary.distanceM)}`;
}

/** Primer `<type>` del track, con una expresión regular para no analizar el XML dos veces. */
function trackType(xml: string): string | undefined {
  return /<trk\b[\s\S]*?<type>\s*([^<]*?)\s*<\/type>/i.exec(xml)?.[1];
}

/**
 * Lee las rutas de `routes/`, junto a `activities.csv` (o en la raíz). Cada fichero se lee al llegar
 * su turno; uno que falla se anota y se sigue con los demás. Ignora ocultos y `__MACOSX/`.
 */
export async function* readArchiveRoutes(entries: ArchiveEntries): AsyncGenerator<ArchiveRouteItem> {
  const csv = findActivitiesCsv(entries.keys());
  const folder = (csv ? csv.slice(0, -'activities.csv'.length) : '') + 'routes/';
  const files = [...entries.keys()].filter((p) => p.startsWith(folder) && !p.split('/').pop()!.startsWith('.'));

  for (const file of files) {
    if (!ROUTE_FILE.test(file)) {
      yield { ok: false, file, reason: 'formato de ruta no soportado' };
      continue;
    }
    try {
      const xml = new TextDecoder().decode(await entries.get(file)!());
      const type = trackType(xml);
      if (type && NOT_CYCLING.test(type)) {
        yield { ok: false, notCycling: true, file };
        continue;
      }
      const route = parseReferenceRoute(xml, file.split('/').pop()!);
      yield { ok: true, route, ref: stravaRouteRef(route), file };
    } catch (e) {
      const reason = e instanceof RouteLibraryError || e instanceof ParseError ? e.message : 'El fichero no se ha podido leer.';
      yield { ok: false, file, reason };
    }
  }
}
