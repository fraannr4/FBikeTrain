import type { Coord3, LatLng } from '../domain/types';

/** Si el centro del recorrido queda a menos de esta fracción de su punto más lejano, la vuelta rodea el inicio. */
const AROUND_START_FRACTION = 0.25;

/**
 * Hacia qué lado del inicio va una vuelta, por el centro de su recorrido: 0 norte, 1 noreste...
 * 7 noroeste, o -1 si rodea el inicio. Sirve para nombrarla y para no proponer dos hacia el mismo lado.
 */
export function routeSide(coords: Coord3[], start: LatLng): number {
  const kx = Math.cos((start.lat * Math.PI) / 180);
  let sx = 0;
  let sy = 0;
  let far = 0;
  for (const [lng, lat] of coords) {
    const x = (lng - start.lng) * kx;
    const y = lat - start.lat;
    sx += x;
    sy += y;
    far = Math.max(far, Math.hypot(x, y));
  }
  const n = coords.length || 1;
  const cx = sx / n;
  const cy = sy / n;
  if (far === 0 || Math.hypot(cx, cy) < far * AROUND_START_FRACTION) return -1;
  const deg = ((Math.atan2(cx, cy) * 180) / Math.PI + 360) % 360;
  return Math.round(deg / 45) % 8;
}
