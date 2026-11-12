import { z } from 'zod';
import { RouteLibraryError, analyzeReferenceRoutePoints, type RoutePoint } from '../library';

/**
 * Ride with GPS API v1 (https://ridewithgps.com/api/v1/doc), leída por la función `rwgps` con la cuenta común.
 * Solo GET /api/v1/routes/{id}.json y /collections/{id}.json; nunca el HTML ni /routes/*.json (robots.txt).
 */
export class RwgpsError extends Error {
  /** `fatal`: no tiene sentido seguir con el resto del lote (sesión, cuota o servicio). */
  constructor(message: string, readonly fatal = false) { super(message); this.name = 'RwgpsError'; }
}

export type RwgpsLibraryInput = { name: string; points: RoutePoint[]; sourceUrl: string; author: string; distanceM: number; elevGainM: number | null };

const trackPoint = z.object({ x: z.number(), y: z.number(), e: z.number().optional() });
const responseSchema = z.object({
  route: z.object({
    name: z.string().optional(),
    user: z.object({ name: z.string().nullish() }).nullish(),
    track_points: z.array(trackPoint).min(2),
  }),
});

export function parseRwgpsRouteId(value: string): { id: string; privacyCode?: string } | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || !/^(www\.)?ridewithgps\.com$/.test(url.hostname)) return null;
  const match = /^\/routes\/(\d+)(?:[-/].*)?$/.exec(url.pathname);
  if (!match) return null;
  const privacyCode = url.searchParams.get('privacy_code');
  return privacyCode ? { id: match[1], privacyCode } : { id: match[1] };
}

export function rwgpsRouteToLibraryInput(json: unknown, sourceUrl: string): RwgpsLibraryInput {
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) throw new RwgpsError('Ride with GPS devolvió una ruta sin track utilizable.');
  const { route } = parsed.data;
  const points: RoutePoint[] = route.track_points.map(p => (p.e === undefined ? { lat: p.y, lng: p.x } : { lat: p.y, lng: p.x, ele: p.e }));
  try {
    const summary = analyzeReferenceRoutePoints(points);
    return { name: route.name?.trim() || 'Ruta de Ride with GPS', points, sourceUrl, author: route.user?.name?.trim() || 'Ride with GPS', distanceM: summary.distanceM, elevGainM: summary.elevGainM };
  } catch (error) {
    if (error instanceof RouteLibraryError) throw new RwgpsError(error.message);
    throw error;
  }
}
