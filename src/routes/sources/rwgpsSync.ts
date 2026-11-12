import { z } from 'zod';

/**
 * Índice propio de rutas públicas de Ride with GPS (la API no busca por zona). Se siembra con la cuenta
 * común: sus colecciones y sus rutas. Portable: solo importa zod, y `get` llega inyectado para probarlo
 * sin red. Las rutas de la API las construye este módulo; nadie de fuera elige ninguna.
 */

/** Fila de `public.rwgps_route_index`. `line` es `[[lng, lat], ...]` con como mucho 300 puntos. */
export type RwgpsIndexRow = {
  id: number; name: string; author: string; distance_m: number; elev_gain_m: number | null;
  start_lat: number; start_lng: number; min_lat: number; max_lat: number; min_lng: number; max_lng: number;
  line: [number, number][]; source: 'seed' | 'user';
};

export type RwgpsSyncDependencies = {
  get: (path: string, signal: AbortSignal) => Promise<{ status: number; json: unknown }>;
  /** `indexed_at` (ms) de los ids que ya están en el índice. */
  indexedAt: (ids: number[]) => Promise<Map<number, number>>;
  upsert: (row: RwgpsIndexRow) => Promise<void>;
  remove: (id: number) => Promise<void>;
  now?: () => number;
};

export type RwgpsSyncResult = { fetched: number; indexed: number; removed: number; error: null | 'provider_busy' | 'unavailable' | 'provider_error' | 'timeout' };

export const MAX_SYNC_ROUTE_FETCHES = 80;
export const MAX_LINE_POINTS = 300;
const PAGE_SIZE = 200;
const MAX_LIST_PAGES = 10;
const MAX_COLLECTIONS = 100;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const EARTH_M = 6_371_008.8;

const finite = z.number();
const routeId = z.number().int().positive().max(999_999_999_999);
const summary = z.object({ id: routeId, visibility: z.string().nullish() });
const collectionsPage = z.object({ collections: z.array(z.object({ id: routeId })) });
const collectionDetail = z.object({ collection: z.object({ routes: z.array(summary).nullish() }) });
const routesPage = z.object({ routes: z.array(summary), meta: z.object({ pagination: z.object({ next_page_url: z.string().nullish() }) }).nullish() });
const routeDetail = z.object({
  route: z.object({
    visibility: z.literal('public'),
    name: z.string().max(500).nullish(),
    user: z.object({ name: z.string().max(200).nullish() }).nullish(),
    distance: finite.nonnegative().nullish(),
    elevation_gain: finite.nonnegative().nullish(),
    track_points: z.array(z.object({ x: finite.min(-180).max(180), y: finite.min(-90).max(90), e: finite.nullish() })).min(2).max(100_000),
  }),
});

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Muestreo uniforme: como mucho `max` puntos, siempre con el primero y el último. */
export function simplifyLine<T>(points: T[], max = MAX_LINE_POINTS): T[] {
  if (points.length <= max) return points;
  return Array.from({ length: max }, (_, i) => points[Math.round((i * (points.length - 1)) / (max - 1))]);
}

/** Resumen indexable de una ruta pública con 2 puntos válidos o más; si no, null. Sin datos de la cuenta. */
export function buildIndexRow(id: number, json: unknown, source: RwgpsIndexRow['source']): RwgpsIndexRow | null {
  const parsed = routeDetail.safeParse(json);
  if (!parsed.success) return null;
  const { route } = parsed.data;
  const points = route.track_points;
  let length = 0; let gain = 0; let hasElevation = false;
  let minLat = Infinity; let maxLat = -Infinity; let minLng = Infinity; let maxLng = -Infinity;
  points.forEach((p, i) => {
    minLat = Math.min(minLat, p.y); maxLat = Math.max(maxLat, p.y); minLng = Math.min(minLng, p.x); maxLng = Math.max(maxLng, p.x);
    if (typeof p.e === 'number') hasElevation = true;
    if (i === 0) return;
    const prev = points[i - 1];
    length += haversineM(prev.y, prev.x, p.y, p.x);
    if (typeof p.e === 'number' && typeof prev.e === 'number' && p.e > prev.e) gain += p.e - prev.e;
  });
  const elevation = route.elevation_gain ?? (hasElevation ? gain : null);
  return {
    id, name: route.name ?? '', author: route.user?.name ?? '',
    distance_m: Math.round(route.distance ?? length), elev_gain_m: elevation === null ? null : Math.round(elevation),
    start_lat: round5(points[0].y), start_lng: round5(points[0].x), min_lat: round5(minLat), max_lat: round5(maxLat), min_lng: round5(minLng), max_lng: round5(maxLng),
    line: simplifyLine(points).map(p => [round5(p.x), round5(p.y)]), source,
  };
}

const listPath = (kind: 'routes' | 'collections', page: number) => `/api/v1/${kind}.json?page=${page}&page_size=${PAGE_SIZE}`;

class SyncStop extends Error {
  constructor(readonly code: Exclude<RwgpsSyncResult['error'], null>) { super(code); }
}

/** Ids públicos (o sin visibilidad en el resumen) de las colecciones y las rutas de la cuenta común. */
async function listRouteIds(read: (path: string) => Promise<unknown>): Promise<number[]> {
  const ids = new Set<number>();
  const add = (routes: z.infer<typeof summary>[]) => { for (const r of routes) if (!r.visibility || r.visibility === 'public') ids.add(r.id); };
  const collections: number[] = [];
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const parsed = collectionsPage.safeParse(await read(listPath('collections', page)));
    if (!parsed.success) throw new SyncStop('provider_error');
    collections.push(...parsed.data.collections.map(c => c.id));
    if (parsed.data.collections.length < PAGE_SIZE) break;
  }
  for (const id of collections.slice(0, MAX_COLLECTIONS)) {
    const parsed = collectionDetail.safeParse(await read(`/api/v1/collections/${id}.json`));
    if (parsed.success) add(parsed.data.collection.routes ?? []);
  }
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const parsed = routesPage.safeParse(await read(listPath('routes', page)));
    if (!parsed.success) throw new SyncStop('provider_error');
    add(parsed.data.routes);
    if (!parsed.data.meta?.pagination.next_page_url || parsed.data.routes.length === 0) break;
  }
  return [...ids];
}

/** Una pasada: como mucho 80 rutas nuevas o indexadas hace más de 30 días. Nunca lanza; devuelve un código. */
export async function syncRwgpsIndex(deps: RwgpsSyncDependencies, signal: AbortSignal): Promise<RwgpsSyncResult> {
  const result: RwgpsSyncResult = { fetched: 0, indexed: 0, removed: 0, error: null };
  const now = (deps.now ?? Date.now)();
  /** 200 → cuerpo; 403/404 → null; el resto para la pasada. */
  const read = async (path: string): Promise<unknown> => {
    if (signal.aborted) throw new SyncStop('timeout');
    const { status, json } = await deps.get(path, signal);
    if (status === 200) return json;
    if (status === 403 || status === 404) return null;
    throw new SyncStop(status === 429 ? 'provider_busy' : status === 401 ? 'unavailable' : 'provider_error');
  };
  try {
    const ids = await listRouteIds(read);
    const known = await deps.indexedAt(ids);
    const due = ids.filter(id => !known.has(id) || now - known.get(id)! > REFRESH_MS)
      .sort((a, b) => (known.get(a) ?? 0) - (known.get(b) ?? 0))
      .slice(0, MAX_SYNC_ROUTE_FETCHES);
    for (const id of due) {
      const json = await read(`/api/v1/routes/${id}.json`);
      result.fetched++;
      const row = buildIndexRow(id, json, 'seed');
      if (row) { await deps.upsert(row); result.indexed++; }
      else if (known.has(id)) { await deps.remove(id); result.removed++; }
    }
  } catch (err) {
    result.error = err instanceof SyncStop ? err.code : signal.aborted ? 'timeout' : 'provider_error';
  }
  return result;
}
