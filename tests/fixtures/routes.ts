import type { LatLng } from '../../src/domain/types';
import type { SteepSegment } from '../../src/routes/analyze';
import type { ProfilePoint } from '../../src/ui/profile';
import type { RouteCardData } from '../../src/ui/routes/RouteCard';

// Rutas sintéticas para las tarjetas. Todas salen del mar (lat 41,0 y lng 2,5): nunca un track real
// ni la dirección de «Casa». Cada una tiene su forma, para que se distingan de un vistazo.

const O = { lat: 41.0, lng: 2.5 };
const KM_LAT = 1 / 111.32;
const KM_LNG = 1 / (111.32 * Math.cos((O.lat * Math.PI) / 180));
const at = (xKm: number, yKm: number): LatLng => ({ lat: O.lat + yKm * KM_LAT, lng: O.lng + xKm * KM_LNG });

/** Lazo con cola: sales recto, das la vuelta y vuelves por el mismo tramo. */
export function loopWithTail(n = 400): LatLng[] {
  const out: LatLng[] = [];
  const tail = Math.round(n * 0.15);
  for (let i = 0; i < tail; i++) out.push(at(0, (i / tail) * 6));
  const loop = n - 2 * tail;
  for (let i = 0; i <= loop; i++) {
    const t = (i / loop) * Math.PI * 2;
    out.push(at(Math.sin(t) * 9 + Math.sin(2 * t) * 2, 6 + 7 - Math.cos(t) * 7 + Math.sin(3 * t) * 1.2));
  }
  for (let i = tail - 1; i >= 0; i--) out.push(at(0.25, (i / tail) * 6));
  return out;
}

/** Ida y vuelta por la costa: alargada, los dos sentidos un poco separados. */
export function outAndBack(n = 300): LatLng[] {
  const half = Math.floor(n / 2);
  const go = Array.from({ length: half }, (_, i) => at((i / half) * 34, Math.sin(i / 18) * 1.6));
  const back = go.map((p) => ({ lat: p.lat - 0.25 * KM_LAT, lng: p.lng })).reverse();
  return [...go, ...back];
}

/** Ocho: dos lazos que se cruzan en la salida. */
export function figureEight(n = 360): LatLng[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return at(Math.sin(t) * 12, Math.sin(2 * t) * 5);
  });
}

/** Perfil de `km` km con subidas gaussianas (centro en km, anchura en km, altura en m). */
export function profileOf(km: number, climbs: [number, number, number][], base = 120): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (let d = 0; d <= km * 1000; d += 200) {
    const x = d / 1000;
    let ele = base;
    for (const [c, w, h] of climbs) ele += h * Math.exp(-(((x - c) / w) ** 2));
    out.push({ dM: d, ele: Math.round(ele) });
  }
  return out;
}

const steep = (...s: [number, number, number][]): SteepSegment[] => s.map(([fromM, toM, cls]) => ({ fromM, toM, cls }));

export const bestRoute: RouteCardData = {
  id: 'r-1',
  name: 'Lazo del faro por la cala',
  distanceM: 92_400,
  elevGainM: 1540,
  estTimeS: 3 * 3600 + 23 * 60,
  difficulty: 'Media',
  newPct: 74,
  shape: loopWithTail(),
  profile: profileOf(92.4, [[14, 2.5, 180], [46, 4, 820], [70, 2.5, 260]]),
  steep: steep([0, 30_000, 1], [30_000, 46_000, 3], [46_000, 60_000, -2], [60_000, 92_400, 1]),
  kind: 'circular',
};

export const coastRoute: RouteCardData = {
  id: 'r-2',
  name: 'Costa larga hasta la boya',
  distanceM: 68_000,
  elevGainM: 410,
  estTimeS: 2 * 3600 + 21 * 60,
  difficulty: 'Suave',
  newPct: 0,
  shape: outAndBack(),
  profile: profileOf(68, [[17, 3, 90], [51, 3, 90]], 20),
  steep: steep([0, 68_000, 1]),
  kind: 'ida-y-vuelta',
};

export const eightRoute: RouteCardData = {
  id: 'r-3',
  name: 'Ocho de los dos puertos',
  distanceM: 42_000,
  elevGainM: 640,
  estTimeS: null,
  difficulty: 'Dura',
  newPct: 22,
  shape: figureEight(),
  profile: profileOf(42, [[10, 1.6, 300], [30, 1.6, 300]]),
  steep: steep([0, 8000, 1], [8000, 10_000, 3], [10_000, 42_000, 0]),
  why: 'Sube dos veces en 42 km: es más corta que tu salida media, pero con rampas que te cuestan. Encaja si quieres trabajar la fuerza sin pasar de dos horas.',
};

/** Un perfil sin datos: la tarjeta sigue entera, sin NaN. */
export const bareRoute: RouteCardData = {
  id: 'r-4',
  name: 'Sin perfil',
  distanceM: 30_000,
  elevGainM: 0,
  estTimeS: null,
  difficulty: null,
  newPct: null,
  shape: [],
  profile: [],
  steep: [],
};

export const sampleRoutes: RouteCardData[] = [bestRoute, coastRoute, eightRoute];
