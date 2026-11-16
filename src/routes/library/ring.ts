import { EARTH_RADIUS_M, haversineM } from '../../import/summary.ts';
import type { HeatCellLite } from './schema.ts';

/**
 * Anillos sobre el mapa de calor: un polígono que sale del inicio, pasa por k celdas populares y
 * vuelve. El radio sale del factor de carretera de la zona para que el polígono, por ese factor,
 * mida los km pedidos. Las carreteras las pone ORS después; aquí solo se eligen los puntos de paso.
 */

type LatLng = { lat: number; lng: number };

export type Ring = { axisDeg: number; k: number; radiusM: number; waypoints: HeatCellLite[]; estimateKm: number; popularity: number; climbMPerKm: number | null };
export type RingOptions = { distanceKm: number; factor: number; elevGainM: number | null; sparse: boolean; broad: boolean };

/** Ninguna celda elegida a menos de esto del inicio (m). */
const MIN_START_GAP_M = 1500;
/** Ni a menos de esta fracción del radio de otra ya elegida. */
const MIN_VERTEX_GAP = 0.4;
/** Ventana de búsqueda alrededor de cada vértice ideal, en fracción del radio. */
const WINDOW = { normal: 0.35, broad: 0.5 };
/** Con una estimación más lejos que esto de lo pedido, se recalcula el radio una vez… */
const RESIZE_ABOVE = 0.05;
/** …y el anillo solo vale si queda dentro de esto. */
const ACCEPT_WITHIN = 0.12;

const NORMAL = { axes: [0, 45, 90, 135, 180, 225, 270, 315], ks: [5] };
const BROAD = { axes: [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5], ks: [4, 6] };

const gap = (a: LatLng, b: LatLng) => haversineM(a.lat, a.lng, b.lat, b.lng);
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Punto a `distanceM` de `p` con rumbo `bearingDeg` (esfera de `EARTH_RADIUS_M`, la de `haversineM`). */
function destination(p: LatLng, bearingDeg: number, distanceM: number): LatLng {
  const d = distanceM / EARTH_RADIUS_M;
  const b = rad(bearingDeg);
  const lat1 = rad(p.lat);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 = rad(p.lng) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

/** Radio del polígono regular de k+1 vértices (con el inicio) cuyo perímetro por `factor` da `distanceKm`. */
export function ringRadiusM(distanceKm: number, factor: number, k: number): number {
  return (distanceKm * 1000) / (factor * (k + 1) * 2 * Math.sin(Math.PI / (k + 1)));
}

/** Círculo que pasa por el inicio con el centro a `radiusM` hacia `axisDeg`; k vértices repartidos, en orden de paso. */
export function idealVertices(start: LatLng, axisDeg: number, radiusM: number, k: number): LatLng[] {
  const centre = destination(start, axisDeg, radiusM);
  return Array.from({ length: k }, (_, j) => destination(centre, axisDeg + 180 + ((j + 1) * 360) / (k + 1), radiusM));
}

/** Perímetro del polígono cerrado: inicio → … → inicio. */
export function loopPerimeterM(points: LatLng[]): number {
  let m = 0;
  points.forEach((p, i) => { m += gap(p, points[(i + 1) % points.length]); });
  return m;
}

function climbFit(climb: number | null, wanted: number): number {
  return climb === null ? 1 : Math.abs(climb - wanted) / Math.max(wanted, 1);
}

function meanClimb(cells: HeatCellLite[]): number | null {
  const known = cells.map(c => c.climbMPerKm).filter((c): c is number => c !== null);
  return known.length === 0 ? null : known.reduce((s, c) => s + c, 0) / known.length;
}

/** Celda de cada ventana con más `log(1 + routes)` menos, con desnivel pedido, el desajuste de subida. */
function pickVertices(start: LatLng, cells: HeatCellLite[], axisDeg: number, k: number, radiusM: number, opts: RingOptions): HeatCellLite[] | null {
  const window = (opts.broad ? WINDOW.broad : WINDOW.normal) * radiusM;
  const wanted = opts.elevGainM === null ? null : opts.elevGainM / opts.distanceKm;
  const chosen: HeatCellLite[] = [];
  const dLat = (window / EARTH_RADIUS_M) * (180 / Math.PI);
  for (const ideal of idealVertices(start, axisDeg, radiusM, k)) {
    const dLng = dLat / Math.cos(rad(ideal.lat));
    let best: HeatCellLite | null = null;
    let bestScore = -Infinity;
    for (const c of cells) {
      // Descarte barato por la caja de la ventana antes de medir la distancia.
      if (Math.abs(c.lat - ideal.lat) > dLat || Math.abs(c.lng - ideal.lng) > dLng) continue;
      if (gap(c, ideal) > window || gap(c, start) < MIN_START_GAP_M) continue;
      if (chosen.some(o => gap(o, c) < MIN_VERTEX_GAP * radiusM)) continue;
      const score = Math.log(1 + c.routes) - (wanted === null ? 0 : climbFit(c.climbMPerKm, wanted));
      if (score > bestScore) { best = c; bestScore = score; }
    }
    if (!best) return null;
    chosen.push(best);
  }
  return chosen;
}

/** Anillo de k puntos de paso sobre las celdas populares; `null` si a algún vértice no le queda celda o no cuadra la longitud. */
export function buildRing(start: LatLng, cells: HeatCellLite[], axisDeg: number, k: number, opts: RingOptions): Ring | null {
  const minRoutes = opts.sparse || opts.broad ? 1 : 2;
  const usable = cells.filter(c => c.routes >= minRoutes);
  const targetM = opts.distanceKm * 1000;
  const estimate = (wps: HeatCellLite[]) => opts.factor * loopPerimeterM([start, ...wps]);

  let radiusM = ringRadiusM(opts.distanceKm, opts.factor, k);
  let waypoints = pickVertices(start, usable, axisDeg, k, radiusM, opts);
  if (!waypoints) return null;
  let estimateM = estimate(waypoints);
  if (Math.abs(estimateM - targetM) / targetM > RESIZE_ABOVE) {
    radiusM *= targetM / estimateM;
    waypoints = pickVertices(start, usable, axisDeg, k, radiusM, opts);
    if (!waypoints) return null;
    estimateM = estimate(waypoints);
  }
  if (Math.abs(estimateM - targetM) / targetM > ACCEPT_WITHIN) return null;
  return {
    axisDeg, k, radiusM, waypoints, estimateKm: estimateM / 1000,
    popularity: waypoints.reduce((s, c) => s + Math.log(1 + c.routes), 0),
    climbMPerKm: meanClimb(waypoints),
  };
}

/**
 * Anillos de la pasada normal (8 ejes cada 45°, k = 5) o de la amplia (ejes desplazados 22,5°, k 4 y 6),
 * sin repetir conjunto de celdas. Con desnivel, primero los de subida media más próxima a la pedida;
 * después, y sin desnivel, los más populares.
 */
export function candidateRings(start: LatLng, cells: HeatCellLite[], opts: RingOptions): Ring[] {
  const { axes, ks } = opts.broad ? BROAD : NORMAL;
  const seen = new Set<string>();
  const rings: Ring[] = [];
  for (const k of ks) {
    for (const axis of axes) {
      const ring = buildRing(start, cells, axis, k, opts);
      if (!ring) continue;
      const key = ring.waypoints.map(c => `${c.lat},${c.lng}`).sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      rings.push(ring);
    }
  }
  const wanted = opts.elevGainM === null ? null : opts.elevGainM / opts.distanceKm;
  return rings.sort((a, b) =>
    (wanted === null ? 0 : climbFit(a.climbMPerKm, wanted) - climbFit(b.climbMPerKm, wanted)) || b.popularity - a.popularity);
}
