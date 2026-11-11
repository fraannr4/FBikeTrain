import type { ClimbEffort, LatLng, TrackPoint } from '../domain/types';
import { haversineM } from '../import/summary';
import type { MountainPass } from './sources/passes';

export type LocalPass = Omit<MountainPass, 'ele'> & { ele: number | null };
const gps = (p: TrackPoint | undefined): p is TrackPoint & LatLng => p?.lat !== undefined && p.lng !== undefined && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** Solo lee unos pocos tracks locales para confirmar cima y salida; nada de ello llega al modelo. */
export async function historyPasses(start: LatLng, climbs: ClimbEffort[], track: (id: string) => Promise<TrackPoint[] | undefined>, signal?: AbortSignal): Promise<LocalPass[]> {
  const selected = climbs.filter(c => {
    const d = haversineM(start.lat, start.lng, c.end.lat, c.end.lng);
    return d >= 15_000 && d <= 40_000;
  }).sort((a, b) => b.activityStart - a.activityStart);
  const found: LocalPass[] = [];
  const tracks = new Map<string, TrackPoint[]>();
  for (const climb of selected.slice(0, 12)) {
    signal?.throwIfAborted();
    if (found.length >= 6) break;
    if (found.some(p => haversineM(p.lat, p.lng, climb.end.lat, climb.end.lng) < 300)) continue;
    if (!tracks.has(climb.activityId)) tracks.set(climb.activityId, await track(climb.activityId) ?? []);
    const points = tracks.get(climb.activityId)!;
    const top = points[climb.endIdx];
    if (!gps(top)) continue;
    const before = points.slice(climb.startIdx, climb.endIdx).reverse().find(p => gps(p) && haversineM(p.lat, p.lng, top.lat, top.lng) >= 100);
    const after = points.slice(climb.endIdx + 1).find(p => gps(p) && haversineM(p.lat, p.lng, top.lat, top.lng) >= 100);
    if (!gps(before) || !gps(after)) continue;
    found.push({ id: `history-${found.length + 1}`, name: `Subida habitual ${found.length + 1}`, lat: top.lat, lng: top.lng,
      ele: top.ele !== undefined && Number.isFinite(top.ele) ? Math.round(top.ele) : null,
      distanceM: haversineM(start.lat, start.lng, top.lat, top.lng), approach: before, departure: after });
  }
  signal?.throwIfAborted();
  return found;
}
