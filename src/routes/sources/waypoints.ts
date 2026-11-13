import { z } from 'zod';
import { metres } from './overpass.ts';
import { suitablePavedRoad } from './passes.ts';
import { RouteSourceError } from './schema.ts';
import type { SourceTransport } from './providers.ts';

/** Puntos de paso de OSM: puertos, cimas con carretera y pueblos. Solo nombre, cota y distancia viajan a la IA. */
export type OsmWaypointKind = 'puerto' | 'cima' | 'pueblo';
export type OsmWaypoint = {
  id: string; kind: OsmWaypointKind; name: string; lat: number; lng: number; ele: number | null;
  distanceM: number; deadEnd?: boolean; interes: 0 | 1 | 2 | 3;
};

export const MIN_WAYPOINT_DISTANCE_M = 3_000;
/** Más cerca que esta fracción del radio no sirve para una vuelta de ese tamaño (la banda empieza en 0,24 del radio). */
const MIN_RADIUS_FRACTION = 0.2;
const PER_KIND = 40;
const SECTORS = 8, RINGS = 3;
const PASS_SNAP_M = 120, PEAK_SNAP_M = 150;
/**
 * Overpass público: el principal y la réplica francesa. Medido el 2026-11-13: el principal tarda de 27 a 55 s
 * en cualquier consulta (cola del servidor) y la réplica de 7 a 8 s; por eso se pregunta a los dos a la vez.
 */
export const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter'] as const;
/** Si fallan los dos, la ronda se repite una vez: los 502 y los `remark` son sueltos. */
const ROUNDS = 2;

export const waypointSearchSchema = z.strictObject({
  lat: z.number().finite().min(-85).max(85), lon: z.number().finite().min(-180).max(180),
  radiusM: z.number().int().min(8_000).max(35_000),
});
export type WaypointSearch = z.infer<typeof waypointSearchSchema>;

export const osmWaypointSchema = z.strictObject({
  id: z.string().regex(/^osm-(pass|peak|place)-\d+$/), kind: z.enum(['puerto', 'cima', 'pueblo']),
  name: z.string().trim().min(1).max(80), lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180),
  ele: z.number().finite().min(0).max(12_000).nullable(),
  distanceM: z.number().finite().min(MIN_WAYPOINT_DISTANCE_M).max(35_000), deadEnd: z.boolean().optional(),
  interes: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});
export const osmWaypointsSchema = z.array(osmWaypointSchema).max(3 * PER_KIND);

/**
 * Punto a 2 decimales (cerca de 1 km) y radio redondeado hacia arriba a 5 km: los puntos de paso están a
 * más de 3 km, así que inicios vecinos comparten caché y la consulta lenta a Overpass se hace una vez por zona.
 */
export function normalizeWaypointSearch(input: WaypointSearch): WaypointSearch {
  const search = waypointSearchSchema.parse(input);
  return { lat: Number(search.lat.toFixed(2)) || 0, lon: Number(search.lon.toFixed(2)) || 0,
    radiusM: Math.min(35_000, Math.ceil(search.radiusM / 5000) * 5000) };
}

const ROADS = 'primary|secondary|tertiary|unclassified';

export function buildWaypointQuery(input: WaypointSearch): string {
  const { lat, lon, radiusM } = waypointSearchSchema.parse(input);
  // Un rectángulo es mucho más rápido que `around` global; la distancia exacta la filtra parseWaypoints.
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
  const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map(n => n.toFixed(4)).join(',');
  // Todas las cimas con nombre de 60×60 km agotan la memoria de Overpass: solo las que tienen cota y ficha,
  // que son las conocidas. Los pueblos no se cruzan con vías; el firme lo valida después el filtro de carretera.
  return `[out:json][timeout:25][maxsize:67108864][bbox:${bbox}];`
    + `(node[mountain_pass=yes][name];node[natural=saddle][name];)->.passes;`
    + `node[natural=peak][name][ele][~"^(wikidata|wikipedia)$"~"."]->.peaks;`
    + `node[place~"^(village|town)$"][name]->.towns;`
    + `(.passes;.peaks;.towns;);out body;`
    + `(way(around.passes:${PASS_SNAP_M})[highway~"^(${ROADS})$"];way(around.peaks:${PEAK_SNAP_M})[highway~"^(${ROADS})$"];);out body geom;`;
}

/**
 * Carretera de paso junto a un puerto o una cima: una vía clasificada, o una `unclassified` con firme asfaltado
 * declarado. Sin firme declarado suele ser una pista; una calle o un acceso (`residential`, `service`) acaban en
 * una urbanización y obligan a volver por donde se entró. Medido desde Caldes: con ellas, casi todas las vueltas
 * salían con pista o con más de un 15 % de ida y vuelta.
 */
function realRoad(way: Element): boolean {
  const highway = way.tags?.highway ?? '';
  return suitablePavedRoad(way) && (['primary', 'secondary', 'tertiary'].includes(highway) || (highway === 'unclassified' && !!way.tags?.surface));
}

const position = z.object({ lat: z.number().finite().min(-90).max(90), lon: z.number().finite().min(-180).max(180) });
const element = z.object({
  type: z.string(), id: z.number().int().positive(), lat: position.shape.lat.optional(), lon: position.shape.lon.optional(),
  tags: z.record(z.string(), z.string()).optional(), nodes: z.array(z.number().int().positive()).max(50_000).optional(),
  geometry: z.array(position).max(50_000).optional(),
});
const payload = z.object({ elements: z.array(element).max(60_000), remark: z.string().optional() });
type Element = z.infer<typeof element>;

type Hit = { lat: number; lon: number; distanceM: number };
/** Punto más cercano sobre los segmentos de las vías (los vértices de OSM pueden estar muy separados). */
function nearestOnRoad(ways: Element[], lat: number, lon: number, maxM: number): Hit | null {
  const cos = Math.cos(lat * Math.PI / 180);
  let best: Hit | null = null;
  for (const w of ways) {
    const g = w.geometry ?? [];
    for (let i = 0; i < g.length; i++) {
      const a = g[i], b = g[Math.min(i + 1, g.length - 1)];
      const ax = (a.lon - lon) * cos, ay = a.lat - lat, dx = (b.lon - a.lon) * cos, dy = b.lat - a.lat;
      const u = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      const p = { lat: a.lat + (b.lat - a.lat) * u, lon: a.lon + (b.lon - a.lon) * u };
      const distanceM = metres([lon, lat], [p.lon, p.lat]);
      if (distanceM <= maxM && (!best || distanceM < best.distanceM)) best = { ...p, distanceM };
    }
  }
  return best;
}

/** Carretera que acaba junto a la cima (su extremo no lo comparte otra vía): subir y bajar es lo normal. */
function endsNear(ways: Element[], all: Element[], lat: number, lon: number): boolean {
  return ways.some(w => {
    const geometry = w.geometry;
    if (!geometry || geometry.length < 2) return false;
    return [0, geometry.length - 1].some(i => {
      const g = geometry[i];
      if (metres([lon, lat], [g.lon, g.lat]) > PEAK_SNAP_M) return false;
      const nodeId = w.nodes?.[i];
      return !(nodeId !== undefined && all.some(o => o !== w && o.nodes?.includes(nodeId)));
    });
  });
}

function parseEle(tag: string | undefined): number | null {
  if (!tag || !/^\s*\d+(?:[.,]\d+)?\s*(?:m)?\s*$/.test(tag)) return null;
  const ele = Number(tag.replace(/\s*m\s*$/, '').replace(',', '.').trim());
  return ele <= 12_000 ? ele : null;
}

const score = (ficha: boolean, ele: number | null): OsmWaypoint['interes'] =>
  Math.min(3, (ficha ? 1 : 0) + ((ele ?? 0) >= 700 ? 1 : 0) + 1) as OsmWaypoint['interes'];

/**
 * Como mucho `PER_KIND`: primero los de más interés y, a igual interés, repartidos por rumbo y distancia
 * (8 sectores × 3 anillos, por turnos) para que el motor tenga puntos hacia todos los lados y no solo los más cercanos.
 */
function spread(list: OsmWaypoint[], search: WaypointSearch, minM: number): OsmWaypoint[] {
  const cos = Math.cos(search.lat * Math.PI / 180);
  const cell = (w: OsmWaypoint) => {
    const bearing = (Math.atan2((w.lng - search.lon) * cos, w.lat - search.lat) * 180 / Math.PI + 360) % 360;
    const ring = Math.min(RINGS - 1, Math.floor((w.distanceM - minM) / ((search.radiusM - minM) / RINGS)));
    return Math.floor(bearing / (360 / SECTORS)) % SECTORS * RINGS + Math.max(0, ring);
  };
  const out: OsmWaypoint[] = [];
  for (let interes = 3; interes >= 0 && out.length < PER_KIND; interes--) {
    const cells = new Map<number, OsmWaypoint[]>();
    for (const w of list.filter(x => x.interes === interes).sort((a, b) => a.distanceM - b.distanceM)) {
      const key = cell(w);
      cells.set(key, [...(cells.get(key) ?? []), w]);
    }
    const queues = [...cells.entries()].sort((a, b) => a[0] - b[0]).map(([, q]) => q);
    for (let turn = 0; queues.some(q => q.length > turn); turn++) {
      for (const q of queues) if (q[turn]) out.push(q[turn]);
    }
  }
  return out.slice(0, PER_KIND);
}

export function parseWaypoints(raw: unknown, input: WaypointSearch): OsmWaypoint[] {
  const search = waypointSearchSchema.parse(input);
  const parsed = payload.safeParse(raw);
  if (!parsed.success || parsed.data.remark) throw new RouteSourceError('invalid_response');
  const paved = parsed.data.elements.filter(w => w.type === 'way' && realRoad(w));
  const minM = Math.max(MIN_WAYPOINT_DISTANCE_M, MIN_RADIUS_FRACTION * search.radiusM);
  const found: OsmWaypoint[] = [];
  for (const n of parsed.data.elements) {
    const tags = n.tags;
    const name = tags?.name?.trim();
    if (n.type !== 'node' || n.lat === undefined || n.lon === undefined || !tags || !name) continue;
    const distanceM = metres([search.lon, search.lat], [n.lon, n.lat]);
    if (distanceM < minM || distanceM > search.radiusM) continue;
    const ficha = !!(tags.wikidata || tags.wikipedia);
    const base = { name: name.slice(0, 80), distanceM };
    if (tags.mountain_pass === 'yes' || tags.natural === 'saddle') {
      const road = nearestOnRoad(paved, n.lat, n.lon, PASS_SNAP_M);
      if (!road) continue;
      const ele = parseEle(tags.ele);
      found.push({ ...base, id: `osm-pass-${n.id}`, kind: 'puerto', lat: road.lat, lng: road.lon, ele, interes: score(ficha, ele) });
    } else if (tags.natural === 'peak') {
      const road = nearestOnRoad(paved, n.lat, n.lon, PEAK_SNAP_M);
      if (!road) continue;
      const ele = parseEle(tags.ele);
      const near = paved.filter(w => nearestOnRoad([w], n.lat!, n.lon!, PEAK_SNAP_M));
      found.push({ ...base, id: `osm-peak-${n.id}`, kind: 'cima', lat: road.lat, lng: road.lon, ele,
        ...(endsNear(near, paved, n.lat, n.lon) ? { deadEnd: true } : {}), interes: score(ficha, ele) });
    } else if (tags.place === 'village' || tags.place === 'town') {
      found.push({ ...base, id: `osm-place-${n.id}`, kind: 'pueblo', lat: n.lat, lng: n.lon, ele: null, interes: ficha ? 1 : 0 });
    }
  }
  const result: OsmWaypoint[] = [];
  for (const kind of ['puerto', 'cima', 'pueblo'] as const) {
    result.push(...spread(found.filter(w => w.kind === kind), search, minM));
  }
  return osmWaypointsSchema.parse(result);
}

/**
 * Pregunta a los dos servidores a la vez y se queda con la primera respuesta válida. Reintentan una ronda más
 * los fallos de red, los 502/504/429 y el `remark` de error. Un fallo nunca se devuelve como «sin puntos».
 */
export async function loadWaypoints(input: WaypointSearch, transport: SourceTransport): Promise<OsmWaypoint[]> {
  const query = buildWaypointQuery(input);
  const ask = async (endpoint: string): Promise<OsmWaypoint[]> => {
    const text = await transport(endpoint, { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: query }) });
    let raw: unknown;
    try { raw = JSON.parse(text); }
    catch { throw new RouteSourceError('invalid_response'); }
    return parseWaypoints(raw, input);
  };
  const cancelled = (error: unknown) => error instanceof RouteSourceError ? error.code === 'cancelled'
    : error instanceof DOMException && error.name === 'AbortError';
  let last: unknown;
  for (let round = 0; round < ROUNDS; round++) {
    try {
      return await Promise.any(OVERPASS_ENDPOINTS.map(ask));
    } catch (error) {
      const errors: unknown[] = error instanceof AggregateError ? error.errors : [error];
      const stop = errors.find(cancelled);
      if (stop) throw stop;
      last = errors.find(e => e instanceof RouteSourceError) ?? new RouteSourceError('unavailable');
    }
  }
  throw last;
}
