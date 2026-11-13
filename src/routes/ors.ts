import type { LatLng } from '../domain/types';
import { getOrsUsage, recordOrsCall } from './orsUsage';
import { ORS_ROAD_URL } from './endpoint';
import type { SharedOrsAccess } from './orsProxy';
import { buildOrsBody, orsExtras, type SharedOrsRequest } from './shared/orsService';

/** Cliente de OpenRouteService: vuelta circular de bici de carretera con la clave del usuario o por el servicio común. */

/** Clave personal de ORS (texto) o acceso por el servicio común de la cuenta (`chooseOrsAccess`). */
export type OrsAccess = string | SharedOrsAccess;

export const ORS_DAILY_LIMIT = 2000;
export const ORS_MINUTE_LIMIT = 40;
const ORS_URL = `${ORS_ROAD_URL}/geojson`;

export type RoundTripRequest = { start: LatLng; lengthM: number; points: number; seed: number; signal?: AbortSignal };

/** `values`: [índice desde, índice hasta, valor]; `amount` en %. */
export type OrsExtra = {
  values: [number, number, number][];
  summary: { value: number; distance: number; amount: number }[];
};

export type OrsFeature = {
  geometry: { type: 'LineString'; coordinates: [number, number, number][] };
  properties: {
    summary: { distance: number; duration: number; ascent?: number; descent?: number };
    /** `waycategory`: campo de bits, 1 = autopista. Opcional: las respuestas antiguas no lo traen. */
    extras: { surface: OrsExtra; waytypes: OrsExtra; steepness: OrsExtra; waycategory?: OrsExtra };
  };
};

export type OrsErrorKind = 'unreachable' | 'quota_day' | 'rate_minute' | 'no_route' | 'bad_request' | 'server' | 'session';

/** `message` es el texto que ve el usuario. */
export class OrsError extends Error {
  constructor(
    public kind: OrsErrorKind,
    message: string,
    public code?: number,
    /** Segundos hasta que el servicio vuelve a admitir consultas, si los dice. */
    public retryAfterS?: number,
  ) {
    super(message);
    this.name = 'OrsError';
  }
}

const MSG = {
  unreachable:
    'ORS no responde. Puede ser la clave, la cuota diaria (2.000 consultas) o la conexión. Comprueba la clave en Ajustes.',
  quota_day:
    'Has gastado las 2.000 consultas diarias de ORS. La cuota se renueva 24 h después de la primera consulta del día.',
  rate_minute: 'Has pasado de 40 consultas por minuto en ORS. Espera un minuto y vuelve a probar.',
  no_route: 'ORS no encuentra carreteras desde ese punto. Mueve el inicio a una carretera.',
};

/** La vuelta circular como operación del servicio común: del inicio, solo `lat` y `lng`. */
function roundTripRequest(r: RoundTripRequest): SharedOrsRequest {
  return { operation: 'round_trip', start: { lat: r.start.lat, lng: r.start.lng }, lengthM: r.lengthM, points: r.points, seed: r.seed };
}

/** El mismo cuerpo que construye el servicio común. */
export function buildRoundTripBody(r: RoundTripRequest): object {
  return buildOrsBody(roundTripRequest(r));
}

export async function fetchRoundTrip(
  access: OrsAccess,
  r: RoundTripRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<OrsFeature> {
  if (typeof access !== 'string') return access.fetch(roundTripRequest(r), r.signal);
  return fetchRoadFeature(access, buildRoundTripBody(r), r.signal, fetchImpl);
}

/** Geometría completa recalculada; no conserva segmentos del GPX original. */
export async function fetchPathFeature(access: OrsAccess, waypoints: LatLng[], signal?: AbortSignal, avoid?: LatLng[]): Promise<OrsFeature> {
  const request: SharedOrsRequest = {
    operation: 'path', waypoints: waypoints.map(p => ({ lat: p.lat, lng: p.lng })),
    ...(avoid?.length ? { avoid: avoid.map(p => ({ lat: p.lat, lng: p.lng })) } : {}),
  };
  return typeof access === 'string'
    ? fetchRoadFeature(access, buildOrsBody(request), signal)
    : access.fetch(request, signal);
}

/** Petición común: contabiliza también los conectores y las modificaciones de rutas importadas. */
export async function fetchRoadFeature(
  apiKey: string,
  requestBody: object,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<OrsFeature> {
  return (await fetchRoadFeatures(apiKey, requestBody, signal, fetchImpl))[0];
}

/** Todas las rutas de la respuesta: con `alternative_routes`, la óptima y sus alternativas. */
export async function fetchRoadFeatures(
  apiKey: string,
  requestBody: object,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<OrsFeature[]> {
  const now = Date.now();
  const previousCalls = (await getOrsUsage(now)).count;
  await recordOrsCall(now);

  let res: Response;
  try {
    res = await fetchImpl(ORS_URL, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    // El 403 de ORS llega sin cabecera CORS: el navegador solo ve un error de red.
    if (previousCalls >= ORS_DAILY_LIMIT) throw new OrsError('quota_day', MSG.quota_day);
    throw new OrsError('unreachable', MSG.unreachable);
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toOrsError(res.status, body);

  const features = (body as { features?: OrsFeature[] } | null)?.features;
  if (!features?.length) throw new OrsError('no_route', MSG.no_route);
  for (const f of features) {
    if (f?.properties) f.properties.extras = orsExtras(f.properties.extras as Record<string, unknown> | undefined) as OrsFeature['properties']['extras'];
  }
  return features;
}

/** El cuerpo de error de ORS es `{ error: { code, message } }`; el del limitador, `{ error: '...' }`. */
function toOrsError(status: number, body: unknown): OrsError {
  const error = (body as { error?: unknown } | null)?.error;
  const detail = typeof error === 'object' && error ? (error as { code?: number; message?: string }) : {};
  const { code, message } = detail;

  if (status === 429) return new OrsError('rate_minute', MSG.rate_minute, code);
  if (status === 403) return new OrsError('quota_day', MSG.quota_day, code);
  if (status === 404) return new OrsError('no_route', MSG.no_route, code);
  if (status >= 500) return new OrsError('server', `ORS ha fallado (HTTP ${status}). Vuelve a probar en unos minutos.`, code);
  const text = code !== undefined ? `ORS rechaza la petición (código ${code})` : `ORS rechaza la petición (HTTP ${status})`;
  return new OrsError('bad_request', message ? `${text}: ${message}` : `${text}.`, code);
}
