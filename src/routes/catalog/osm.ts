import { z } from 'zod';
import type { LatLng } from '../../domain/types';
import { haversineM } from '../../import/summary';

/**
 * Catálogo de OpenStreetMap: relaciones `route=bicycle` y `route=mtb` que pasan cerca del inicio.
 * Overpass se consulta desde el navegador con el centro redondeado a 0,01° (~1 km). Las rutas se
 * guardan solo en la biblioteca de la cuenta, con atribución «© OpenStreetMap contributors».
 */

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
/** Las rutas deben pasar a menos de esto del inicio. */
export const CATALOG_RADIUS_M = 15_000;
/** Se pide la geometría dentro de este rectángulo: las rutas largas llegan ya recortadas a la zona. */
const GEOMETRY_BOX_M = 25_000;
/** Unir tramos de una relación cuyos extremos están a menos de esto; más lejos, sería inventar carretera. */
export const CHAIN_JOIN_M = 300;
/** Por debajo no merece la pena como ruta. */
export const MIN_ROUTE_M = 5_000;
/** Puntos a menos de esto del anterior sobran: el GPX pesa menos y la forma no cambia. */
const MIN_STEP_M = 10;
export const MAX_OSM_ROUTES = 95;

export type CatalogTipo = 'carretera' | 'btt' | 'puerto';
export type OsmRoute = {
  ref: string;
  name: string;
  tipo: CatalogTipo;
  url: string;
  author: string;
  points: LatLng[];
  distanceM: number;
  /** Distancia mínima de la ruta al inicio. */
  nearM: number;
};

/** El centro que sale del dispositivo: 2 decimales, unos 1,1 km en latitud. */
export function roundedCentre(start: LatLng): LatLng {
  return { lat: Number(start.lat.toFixed(2)), lng: Number(start.lng.toFixed(2)) };
}

export function buildCatalogQuery(start: LatLng): string {
  const c = roundedCentre(start);
  const dLat = GEOMETRY_BOX_M / 111_320;
  const dLng = GEOMETRY_BOX_M / (111_320 * Math.max(0.01, Math.cos((c.lat * Math.PI) / 180)));
  const box = [c.lat - dLat, c.lng - dLng, c.lat + dLat, c.lng + dLng].map((n) => n.toFixed(4)).join(',');
  return `[out:json][timeout:90][maxsize:67108864];rel(around:${CATALOG_RADIUS_M},${c.lat},${c.lng})[type=route][route~"^(bicycle|mtb)$"];out geom(${box});`;
}

const coord = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
const member = z.object({
  type: z.string(),
  role: z.string().default(''),
  geometry: z.array(coord.nullable()).max(100_000).optional(),
});
const relation = z.object({
  type: z.literal('relation'),
  id: z.number().int().positive(),
  tags: z.record(z.string(), z.string()).optional(),
  members: z.array(member).max(20_000).optional(),
});
const payload = z.object({ elements: z.array(z.unknown()).max(20_000), remark: z.string().optional() });

export class OsmCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OsmCatalogError';
  }
}

const gap = (a: LatLng, b: LatLng) => haversineM(a.lat, a.lng, b.lat, b.lng);

function lengthM(line: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += gap(line[i - 1], line[i]);
  return d;
}

/** Tramos de un miembro: la geometría fuera del rectángulo llega como `null` y corta el tramo. */
function memberLines(geometry: (z.infer<typeof coord> | null)[]): LatLng[][] {
  const lines: LatLng[][] = [];
  let line: LatLng[] = [];
  for (const p of geometry) {
    if (p) line.push({ lat: p.lat, lng: p.lon });
    else {
      if (line.length >= 2) lines.push(line);
      line = [];
    }
  }
  if (line.length >= 2) lines.push(line);
  return lines;
}

/**
 * Encadena los tramos por sus extremos más próximos, dándoles la vuelta si hace falta. Solo une
 * extremos a menos de `CHAIN_JOIN_M`; devuelve la cadena continua más larga.
 */
export function chainLines(lines: LatLng[][]): LatLng[] {
  const pool = lines.filter((l) => l.length >= 2).map((l) => l.slice());
  let best: LatLng[] = [];
  let bestM = 0;
  while (pool.length > 0) {
    let chain = pool.shift()!;
    for (;;) {
      let pick = -1;
      let pickGap = CHAIN_JOIN_M;
      let atTail = true;
      let reverse = false;
      const head = chain[0];
      const tail = chain[chain.length - 1];
      pool.forEach((line, i) => {
        const a = line[0];
        const b = line[line.length - 1];
        const options: [number, boolean, boolean][] = [
          [gap(tail, a), true, false],
          [gap(tail, b), true, true],
          [gap(head, b), false, false],
          [gap(head, a), false, true],
        ];
        for (const [d, tailSide, rev] of options) {
          if (d <= pickGap) {
            pick = i;
            pickGap = d;
            atTail = tailSide;
            reverse = rev;
          }
        }
      });
      if (pick < 0) break;
      const [line] = pool.splice(pick, 1);
      const piece = reverse ? line.slice().reverse() : line;
      chain = atTail ? chain.concat(piece) : piece.concat(chain);
    }
    const m = lengthM(chain);
    if (m > bestM) {
      best = chain;
      bestM = m;
    }
  }
  return best;
}

/** Quita puntos repetidos o a menos de 10 m del anterior; conserva el último. */
export function thinPoints(points: LatLng[]): LatLng[] {
  if (points.length <= 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (gap(out[out.length - 1], points[i]) >= MIN_STEP_M) out.push(points[i]);
  }
  const last = points[points.length - 1];
  if (gap(out[out.length - 1], last) > 0) out.push(last);
  return out.length >= 2 ? out : [points[0], last];
}

function nearestM(points: LatLng[], start: LatLng): number {
  let near = Infinity;
  for (const p of points) near = Math.min(near, gap(p, start));
  return near;
}

/** Relaciones de Overpass a rutas utilizables, ordenadas por cercanía al inicio. */
export function parseCatalog(raw: unknown, start: LatLng): OsmRoute[] {
  const parsed = payload.safeParse(raw);
  if (!parsed.success) throw new OsmCatalogError('OpenStreetMap ha devuelto una respuesta que no se entiende.');
  if (parsed.data.remark && /runtime error|timed out|out of memory/i.test(parsed.data.remark)) {
    throw new OsmCatalogError('OpenStreetMap está saturado ahora mismo. Vuelve a probar en unos minutos.');
  }
  const routes: OsmRoute[] = [];
  for (const element of parsed.data.elements) {
    const rel = relation.safeParse(element);
    if (!rel.success) continue;
    const tags = rel.data.tags ?? {};
    if (tags.type !== 'route' || (tags.route !== 'bicycle' && tags.route !== 'mtb')) continue;
    const lines: LatLng[][] = [];
    for (const m of rel.data.members ?? []) {
      // `backward` es el otro sentido de una calzada desdoblada: contarlo duplicaría la distancia.
      if (m.type !== 'way' || !m.geometry || m.role === 'backward') continue;
      lines.push(...memberLines(m.geometry));
    }
    const points = thinPoints(chainLines(lines));
    if (points.length < 2) continue;
    const distanceM = lengthM(points);
    const nearM = nearestM(points, start);
    if (distanceM < MIN_ROUTE_M || nearM > CATALOG_RADIUS_M) continue;
    const id = rel.data.id;
    const label = tags.name?.trim() || tags.ref?.trim() || `Ruta ${tags.route === 'mtb' ? 'BTT' : 'ciclista'} ${id}`;
    routes.push({
      ref: `osm-relation-${id}`,
      name: label.slice(0, 120),
      tipo: tags.route === 'mtb' ? 'btt' : 'carretera',
      url: `https://www.openstreetmap.org/relation/${id}`,
      author: tags.operator ? `${OSM_ATTRIBUTION}; ${tags.operator.slice(0, 80)}` : OSM_ATTRIBUTION,
      points,
      distanceM,
      nearM,
    });
  }
  return routes.sort((a, b) => a.nearM - b.nearM || a.ref.localeCompare(b.ref)).slice(0, MAX_OSM_ROUTES);
}

/** POST a Overpass. Solo sale la consulta con el centro redondeado. */
export async function fetchOverpass(query: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }).toString(),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new OsmCatalogError('No se ha podido conectar con OpenStreetMap. Revisa la conexión y vuelve a probar.');
  }
  if (res.status === 429 || res.status === 504) throw new OsmCatalogError('OpenStreetMap está saturado ahora mismo. Vuelve a probar en unos minutos.');
  if (!res.ok) throw new OsmCatalogError('OpenStreetMap no ha podido responder. Vuelve a probar más tarde.');
  try {
    return await res.json();
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new OsmCatalogError('OpenStreetMap ha devuelto una respuesta que no se entiende.');
  }
}
