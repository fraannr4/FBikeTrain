import type { LinePoint } from '../../src/routes/library/cells';
import type { ReferenceRouteRow } from '../../src/routes/library/rows';

/**
 * Biblioteca común sintética alrededor de un inicio inventado (40,0 / −3,0). Nada sale de rutas
 * reales: los ID son ficticios y las vueltas son cuadrados trazados a mano.
 */
export const START = { lat: 40, lng: -3 };
const KM_LAT = 111.195;
const kmLng = (lat: number) => KM_LAT * Math.cos((lat * Math.PI) / 180);

/** Vuelta cuadrada de `km` de perímetro con la esquina de salida desplazada `northKm`/`eastKm`. */
export function squareRow(
  n: number,
  opts: { km: number; northKm?: number; eastKm?: number; elevGainM?: number | null; loop?: boolean },
): ReferenceRouteRow & { id: string } {
  const lat0 = START.lat + (opts.northKm ?? 0) / KM_LAT;
  const lng0 = START.lng + (opts.eastKm ?? 0) / kmLng(START.lat);
  const side = opts.km / 4;
  const dLat = side / KM_LAT;
  const dLng = side / kmLng(lat0);
  const corners: [number, number][] = [[lat0, lng0], [lat0 + dLat, lng0], [lat0 + dLat, lng0 + dLng], [lat0, lng0 + dLng], [lat0, lng0]];
  const loop = opts.loop ?? true;
  const used = loop ? corners : corners.slice(0, 4);
  const line: LinePoint[] = [];
  for (let i = 1; i < used.length; i++) {
    const [aLat, aLng] = used[i - 1];
    const [bLat, bLng] = used[i];
    for (let k = 0; k < 5; k++) line.push([aLng + ((bLng - aLng) * k) / 5, aLat + ((bLat - aLat) * k) / 5]);
  }
  const [lastLat, lastLng] = used[used.length - 1];
  line.push([lastLng, lastLat]);
  const lats = line.map(p => p[1]);
  const lngs = line.map(p => p[0]);
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    source: 'rwgps', source_id: String(900_000 + n), url: `https://ridewithgps.com/routes/${900_000 + n}`,
    name: `Vuelta sintética ${n}`, author: 'Autor sintético',
    distance_m: Math.round(opts.km * 1000), elev_gain_m: opts.elevGainM ?? null,
    start_lat: lat0, start_lng: lng0, min_lat: Math.min(...lats), max_lat: Math.max(...lats), min_lng: Math.min(...lngs), max_lng: Math.max(...lngs),
    line, loop, unpaved_pct: 0,
  };
}

/** Resultado de `find/search.json` con la forma real comprobada el 2026-11-16 (ID y lugares inventados). */
export function searchHit(id: number, over: Record<string, unknown> = {}) {
  return {
    type: 'route',
    route: {
      id, name: `Ruta sintética ${id}`, distance: 60_000, elevation_gain: 800, visibility: 0, is_trip: false,
      first_lat: 40.01, first_lng: -3.01, track_type: 'loop', unpaved_pct: 0, activity_types: ['cycling:road'],
      ...over,
    },
  };
}
export const searchJson = (hits: unknown[]) => ({ results: hits, results_count: 12_345 });

/** Detalle de la API v1 (`/api/v1/routes/{id}.json`) de una vuelta sintética pública. */
export function routeDetailJson(n: number) {
  const row = squareRow(n, { km: 60, elevGainM: 700 });
  return {
    route: {
      visibility: 'public', name: row.name, user: { name: 'Autor sintético' }, distance: 60_000, elevation_gain: 700, unpaved_pct: 0,
      track_points: row.line.map(([x, y]) => ({ x, y, e: 300 })),
    },
  };
}
