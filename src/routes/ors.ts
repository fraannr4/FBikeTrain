import type { LatLng } from '../domain/types';
import { getOrsUsage, recordOrsCall } from './orsUsage';

/** Cliente de OpenRouteService: vuelta circular de bici de carretera con la clave del usuario. */

export const ORS_DAILY_LIMIT = 2000;
export const ORS_MINUTE_LIMIT = 40;
const ORS_URL = 'https://api.openrouteservice.org/v2/directions/cycling-road/geojson';

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
    extras: { surface: OrsExtra; waytypes: OrsExtra; steepness: OrsExtra };
  };
};

export type OrsErrorKind = 'unreachable' | 'quota_day' | 'rate_minute' | 'no_route' | 'bad_request' | 'server';

/** `message` es el texto que ve el usuario. */
export class OrsError extends Error {
  constructor(
    public kind: OrsErrorKind,
    message: string,
    public code?: number,
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

export function buildRoundTripBody(r: RoundTripRequest): object {
  return {
    coordinates: [[r.start.lng, r.start.lat]],
    elevation: true,
    instructions: false,
    extra_info: ['surface', 'waytype', 'steepness'],
    options: {
      round_trip: { length: r.lengthM, points: r.points, seed: r.seed },
      avoid_features: ['ferries', 'fords', 'steps'],
    },
  };
}

export async function fetchRoundTrip(
  apiKey: string,
  r: RoundTripRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<OrsFeature> {
  const now = Date.now();
  const previousCalls = (await getOrsUsage(now)).count;
  await recordOrsCall(now);

  let res: Response;
  try {
    res = await fetchImpl(ORS_URL, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRoundTripBody(r)),
      signal: r.signal,
    });
  } catch (e) {
    if (r.signal?.aborted) throw e;
    // El 403 de ORS llega sin cabecera CORS: el navegador solo ve un error de red.
    if (previousCalls >= ORS_DAILY_LIMIT) throw new OrsError('quota_day', MSG.quota_day);
    throw new OrsError('unreachable', MSG.unreachable);
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toOrsError(res.status, body);

  const feature = (body as { features?: OrsFeature[] } | null)?.features?.[0];
  if (!feature) throw new OrsError('no_route', MSG.no_route);
  return feature;
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
