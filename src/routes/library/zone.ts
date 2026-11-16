import { haversineM } from '../../import/summary.ts';

/** Factor de carretera sin rutas suficientes: lo medido alrededor de Caldes (1,42-1,98, mediana ≈ 1,75). */
export const DEFAULT_ZONE_FACTOR = 1.7;
/** Con menos rutas circulares válidas que esto, el factor de la zona es el de por defecto. */
export const MIN_FACTOR_ROUTES = 5;
/** El factor de la zona se acota a este rango. */
export const ZONE_FACTOR_RANGE = { min: 1.2, max: 2.5 };
/** Un polígono con un perímetro menor (m) no da un factor fiable. */
export const MIN_FACTOR_PERIMETER_M = 1000;
/** Vértices del polígono con el que se mide el factor de una ruta. */
export const FACTOR_POLYGON_POINTS = 6;

type LatLng = { lat: number; lng: number };

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Puntos de la línea a las distancias pedidas (m desde el inicio, en orden creciente). */
function pointsAlong(line: LatLng[], targets: number[]): LatLng[] {
  const out: LatLng[] = [];
  let done = 0;
  let i = 1;
  for (const target of targets) {
    while (i < line.length) {
      const a = line[i - 1];
      const b = line[i];
      const seg = haversineM(a.lat, a.lng, b.lat, b.lng);
      if (done + seg >= target) {
        const f = seg === 0 ? 0 : (target - done) / seg;
        out.push({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f });
        break;
      }
      done += seg;
      i++;
    }
  }
  return out;
}

/**
 * Factor de carretera de una ruta: su distancia entre el perímetro del hexágono cerrado que forman
 * 6 puntos repartidos por distancia a lo largo de la línea. Con un perímetro menor de 1 km, null.
 */
export function polygonFactor(line: LatLng[], distanceM: number): number | null {
  if (line.length < 2) return null;
  let total = 0;
  for (let i = 1; i < line.length; i++) total += haversineM(line[i - 1].lat, line[i - 1].lng, line[i].lat, line[i].lng);
  const poly = pointsAlong(line, Array.from({ length: FACTOR_POLYGON_POINTS }, (_, k) => (total * k) / FACTOR_POLYGON_POINTS));
  let perimeter = 0;
  poly.forEach((p, k) => {
    const q = poly[(k + 1) % poly.length];
    perimeter += haversineM(p.lat, p.lng, q.lat, q.lng);
  });
  return perimeter < MIN_FACTOR_PERIMETER_M ? null : distanceM / perimeter;
}

/**
 * Factor de carretera de la zona: mediana de `polygonFactor` de las rutas circulares, acotada a
 * ZONE_FACTOR_RANGE. Con menos de MIN_FACTOR_ROUTES muestras, DEFAULT_ZONE_FACTOR.
 */
export function zoneFactor(
  routes: { line: LatLng[]; distanceM: number; loop: boolean }[],
): { factor: number; samples: number } {
  const factors = routes
    .filter((r) => r.loop)
    .map((r) => polygonFactor(r.line, r.distanceM))
    .filter((f): f is number => f !== null);
  if (factors.length < MIN_FACTOR_ROUTES) return { factor: DEFAULT_ZONE_FACTOR, samples: factors.length };
  const factor = Math.min(ZONE_FACTOR_RANGE.max, Math.max(ZONE_FACTOR_RANGE.min, median(factors)));
  return { factor, samples: factors.length };
}

/** Subida típica de la zona: mediana de m/km de las rutas con desnivel conocido; sin ninguna, null. */
export function typicalClimb(routes: { distanceM: number; elevGainM: number | null }[]): number | null {
  const rates = routes
    .filter((r): r is { distanceM: number; elevGainM: number } => r.elevGainM !== null && r.distanceM > 0)
    .map((r) => r.elevGainM / (r.distanceM / 1000));
  return rates.length === 0 ? null : median(rates);
}
