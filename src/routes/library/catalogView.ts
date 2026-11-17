import { haversineM } from '../../import/summary';
import type { CatalogRoute } from './catalog';
import type { ReferenceSource } from './rows';

/** Filtros y orden del catálogo de la biblioteca común, todo en el móvil sobre la lista ya descargada. */

export type CatalogSort = 'near' | 'long' | 'short' | 'climb' | 'flat' | 'name';
export type CatalogFilter = {
  text: string;
  minKm: number | null; maxKm: number | null;
  minGain: number | null; maxGain: number | null;
  source: ReferenceSource | 'all';
  loopOnly: boolean;
  sort: CatalogSort;
};
export const NO_FILTER: CatalogFilter = { text: '', minKm: null, maxKm: null, minGain: null, maxGain: null, source: 'all', loopOnly: false, sort: 'near' };

export type CatalogItem = { route: CatalogRoute; awayM: number };

/** «45,5» o «45.5» pasan a número; lo vacío, negativo o inválido es «sin límite». */
export function parseBound(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Metros de subida por km, o null sin altitud. */
export function climbPerKm(r: Pick<CatalogRoute, 'distanceM' | 'elevGainM'>): number | null {
  return r.elevGainM === null ? null : r.elevGainM / (r.distanceM / 1000);
}

export type Terrain = 'Llana' | 'Ondulada' | 'Montañosa';
/** Cómo se siente la ruta por su pendiente media de subida; no depende del nivel de quien la mira. */
export function terrainFeel(r: Pick<CatalogRoute, 'distanceM' | 'elevGainM'>): Terrain | null {
  const c = climbPerKm(r);
  if (c === null) return null;
  return c < 8 ? 'Llana' : c < 15 ? 'Ondulada' : 'Montañosa';
}

/** Con el desnivel desconocido, la ruta va al final del orden por desnivel. */
const byGain = (dir: 1 | -1) => (a: CatalogItem, b: CatalogItem) => {
  const x = a.route.elevGainM; const y = b.route.elevGainM;
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
  return dir * (x - y);
};
const SORTS: Record<CatalogSort, (a: CatalogItem, b: CatalogItem) => number> = {
  near: (a, b) => a.awayM - b.awayM,
  long: (a, b) => b.route.distanceM - a.route.distanceM,
  short: (a, b) => a.route.distanceM - b.route.distanceM,
  climb: byGain(-1),
  flat: byGain(1),
  name: (a, b) => a.route.name.localeCompare(b.route.name, 'es'),
};

/** Aplica filtros y orden. Pedir un rango de desnivel excluye las rutas sin altitud. */
export function applyCatalogFilter(routes: CatalogRoute[], f: CatalogFilter, centre: { lat: number; lng: number }): CatalogItem[] {
  const text = fold(f.text.trim());
  const items: CatalogItem[] = [];
  for (const route of routes) {
    const km = route.distanceM / 1000;
    if (text && !fold(`${route.name} ${route.author}`).includes(text)) continue;
    if ((f.minKm !== null && km < f.minKm) || (f.maxKm !== null && km > f.maxKm)) continue;
    if (f.minGain !== null || f.maxGain !== null) {
      if (route.elevGainM === null) continue;
      if ((f.minGain !== null && route.elevGainM < f.minGain) || (f.maxGain !== null && route.elevGainM > f.maxGain)) continue;
    }
    if (f.source !== 'all' && route.source !== f.source) continue;
    if (f.loopOnly && !route.loop) continue;
    items.push({ route, awayM: haversineM(centre.lat, centre.lng, route.startLat, route.startLng) });
  }
  return items.sort(SORTS[f.sort]);
}

/** Filtros puestos, sin contar el orden. */
export function activeFilterCount(f: CatalogFilter): number {
  return [f.text.trim() !== '', f.minKm !== null || f.maxKm !== null, f.minGain !== null || f.maxGain !== null, f.source !== 'all', f.loopOnly].filter(Boolean).length;
}

/** Fuentes presentes en la lista, por orden alfabético. */
export function sourcesOf(routes: CatalogRoute[]): ReferenceSource[] {
  return [...new Set(routes.map(r => r.source))].sort();
}
