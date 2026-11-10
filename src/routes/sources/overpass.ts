import { z } from 'zod';
import { routeReferenceSchema, routeSearchSchema, RouteSourceError, type RouteSearch, type RouteReference } from './schema.ts';

const point = z.object({ lat: z.number().finite().min(-90).max(90), lon: z.number().finite().min(-180).max(180) });
const member = z.object({ type: z.string(), ref: z.number().int(), role: z.string().default('') });
const element = z.object({ type: z.string(), id: z.number().int().positive(), tags: z.record(z.string(), z.string()).optional(), members: z.array(member).max(500).optional(), geometry: z.array(point).max(50_000).optional() });
const payload = z.object({ elements: z.array(element).max(30_000), remark: z.string().optional() });
type Position = [number, number];
export function metres(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b[1] - a[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function buildOverpassQuery(input: RouteSearch): string {
  const { lat, lon, radiusM } = routeSearchSchema.parse(input);
  // Todas las vías, incluso las prohibidas: eliminarlas aquí ocultaría huecos peligrosos.
  return `[out:json][timeout:20][maxsize:8388608];rel(around:${radiusM},${lat},${lon})[type=route][route=bicycle][network~"^(lcn|rcn|ncn)$"]->.routes;(.routes;way(r.routes););out body geom;`;
}

export function parseOverpass(raw: unknown, input: RouteSearch, fetchedAt: string): RouteReference[] {
  const search = routeSearchSchema.parse(input);
  const parsed = payload.safeParse(raw);
  if (!parsed.success || parsed.data.remark) throw new RouteSourceError('invalid_response');
  const ways = new Map(parsed.data.elements.filter(e => e.type === 'way').map(e => [e.id, e]));
  const routes: RouteReference[] = [];
  for (const relation of parsed.data.elements) {
    const tags = relation.tags;
    if (relation.type !== 'relation' || tags?.type !== 'route' || tags.route !== 'bicycle' || !['lcn', 'rcn', 'ncn'].includes(tags.network)) continue;
    const members = relation.members;
    if (!members?.length || members.some(m => !['way', 'node'].includes(m.type))) continue;
    const lines: Position[][] = [];
    let rejected = false;
    for (const m of members) {
      if (m.type !== 'way') continue; // nodos de señalización no aportan geometría
      const way = ways.get(m.ref);
      const t = way?.tags;
      if (!t?.highway || !way?.geometry || way.geometry.length < 2
        || /^(motorway|trunk)(_link)?$/.test(t.highway)
        || ['steps', 'track', 'path', 'bridleway', 'construction', 'proposed'].includes(t.highway)
        || ['no', 'private'].includes(t.bicycle ?? '')
        || (['no', 'private'].includes(t.access ?? '') && !['yes', 'designated', 'permissive'].includes(t.bicycle ?? ''))
        || (t.surface && !['asphalt', 'paved', 'concrete', 'concrete:lanes', 'concrete:plates'].includes(t.surface))) { rejected = true; break; }
      const line: Position[] = way.geometry.map(p => [p.lon, p.lat]);
      if (m.role === 'backward') line.reverse();
      lines.push(line);
    }
    if (rejected || !lines.length) continue;
    // Comprueba cercanía a segmentos, no solo a sus extremos.
    const centre: Position = [search.lon, search.lat];
    const near = lines.some(line => line.some((p, i) => {
      if (metres(centre, p) <= search.radiusM) return true;
      if (!i) return false;
      const a = line[i - 1];
      const cos = Math.cos(search.lat * Math.PI / 180);
      const ax = (a[0] - centre[0]) * cos, ay = a[1] - centre[1];
      const dx = (p[0] - a[0]) * cos, dy = p[1] - a[1];
      const u = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      return metres(centre, [a[0] + (p[0] - a[0]) * u, a[1] + (p[1] - a[1]) * u]) <= search.radiusM;
    }));
    if (!near) continue;
    const distanceM = lines.reduce((sum, line) => sum + line.reduce((d, p, i) => d + (i ? metres(line[i - 1], p) : 0), 0), 0);
    if (!distanceM) continue;
    routes.push(routeReferenceSchema.parse({ source: 'osm', url: `https://www.openstreetmap.org/relation/${relation.id}`,
      author: `© OpenStreetMap contributors${tags.operator ? `; ${tags.operator.slice(0, 250)}` : ''}`,
      name: tags.name?.slice(0, 500) || tags.ref?.slice(0, 500) || `Ruta ciclista ${relation.id}`, distanceM, ascentM: null,
      geometry: { type: 'MultiLineString', coordinates: lines }, fetchedAt }));
    if (routes.length === 10) break;
  }
  return routes;
}
