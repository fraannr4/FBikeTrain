import { z } from 'zod';
import { RouteLibraryError, analyzeReferenceRoutePoints, type RoutePoint } from '../library';

/**
 * Ride with GPS API v1 (https://ridewithgps.com/api/v1/doc). Solo se usa
 * GET /api/v1/routes/{id}.json, documentado; nunca el HTML ni /routes/*.json (robots.txt).
 * Exige x-rwgps-api-key y x-rwgps-auth-token del propio usuario. CORS no está documentado.
 */
export class RwgpsError extends Error {
  constructor(message: string) { super(message); this.name = 'RwgpsError'; }
}

export type RwgpsCredentials = { apiKey: string; authToken: string };
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

const STATUS_MESSAGES: Record<number, string> = {
  401: 'Ride with GPS rechazó la clave de API o el token de autenticación. Revísalos en Ajustes.',
  403: 'La ruta no es visible para tu cuenta de Ride with GPS (privada, o falta el privacy_code en el enlace).',
  404: 'La ruta no existe en Ride with GPS.',
  429: 'Ride with GPS limita las peticiones: espera unos minutos y vuelve a intentarlo.',
};

export async function fetchRwgpsRoute(routeUrl: string, credentials: RwgpsCredentials, fetchImpl: typeof fetch = fetch): Promise<RwgpsLibraryInput> {
  if (!credentials.apiKey.trim() || !credentials.authToken.trim()) throw new RwgpsError('Faltan la clave de API y el token de autenticación de Ride with GPS.');
  const ref = parseRwgpsRouteId(routeUrl);
  if (!ref) throw new RwgpsError('El enlace no es de una ruta de Ride with GPS (https://ridewithgps.com/routes/…).');
  const query = ref.privacyCode ? `?privacy_code=${encodeURIComponent(ref.privacyCode)}` : '';
  let response: Response;
  try {
    response = await fetchImpl(`https://ridewithgps.com/api/v1/routes/${ref.id}.json${query}`, {
      headers: { 'x-rwgps-api-key': credentials.apiKey.trim(), 'x-rwgps-auth-token': credentials.authToken.trim() },
    });
  } catch {
    throw new RwgpsError('No se pudo contactar con Ride with GPS (red o bloqueo CORS del navegador).');
  }
  if (!response.ok) throw new RwgpsError(STATUS_MESSAGES[response.status] ?? `Ride with GPS respondió con el error ${response.status}.`);
  return rwgpsRouteToLibraryInput(await response.json().catch(() => null), `https://ridewithgps.com/routes/${ref.id}`);
}
