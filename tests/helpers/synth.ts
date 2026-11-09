import type { LatLng, TrackPoint } from '../../src/domain/types';
import { EARTH_RADIUS_M, haversineM } from '../../src/import/summary';

/** Separación entre puntos del track sintético (m). */
export const SYNTH_STEP_M = 15;
/** Origen del track sintético: sobre el mar, frente a la costa. */
export const SYNTH_ORIGIN = { lat: 41.0, lng: 2.5 };
export const SYNTH_START_ELE_M = 100;
export const SYNTH_DEFAULT_SPEED_MS = 5;
export const SYNTH_START_T = Date.UTC(2026, 0, 4, 8, 0, 0);

const M_PER_DEG_LAT = (EARTH_RADIUS_M * Math.PI) / 180;

export type SynthSegment = { lengthM: number; gradePct: number; speedMs?: number };

/**
 * Track recto hacia el norte desde SYNTH_ORIGIN, un punto cada 15 m (más el punto final),
 * con la altitud y el tiempo que marcan los tramos. Ruido del punto i: noiseM · sin(i · 1,7).
 */
export function synthClimbTrack(segments: SynthSegment[], opts: { noiseM?: number } = {}): TrackPoint[] {
  const noiseM = opts.noiseM ?? 0;
  const totalM = segments.reduce((sum, s) => sum + s.lengthM, 0);

  // Altitud (m) y segundos transcurridos a la distancia d.
  const at = (d: number): { ele: number; s: number } => {
    let ele = SYNTH_START_ELE_M;
    let s = 0;
    let from = 0;
    for (const seg of segments) {
      const part = Math.min(Math.max(d - from, 0), seg.lengthM);
      ele += (part * seg.gradePct) / 100;
      s += part / (seg.speedMs ?? SYNTH_DEFAULT_SPEED_MS);
      from += seg.lengthM;
    }
    return { ele, s };
  };

  const dists: number[] = [];
  for (let d = 0; d <= totalM; d += SYNTH_STEP_M) dists.push(d);
  if (dists[dists.length - 1] < totalM) dists.push(totalM);

  return dists.map((d, i) => {
    const { ele, s } = at(d);
    return {
      t: SYNTH_START_T + Math.round(s * 1000),
      lat: SYNTH_ORIGIN.lat + d / M_PER_DEG_LAT,
      lng: SYNTH_ORIGIN.lng,
      ele: ele + noiseM * Math.sin(i * 1.7),
    };
  });
}

/**
 * Track sobre la poligonal `vertices`, un punto cada 15 m como mucho (los vértices incluidos),
 * desplazado `offsetM` hacia el este y con altitud constante. `t` avanza a `speedMs`.
 */
export function synthPath(
  vertices: LatLng[],
  opts: { offsetM?: number; startTime?: number; speedMs?: number } = {},
): TrackPoint[] {
  const offsetM = opts.offsetM ?? 0;
  const startTime = opts.startTime ?? SYNTH_START_T;
  const speedMs = opts.speedMs ?? SYNTH_DEFAULT_SPEED_MS;
  const points: TrackPoint[] = [];
  let distM = 0;
  const push = (lat: number, lng: number) => {
    const shiftLng = offsetM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    points.push({ t: startTime + Math.round((distM / speedMs) * 1000), lat, lng: lng + shiftLng, ele: SYNTH_START_ELE_M });
  };
  vertices.forEach((v, k) => {
    const next = vertices[k + 1];
    if (!next) return push(v.lat, v.lng);
    const segM = haversineM(v.lat, v.lng, next.lat, next.lng);
    const steps = Math.max(1, Math.ceil(segM / SYNTH_STEP_M));
    for (let s = 0; s < steps; s++) {
      const f = s / steps;
      push(v.lat + (next.lat - v.lat) * f, v.lng + (next.lng - v.lng) * f);
      distM += segM / steps;
    }
  });
  return points;
}

/** GPX de ciclismo con los puntos dados, con `<ele>` y `<time>`. Los puntos sin GPS se omiten. */
export function toGpx(points: TrackPoint[], name = 'Salida sintetica'): string {
  const pts = points
    .filter((p) => p.lat !== undefined && p.lng !== undefined)
    .map(
      (p) =>
        `<trkpt lat="${p.lat}" lon="${p.lng}">${p.ele !== undefined ? `<ele>${p.ele}</ele>` : ''}<time>${new Date(p.t).toISOString()}</time></trkpt>`,
    )
    .join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="fixture sintetico" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <type>cycling</type>
    <trkseg>
      ${pts}
    </trkseg>
  </trk>
</gpx>
`;
}
