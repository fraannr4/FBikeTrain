import type { ClimbEffort, LatLng, TrackPoint } from '../domain/types';
import { getTrack, listActivities } from '../db/repo';
import { haversineM } from '../import/summary';
import { buildCellCounts, type CellCount } from '../metrics/grid';
import { historyPasses } from './historyPasses';

export type HistoryWaypoint = { id: string; kind: 'habitual'; name: string; lat: number; lng: number; ele: number | null; distanceM: number; approach?: LatLng; departure?: LatLng };

/** Salidas distintas que deben pisar una celda para llamarla tramo habitual. */
export const MIN_REPEATS = 3;
/** Separación mínima entre tramos habituales y entre estos y las subidas (m). */
export const HABITUAL_SPACING_M = 2_000;
const MAX_CLIMBS = 6;
const MAX_STRETCHES = 6;

type Deps = {
  climbs: ClimbEffort[];
  listTracks?: () => AsyncIterable<TrackPoint[]>;
  track?: (id: string) => Promise<TrackPoint[] | undefined>;
  signal?: AbortSignal;
};

async function* storedTracks(): AsyncIterable<TrackPoint[]> {
  for (const a of await listActivities()) {
    if (!a.hasTrack) continue;
    const track = await getTrack(a.id);
    if (track) yield track;
  }
}

/** Cuenta las celdas leyendo los tracks de uno en uno, sin tenerlos todos en memoria. */
async function countCells(tracks: AsyncIterable<TrackPoint[]>, signal?: AbortSignal): Promise<Map<string, CellCount>> {
  const total = new Map<string, CellCount>();
  for await (const track of tracks) {
    for (const [key, cell] of buildCellCounts([track])) {
      const seen = total.get(key);
      if (seen) seen.count += cell.count;
      else total.set(key, { ...cell });
    }
    signal?.throwIfAborted();
  }
  return total;
}

/**
 * Puntos de paso del propio historial: subidas que ya has hecho y tramos por los que pasas a
 * menudo. Todo se calcula en local; nada de esto sale del navegador.
 */
export async function historyWaypoints(start: LatLng, band: { minM: number; maxM: number }, deps: Deps): Promise<HistoryWaypoint[]> {
  const { signal } = deps;
  signal?.throwIfAborted();
  const inBand = (m: number) => m >= band.minM && m <= band.maxM;
  const track = deps.track ?? getTrack;

  // Con la banda de la vuelta, no con los 15-40 km de los puertos: una vuelta corta tiene sus subidas más cerca.
  const passes = await historyPasses(start, deps.climbs, track, signal, band);
  const out: HistoryWaypoint[] = passes
    .filter((p) => inBand(p.distanceM))
    .slice(0, MAX_CLIMBS)
    .map((p, i) => ({ id: `hist-climb-${i + 1}`, kind: 'habitual', name: `Subida habitual ${i + 1}`, lat: p.lat, lng: p.lng, ele: p.ele, distanceM: p.distanceM, approach: p.approach, departure: p.departure }));

  const counts = await countCells((deps.listTracks ?? storedTracks)(), signal);
  const candidates = [...counts.values()]
    .filter((c) => c.count >= MIN_REPEATS)
    .map((c) => ({ ...c, distanceM: haversineM(start.lat, start.lng, c.at.lat, c.at.lng) }))
    .filter((c) => inBand(c.distanceM))
    .sort((a, b) => b.count - a.count);

  const taken: LatLng[] = out.map((w) => ({ lat: w.lat, lng: w.lng }));
  let stretches = 0;
  for (const c of candidates) {
    if (stretches >= MAX_STRETCHES) break;
    if (taken.some((t) => haversineM(t.lat, t.lng, c.at.lat, c.at.lng) < HABITUAL_SPACING_M)) continue;
    stretches++;
    taken.push(c.at);
    out.push({ id: `hist-cell-${stretches}`, kind: 'habitual', name: `Tramo habitual ${stretches}`, lat: c.at.lat, lng: c.at.lng, ele: null, distanceM: c.distanceM });
  }
  return out;
}
