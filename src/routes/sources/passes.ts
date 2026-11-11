import { z } from 'zod';
import type { LatLng } from '../../domain/types.ts';
import { metres } from './overpass.ts';
import { RouteSourceError } from './schema.ts';
import type { SourceTransport } from './providers.ts';

/** Datos GIS locales; a la IA solo se transforman nombre, cota y distancia. */
export type MountainPass = {
  id: string; name: string; ele: number; lat: number; lng: number; distanceM: number;
  approach?: LatLng; departure?: LatLng;
};
const location = z.strictObject({ lat: z.number().finite().min(-85).max(85), lng: z.number().finite().min(-180).max(180) });
export const passSearchSchema = z.strictObject({
  lat: z.number().finite().min(-85).max(85), lon: z.number().finite().min(-180).max(180),
  radiusM: z.number().int().min(15_000).max(40_000),
});
export type PassSearch = z.infer<typeof passSearchSchema>;
export const mountainPassSchema = z.strictObject({
  id: z.string().regex(/^osm-pass-\d+$/), name: z.string().trim().min(1).max(80),
  ele: z.number().finite().min(0).max(12_000), lat: location.shape.lat, lng: location.shape.lng,
  distanceM: z.number().finite().min(15_000).max(40_000), approach: location.optional(), departure: location.optional(),
});
export const mountainPassesSchema = z.array(mountainPassSchema).max(10);

/** Misma cuantización que las referencias; esquema propio para conservar su límite de 25 km. */
export function normalizePassSearch(input: PassSearch): PassSearch {
  const search = passSearchSchema.parse(input);
  return { lat: Number(search.lat.toFixed(3)) || 0, lon: Number(search.lon.toFixed(3)) || 0,
    radiusM: Math.ceil(search.radiusM / 5000) * 5000 };
}

export function buildPassQuery(input: PassSearch): string {
  const { lat, lon, radiusM } = passSearchSchema.parse(input);
  // Un rectángulo es mucho más rápido que `around` en Overpass; la distancia exacta la filtra parsePasses.
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
  const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map(n => n.toFixed(4)).join(',');
  return `[out:json][timeout:20][maxsize:8388608][bbox:${bbox}];(node[mountain_pass=yes][name][ele];node[natural=saddle][name][ele];)->.passes;(.passes;way(around.passes:120)[highway~"^(primary|secondary|tertiary|unclassified|residential|service|living_street)$"];);out body geom;`;
}

const position = z.object({ lat: z.number().finite().min(-90).max(90), lon: z.number().finite().min(-180).max(180) });
const element = z.object({
  type: z.string(), id: z.number().int().positive(), lat: position.shape.lat.optional(), lon: position.shape.lon.optional(),
  tags: z.record(z.string(), z.string()).optional(), nodes: z.array(z.number().int().positive()).max(50_000).optional(),
  geometry: z.array(position).max(50_000).optional(),
});
const payload = z.object({ elements: z.array(element).max(30_000), remark: z.string().optional() });
type Element = z.infer<typeof element>;

function suitableRoad(way: Element): boolean {
  const tags = way.tags;
  return !!tags && ['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'living_street'].includes(tags.highway)
    && !['no', 'private'].includes(tags.bicycle ?? '')
    && (!['no', 'private'].includes(tags.access ?? '') || ['yes', 'designated', 'permissive'].includes(tags.bicycle ?? ''))
    && (!tags.surface || ['asphalt', 'paved', 'concrete', 'concrete:lanes', 'concrete:plates'].includes(tags.surface));
}

/** Máxima separación entre el nodo del puerto y su carretera: muchos collados se cartografían junto a la vía. */
const ROAD_SNAP_M = 120;

/** Vértice de carretera más próximo al puerto, si está a menos de ROAD_SNAP_M. */
function nearestRoad(roads: Element[], lat: number, lon: number): { way: Element; index: number; distanceM: number } | null {
  let best: { way: Element; index: number; distanceM: number } | null = null;
  for (const way of roads) {
    way.geometry?.forEach((g, index) => {
      const distanceM = metres([lon, lat], [g.lon, g.lat]);
      if (distanceM <= ROAD_SNAP_M && (!best || distanceM < best.distanceM)) best = { way, index, distanceM };
    });
  }
  return best;
}

/** Devuelve vecinos sobre la misma vía, preferiblemente a 300 m: no puntos laterales aleatorios. */
function neighbours(way: Element, index: number): { approach: LatLng; departure: LatLng } | null {
  if (!way.nodes || !way.geometry || way.nodes.length !== way.geometry.length) return null;
  if (index <= 0 || index >= way.nodes.length - 1) return null;
  const at = (i: number): LatLng => ({ lat: way.geometry![i].lat, lng: way.geometry![i].lon });
  const choose = (direction: number): LatLng => {
    let i = index;
    let walked = 0;
    while (i + direction >= 0 && i + direction < way.nodes!.length && walked < 300) {
      const from = way.geometry![i], to = way.geometry![i + direction];
      walked += metres([from.lon, from.lat], [to.lon, to.lat]);
      i += direction;
    }
    return at(i);
  };
  return { approach: choose(-1), departure: choose(1) };
}

export function parsePasses(raw: unknown, input: PassSearch): MountainPass[] {
  const search = passSearchSchema.parse(input);
  const parsed = payload.safeParse(raw);
  if (!parsed.success || parsed.data.remark) throw new RouteSourceError('invalid_response');
  const roads = parsed.data.elements.filter(way => way.type === 'way' && suitableRoad(way));
  const result: MountainPass[] = [];
  const seen = new Set<number>();
  for (const node of parsed.data.elements) {
    const tags = node.tags;
    if (node.type !== 'node' || seen.has(node.id) || node.lat === undefined || node.lon === undefined
      || (tags?.mountain_pass !== 'yes' && tags?.natural !== 'saddle') || !tags.name?.trim() || !tags.ele) continue;
    if (!/^\s*\d+(?:[.,]\d+)?\s*(?:m)?\s*$/.test(tags.ele)) continue;
    const ele = Number(tags.ele.replace(/\s*m\s*$/, '').replace(',', '.').trim());
    const distanceM = metres([search.lon, search.lat], [node.lon, node.lat]);
    if (ele > 12_000 || distanceM < 15_000 || distanceM > search.radiusM) continue;
    const road = nearestRoad(roads, node.lat, node.lon);
    if (!road) continue;
    const nearby = neighbours(road.way, road.index);
    // El motor debe pasar por la carretera: se usa el vértice de la vía, no el nodo topográfico.
    const onRoad = road.way.geometry![road.index];
    seen.add(node.id);
    result.push(mountainPassSchema.parse({ id: `osm-pass-${node.id}`, name: tags.name.trim().slice(0, 80), ele,
      lat: onRoad.lat, lng: onRoad.lon, distanceM, ...(nearby ?? {}) }));
  }
  return result.sort((a, b) => a.distanceM - b.distanceM).slice(0, 10);
}

export async function loadMountainPasses(input: PassSearch, transport: SourceTransport): Promise<MountainPass[]> {
  const text = await transport('https://overpass-api.de/api/interpreter', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: buildPassQuery(input) }) });
  try { return parsePasses(JSON.parse(text), input); }
  catch { throw new RouteSourceError('invalid_response'); }
}
