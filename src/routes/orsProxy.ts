import type { SupabaseClient } from '@supabase/supabase-js';
import { ACCOUNT_PROJECT_URL, ACCOUNT_PUBLIC_KEY } from '../auth/config';
import { OrsError, type OrsAccess, type OrsFeature } from './ors';
import type { SharedOrsRequest } from './shared/orsService';

/**
 * Motor de carreteras compartido: la función `ors-proxy` llama a ORS con la clave del servidor.
 * Activar solo cuando la función y su cuota estén desplegadas (variable del repositorio).
 */
export const sharedOrsEnabled = () => import.meta.env.VITE_SHARED_ORS_ENABLED === 'true';

export type SharedOrsAccess = {
  kind: 'shared';
  fetch: (request: SharedOrsRequest, signal?: AbortSignal) => Promise<OrsFeature>;
  /** Todas las rutas de la respuesta (trayecto con alternativas). */
  fetchAll: (request: SharedOrsRequest, signal?: AbortSignal) => Promise<OrsFeature[]>;
};

/** Límites por usuario de `consume_shared_ors_quota`. */
const USER_DAY = 150;
const USER_MINUTE = 30;
/** Para la interfaz: los límites del servicio común que ve cada persona. */
export const SHARED_ORS_LIMITS = `hasta ${USER_DAY} consultas al día y ${USER_MINUTE} por minuto por persona`;

const MSG = {
  session: 'Tu sesión ha caducado. Vuelve a iniciar sesión para calcular rutas.',
  unreachable: 'No se pudo conectar con el servicio común de rutas. Revisa la conexión y vuelve a probar.',
  unavailable: 'El servicio común de rutas no está disponible ahora. Prueba más tarde o usa tu propia clave en Ajustes, apartado Avanzado.',
  no_route: 'ORS no encuentra carreteras desde ese punto. Mueve el inicio a una carretera.',
  server: 'El motor de rutas no ha podido calcular esta ruta. Vuelve a probar en unos minutos.',
  bad_request: 'El servicio común de rutas no admite esta petición.',
};

function quotaError(retryAfterS: number): OrsError {
  if (retryAfterS > 60) {
    const hours = Math.max(1, Math.round(retryAfterS / 3600));
    return new OrsError('quota_day', `Se ha llegado al límite diario del servicio común de rutas (${USER_DAY} consultas al día por persona, o el total compartido). Se renueva en unas ${hours} h; mientras, puedes usar tu propia clave en Ajustes, apartado Avanzado.`);
  }
  return new OrsError('rate_minute', `El servicio común de rutas admite ${USER_MINUTE} consultas por minuto por persona. Espera ${Math.max(1, Math.ceil(retryAfterS))} s y vuelve a probar.`, undefined, retryAfterS);
}

/** Mismo papel que `fetchRoadFeature`, pero con la sesión en lugar de la clave y la operación en lugar del cuerpo de ORS. */
export async function fetchSharedRoadFeature(
  getToken: () => Promise<string | null>,
  request: SharedOrsRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<OrsFeature> {
  return (await fetchSharedRoadFeatures(getToken, request, signal, fetchImpl))[0];
}

/** Como `fetchSharedRoadFeature`, con todas las rutas de la respuesta. */
export async function fetchSharedRoadFeatures(
  getToken: () => Promise<string | null>,
  request: SharedOrsRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<OrsFeature[]> {
  if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
  const token = await getToken();
  if (!token) throw new OrsError('session', MSG.session);
  let res: Response;
  try {
    res = await fetchImpl(`${ACCOUNT_PROJECT_URL}/functions/v1/ors-proxy`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: ACCOUNT_PUBLIC_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(request), signal,
    });
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e;
    throw new OrsError('unreachable', MSG.unreachable);
  }
  const body = (await res.json().catch(() => null)) as { data?: { features?: OrsFeature[] }; retryAfterS?: unknown } | null;
  if (!res.ok) {
    if (res.status === 401) throw new OrsError('session', MSG.session, res.status);
    if (res.status === 429) {
      const seconds = Number(body?.retryAfterS ?? res.headers.get('retry-after'));
      throw quotaError(Number.isFinite(seconds) && seconds > 0 ? seconds : 60);
    }
    if (res.status === 503) throw new OrsError('unreachable', MSG.unavailable, res.status);
    if (res.status === 404) throw new OrsError('no_route', MSG.no_route, res.status);
    if (res.status === 400 || res.status === 413) throw new OrsError('bad_request', MSG.bad_request, res.status);
    throw new OrsError('server', MSG.server, res.status);
  }
  const features = body?.data?.features;
  if (!features?.length || !features.every(f => Array.isArray(f?.geometry?.coordinates))) throw new OrsError('no_route', MSG.no_route);
  return features;
}

export function sharedOrsAccess(getToken: () => Promise<string | null>, fetchImpl: typeof fetch = fetch): SharedOrsAccess {
  return {
    kind: 'shared',
    fetch: (request, signal) => fetchSharedRoadFeature(getToken, request, signal, fetchImpl),
    fetchAll: (request, signal) => fetchSharedRoadFeatures(getToken, request, signal, fetchImpl),
  };
}

/** Token de la sesión actual, o `null` si no hay. */
export function sessionToken(client: SupabaseClient): () => Promise<string | null> {
  return async () => {
    const { data, error } = await client.auth.getSession();
    return error ? null : data.session?.access_token ?? null;
  };
}

/** Con cuenta y el modo compartido activado, por el servidor; si no, con la clave personal de Ajustes. */
export function chooseOrsAccess(apiKey: string, account: { client: SupabaseClient } | null, enabled = sharedOrsEnabled()): OrsAccess {
  return enabled && account ? sharedOrsAccess(sessionToken(account.client)) : apiKey;
}

/** Hay con qué pedir carreteras: el servicio común o una clave personal. */
export function hasOrsAccess(access: OrsAccess): boolean {
  return typeof access !== 'string' || access.trim() !== '';
}
