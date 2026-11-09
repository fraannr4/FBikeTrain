import type { LatLng } from '../../domain/types';

type Pt = { x: number; y: number };

/** Distancia de `p` al segmento a-b. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Douglas-Peucker iterativo (sin recursión: un track de 30.000 puntos no desborda la pila). */
export function simplify(pts: Pt[], tolerance: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let farD = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i], pts[a], pts[b]);
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/**
 * Trazado SVG de la ruta en una caja de `w` × `h` con margen `pad`: proyección equirectangular
 * (x = lng · cos(latitud media), y = −lat), centrada y sin deformar, y simplificada con Douglas-Peucker
 * en píxeles de la caja (tolerancia max(0,45, min(w, h) / 150)). La misma geometría que el mapa.
 * Sin puntos devuelve `d` vacío; con uno, un punto en el centro.
 */
export function shapePath(points: LatLng[], w: number, h: number, pad: number): { d: string; start: Pt } {
  const center = { x: w / 2, y: h / 2 };
  const ok = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (ok.length === 0) return { d: '', start: center };

  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of ok) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const raw = ok.map((p) => ({ x: p.lng * k, y: -p.lat }));

  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of raw) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  const spanX = x1 - x0;
  const spanY = y1 - y0;
  const span = Math.max(spanX / Math.max(1e-9, w - 2 * pad), spanY / Math.max(1e-9, h - 2 * pad));
  const s = span > 0 ? 1 / span : 0;
  const ox = center.x - ((x0 + x1) / 2) * s;
  const oy = center.y - ((y0 + y1) / 2) * s;
  const box = raw.map((p) => ({ x: p.x * s + ox, y: p.y * s + oy }));

  const simple = simplify(box, Math.max(0.45, Math.min(w, h) / 150));
  const d = simple.map((p, i) => `${i ? 'L' : 'M'}${f1(p.x)} ${f1(p.y)}`).join('');
  return { d, start: box[0] };
}
