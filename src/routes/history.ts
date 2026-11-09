import { getTrack, listActivities } from '../db/repo';
import { buildVisitedCells } from '../metrics/grid';

/**
 * Celdas de 200 m por las que pasa el historial. Lee los tracks de uno en uno para no tenerlos
 * todos en memoria. Las celdas nunca salen del navegador.
 */
export async function loadVisitedCells(): Promise<Set<string>> {
  const cells = new Set<string>();
  for (const a of await listActivities()) {
    if (!a.hasTrack) continue;
    const track = await getTrack(a.id);
    if (track) for (const c of buildVisitedCells([track])) cells.add(c);
  }
  return cells;
}
