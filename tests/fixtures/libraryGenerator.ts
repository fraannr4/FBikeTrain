import type { LatLng } from '../../src/domain/types';
import { haversineM } from '../../src/import/summary';
import type { RoutePoint } from '../../src/routes/library';
import type { HeatCellLite, LibraryFill, LibraryRoute, LibraryZone } from '../../src/routes/library/schema';
import type { OrsError, OrsFeature } from '../../src/routes/ors';
import type { SharedOrsAccess } from '../../src/routes/orsProxy';
import { START } from './libraryZone';

/**
 * ORS y biblioteca falsos para el generador. Todo es sintético alrededor del inicio inventado de
 * `libraryZone.ts` (40,0 / −3,0): rejillas de celdas, vueltas trazadas a mano y respuestas de ORS
 * con la forma documentada (`[lng, lat, ele]`, extras por índice y resumen).
 */
export { START };

const M_LAT = (Math.PI / 180) * 6_371_000;
const mLng = (lat: number) => M_LAT * Math.cos((lat * Math.PI) / 180);

/** Punto desplazado `eastM` al este y `northM` al norte. */
export const offset = (p: LatLng, eastM: number, northM: number): LatLng => ({ lat: p.lat + northM / M_LAT, lng: p.lng + eastM / mLng(p.lat) });

export function pathLengthM(points: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  return d;
}

/** Rejilla cuadrada de celdas alrededor del centro. */
export function gridCells(opts: { halfM?: number; stepM?: number; routes?: number; climbMPerKm?: number | null } = {}): HeatCellLite[] {
  const { halfM = 24_000, stepM = 600, routes = 3, climbMPerKm = null } = opts;
  const cells: HeatCellLite[] = [];
  for (let y = -halfM; y <= halfM; y += stepM) {
    for (let x = -halfM; x <= halfM; x += stepM) cells.push({ ...offset(START, x, y), routes, climbMPerKm });
  }
  return cells;
}

/** Interpola puntos cada `stepM` entre dos puntos. */
function segment(a: LatLng, b: LatLng, stepM = 100): LatLng[] {
  const n = Math.max(1, Math.ceil(haversineM(a.lat, a.lng, b.lat, b.lng) / stepM));
  return Array.from({ length: n }, (_, i) => ({ lat: a.lat + ((b.lat - a.lat) * i) / n, lng: a.lng + ((b.lng - a.lng) * i) / n }));
}

/** Línea que pasa por todos los puntos; con `factor` > 1, cada tramo hace un quiebro a la izquierda para medir `factor` veces la recta. */
export function pathThrough(points: LatLng[], factor = 1): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (factor <= 1) { out.push(...segment(a, b)); continue; }
    const dx = (b.lng - a.lng) * mLng(a.lat);
    const dy = (b.lat - a.lat) * M_LAT;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const h = (len / 2) * Math.sqrt(factor * factor - 1);
    const mid = offset({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }, (-dy / len) * h, (dx / len) * h);
    out.push(...segment(a, mid), ...segment(mid, b));
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Altitud en triángulo: sube `gainM` en la primera mitad y baja en la segunda. */
export function withElevation(points: LatLng[], gainM: number): RoutePoint[] {
  const total = pathLengthM(points);
  let done = 0;
  return points.map((p, i) => {
    if (i > 0) done += haversineM(points[i - 1].lat, points[i - 1].lng, p.lat, p.lng);
    const t = total > 0 ? done / total : 0;
    return { lat: p.lat, lng: p.lng, ele: 200 + gainM * (t <= 0.5 ? 2 * t : 2 - 2 * t) };
  });
}

export type FeatureDefects = { mainRoadPct?: number; unpavedM?: number; noExtras?: boolean };

/** Respuesta de ORS sobre los puntos dados, toda de carretera asfaltada salvo los defectos pedidos. */
export function featureFrom(points: RoutePoint[], defects: FeatureDefects = {}): OrsFeature {
  const n = points.length - 1;
  const d = pathLengthM(points);
  const main = defects.mainRoadPct ?? 0;
  const unpaved = defects.unpavedM ?? 0;
  const f = {
    geometry: { type: 'LineString', coordinates: points.map(p => [p.lng, p.lat, p.ele ?? 200]) },
    properties: {
      summary: { distance: d, duration: d / 7 },
      extras: {
        surface: {
          values: [[0, n, 3]],
          summary: [{ value: 3, distance: d - unpaved, amount: 100 - (unpaved / d) * 100 }, ...(unpaved ? [{ value: 8, distance: unpaved, amount: (unpaved / d) * 100 }] : [])],
        },
        waytypes: {
          values: [[0, n, 2]],
          summary: [{ value: 2, distance: d * (1 - main / 100), amount: 100 - main }, ...(main ? [{ value: 1, distance: (d * main) / 100, amount: main }] : [])],
        },
        steepness: { values: [[0, n, 0]], summary: [{ value: 0, distance: d, amount: 100 }] },
        waycategory: { values: [[0, n, 0]], summary: [{ value: 0, distance: d, amount: 100 }] },
      },
    },
  };
  if (defects.noExtras) (f.properties as { extras?: unknown }).extras = undefined;
  return f as OrsFeature;
}

export type FakeOrsOptions = FeatureDefects & {
  /** Longitud de la respuesta frente al polígono pedido. */
  factor?: number;
  gainM?: number;
  /** Fracción del total que es una ida y vuelta desde el inicio (retroceso). */
  spur?: number;
  fail?: (n: number, waypoints: LatLng[]) => OrsError | undefined;
  /** Respuesta a medida para una consulta concreta; `undefined` usa la normal. */
  respond?: (waypoints: LatLng[], n: number) => OrsFeature | undefined;
};

/** ORS falso como servicio común: pasa por los puntos pedidos y guarda cada consulta. */
export function fakeOrs(opts: FakeOrsOptions = {}) {
  const calls: LatLng[][] = [];
  const responses: OrsFeature[] = [];
  const fetchOne = async (req: Parameters<SharedOrsAccess['fetch']>[0]): Promise<OrsFeature> => {
    if (req.operation !== 'path') throw new Error(`operación inesperada: ${req.operation}`);
    const n = calls.length;
    calls.push(req.waypoints);
    const error = opts.fail?.(n, req.waypoints);
    if (error) throw error;
    const custom = opts.respond?.(req.waypoints, n);
    if (custom) { responses.push(custom); return custom; }
    const factor = opts.factor ?? 1.75;
    const spur = opts.spur ?? 0;
    let line = pathThrough(req.waypoints, factor * (1 - 2 * spur));
    if (spur > 0) {
      const total = pathLengthM(req.waypoints) * factor;
      const tip = offset(req.waypoints[0], 0, -total * spur);
      line = [...pathThrough([req.waypoints[0], tip, req.waypoints[0]]), ...line.slice(1)];
    }
    const f = featureFrom(withElevation(line, opts.gainM ?? 300), opts);
    responses.push(f);
    return f;
  };
  const access: SharedOrsAccess = { kind: 'shared', fetch: fetchOne, fetchAll: async req => [await fetchOne(req)] };
  return { access, calls, responses };
}

/** Circunferencia de `lengthM` que pasa por el inicio con el centro hacia `bearingDeg`. */
export function circleLoop(bearingDeg: number, lengthM: number, gainM: number | null = 300): RoutePoint[] {
  const r = lengthM / (2 * Math.PI);
  const b = (bearingDeg * Math.PI) / 180;
  const centre = offset(START, Math.sin(b) * r, Math.cos(b) * r);
  const n = Math.ceil(lengthM / 100);
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const a = b + Math.PI + (2 * Math.PI * i) / n;
    return offset(centre, Math.sin(a) * r, Math.cos(a) * r);
  });
  pts[n] = { ...START };
  pts[0] = { ...START };
  return gainM === null ? pts.map(p => ({ lat: p.lat, lng: p.lng })) : withElevation(pts, gainM);
}

/** Ruta de la biblioteca: su línea solo la usa la adaptación falsa. */
export function libRoute(n: number, over: Partial<LibraryRoute> = {}): LibraryRoute {
  const line = circleLoop(n * 90, 60_000).filter((_, i) => i % 10 === 0).map((p): [number, number, number] => [p.lng, p.lat, p.ele ?? 200]);
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, source: 'rwgps', url: `https://ridewithgps.com/routes/${900_000 + n}`,
    name: `Vuelta sintética ${n}`, author: 'Autor sintético', distanceM: 60_000, elevGainM: 600, loop: true, passM: 0, line, ...over,
  };
}

export function zoneOf(opts: { cells?: HeatCellLite[]; routes?: LibraryRoute[]; routeCount?: number; factor?: number; fill?: LibraryFill } = {}): LibraryZone {
  const routes = opts.routes ?? [];
  const cells = opts.cells ?? [];
  return {
    routeCount: opts.routeCount ?? (cells.length > 0 ? 40 : routes.length), cells, routes,
    zoneFactor: opts.factor ?? 1.75, factorSamples: 12, climbMPerKm: null, fill: opts.fill ?? 'none',
  };
}
