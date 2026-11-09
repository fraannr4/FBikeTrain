import type { RouteGroup, RouteSig, TrackPoint } from '../domain/types';

/** Lado de la celda de la rejilla con la que se compara el trazado (m). */
export const ROUTE_CELL_M = 200;
/** Dos salidas son la misma ruta si comparten al menos esta fracción de celdas (Jaccard). */
export const SAME_ROUTE_MIN_SIMILARITY = 0.6;
/** La salida más larga puede serlo como mucho esta fracción más que la corta para ser la misma ruta. */
export const SAME_ROUTE_MAX_DIST_DIFF = 0.2;

/** Metros por grado de latitud con los que se dibuja la rejilla. */
const M_PER_DEG_LAT = 111_320;

/**
 * Celda de la rejilla que contiene el punto, como `fila:columna`. La columna usa el coseno de la
 * latitud del centro de la fila, así que todas las celdas de una fila miden lo mismo.
 */
export function cellKey(lat: number, lng: number, sizeM = ROUTE_CELL_M): string {
  const row = Math.floor((lat * M_PER_DEG_LAT) / sizeM);
  const rowCenterLat = ((row + 0.5) * sizeM) / M_PER_DEG_LAT;
  const col = Math.floor((lng * M_PER_DEG_LAT * Math.cos((rowCenterLat * Math.PI) / 180)) / sizeM);
  return `${row}:${col}`;
}

/** Celdas por las que pasa el track, sin repetidos y en orden de paso. Sin GPS, ninguna. */
export function routeCells(points: TrackPoint[]): string[] {
  const cells = new Set<string>();
  for (const p of points) {
    if (p.lat !== undefined && p.lng !== undefined) cells.add(cellKey(p.lat, p.lng));
  }
  return [...cells];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const c of a) if (b.has(c)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Jaccard de los dos conjuntos de celdas; con dos conjuntos vacíos vale 0. */
export function routeSimilarity(a: string[], b: string[]): number {
  return jaccard(new Set(a), new Set(b));
}

function closeDistance(a: number, b: number): boolean {
  return Math.max(a, b) <= Math.min(a, b) * (1 + SAME_ROUTE_MAX_DIST_DIFF);
}

/**
 * Rutas repetidas. Voraz por fecha: cada salida entra en el primer grupo cuyo representante (su
 * primera salida) tiene una distancia parecida y comparte celdas suficientes; si no, abre grupo.
 * Solo devuelve los grupos de 2 o más salidas, de más a menos salidas.
 */
export function groupRoutes(sigs: RouteSig[]): RouteGroup[] {
  const sorted = [...sigs].sort(
    (a, b) => a.activityStart - b.activityStart || a.activityId.localeCompare(b.activityId),
  );
  const groups: { rep: RouteSig; repCells: Set<string>; activityIds: string[] }[] = [];
  for (const sig of sorted) {
    const cells = new Set(sig.cells);
    const group = groups.find(
      (g) =>
        closeDistance(g.rep.distanceM, sig.distanceM) &&
        jaccard(g.repCells, cells) >= SAME_ROUTE_MIN_SIMILARITY,
    );
    if (group) group.activityIds.push(sig.activityId);
    else groups.push({ rep: sig, repCells: cells, activityIds: [sig.activityId] });
  }
  return groups
    .filter((g) => g.activityIds.length >= 2)
    .sort((a, b) => b.activityIds.length - a.activityIds.length)
    .map((g) => ({ id: g.rep.activityId, activityIds: g.activityIds }));
}
