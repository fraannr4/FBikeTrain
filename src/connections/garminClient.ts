import { z } from 'zod';
import { ACCOUNT_PROJECT_URL, ACCOUNT_PUBLIC_KEY } from '../auth/config';
import type { ReferenceRoute } from '../routes/library';

/** Apagado hasta que Garmin apruebe la aplicación y el servidor tenga sus claves. */
export const garminEnabled = () => import.meta.env.VITE_GARMIN_ENABLED === 'true';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const statusSchema = z.object({
  available: z.boolean(), connected: z.boolean(), backfillAvailable: z.boolean(), lastSyncAt: z.number().nonnegative().optional(),
  receptionAvailable: z.boolean().optional(),
  courseAvailable: z.boolean().optional(),
  permissionRequired: z.boolean().optional(),
});
const entrySchema = z.object({ id, deviceName: z.string().max(200).optional(), createdAt: z.number().nonnegative() });
const listSchema = z.object({ activities: z.array(entrySchema).max(1000), backfillAvailable: z.boolean() });
export type GarminStatus = z.infer<typeof statusSchema>;
export type GarminEntry = z.infer<typeof entrySchema>;
export type GarminClient = ReturnType<typeof createGarminClient>;
export type GarminCourse = { name: string; distanceM: number; elevationGainM: number; elevationLossM: number; points: { lat: number; lng: number; ele?: number }[] };

/** Lo que recibe el servidor para publicar el recorrido en Garmin Connect. Sin altura conocida, desnivel 0. */
export function courseFromRoute(route: ReferenceRoute): GarminCourse {
  return { name: route.name.trim().slice(0, 100) || 'Ruta FBikeTrain', distanceM: route.summary.distanceM,
    elevationGainM: route.summary.elevGainM ?? 0, elevationLossM: route.summary.elevLossM ?? 0,
    points: route.points.map(p => ({ lat: p.lat, lng: p.lng, ...(p.ele === undefined ? {} : { ele: p.ele }) })) };
}

/** Nunca recibe tokens Garmin: sólo la sesión de FBikeTrain para su propia Edge Function. */
export function createGarminClient(getToken: () => Promise<string | null>, fetcher: typeof fetch = fetch) {
  async function request<T>(path: string, signal: AbortSignal, method: string, consume: (response: Response) => Promise<T>, body?: unknown): Promise<T> {
    signal.throwIfAborted();
    const token = await getToken();
    signal.throwIfAborted();
    if (!token) throw new Error('Tu sesión ha caducado. Vuelve a iniciar sesión.');
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      let response: Response;
      try { response = await fetcher(`${ACCOUNT_PROJECT_URL}/functions/v1/garmin/${path}`, {
        method, signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, apikey: ACCOUNT_PUBLIC_KEY, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      }); } catch {
        signal.throwIfAborted();
        throw new Error('No se pudo contactar con Garmin. Revisa la conexión y vuelve a intentarlo.');
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 401) throw new Error('Tu sesión ha caducado. Vuelve a iniciar sesión.');
        if (response.status === 403) throw new Error('Garmin no ha dado permiso para esta operación. Revisa los permisos de FBikeTrain en Garmin Connect.');
        throw new Error('Garmin no está disponible ahora. Reintenta más tarde.');
      }
      return await consume(response);
    } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
  }
  async function json(path: string, signal: AbortSignal, method?: string, body?: unknown): Promise<unknown> {
    return request(path, signal, method ?? 'GET', async response => {
      const bytes = await readBounded(response, 512_000);
      try { return JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw new Error('La respuesta del conector Garmin no tiene el formato esperado.'); }
    }, body);
  }
  return {
    async status(signal: AbortSignal): Promise<GarminStatus> {
      return statusSchema.parse(await json('status', signal));
    },
    async connect(signal: AbortSignal): Promise<string> {
      const data = z.object({ authorizationUrl: z.string().url() }).parse(await json('connect', signal, 'POST'));
      const url = new URL(data.authorizationUrl);
      if (url.origin !== 'https://connect.garmin.com' || url.pathname !== '/oauth2Confirm' || url.username || url.password) {
        throw new Error('El conector no devolvió la pantalla oficial de Garmin.');
      }
      return url.href;
    },
    async disconnect(signal: AbortSignal): Promise<void> { await request('disconnect', signal, 'POST', async response => { await response.body?.cancel(); }); },
    async sendCourse(course: GarminCourse, signal: AbortSignal): Promise<{ courseId: number | string }> {
      return z.object({ courseId: z.union([z.number(), z.string()]) }).parse(await json('course', signal, 'POST', course));
    },
    async list(signal: AbortSignal) { return listSchema.parse(await json('activities', signal)); },
    async file(activityId: string, signal: AbortSignal): Promise<File> {
      const safeId = id.parse(activityId);
      return request(`activities/${safeId}/file`, signal, 'GET', async response => {
        const bytes = await readBounded(response, 20 * 1024 * 1024);
        if (!bytes.length) throw new Error('Garmin no entregó el archivo original.');
        return new File([bytes], `garmin-${safeId}.fit`, { type: 'application/octet-stream' });
      });
    },
  };
}

async function readBounded(response: Response, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Garmin devolvió una respuesta vacía.');
  const parts: Uint8Array[] = []; let length = 0;
  try {
    if (Number(response.headers.get('content-length')) > max) throw new Error('La respuesta Garmin supera el tamaño permitido.');
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) throw new Error('La respuesta Garmin supera el tamaño permitido.');
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
