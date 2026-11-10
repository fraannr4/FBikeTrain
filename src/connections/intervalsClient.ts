import { z } from 'zod';

export type IntervalsCredentials = { athleteId: string; apiKey: string };
export type IntervalsFetch = (url: string, options: RequestInit) => Promise<Response>;
const activitySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  start_date_local: z.string().optional(),
  start_date: z.string().optional(),
  type: z.string().optional(),
  source: z.string().optional(),
  device_name: z.string().nullable().optional(),
  file_type: z.string().nullable().optional(),
});
export type IntervalsActivity = z.infer<typeof activitySchema>;

export class IntervalsError extends Error {
  constructor(message: string, readonly retryAt?: number, readonly stopBatch = true) { super(message); }
}

export function validateCredentials(input: IntervalsCredentials): IntervalsCredentials {
  const athleteId = input.athleteId.trim();
  const apiKey = input.apiKey.trim();
  if (!/^i?\d{1,20}$/.test(athleteId)) throw new IntervalsError('Pega tu athlete id completo, por ejemplo i12345, o usa 0 para tu propia cuenta.');
  if (!/^[\x21-\x7e]{8,256}$/.test(apiKey)) throw new IntervalsError('Pega una clave de API válida de Intervals.icu.');
  return { athleteId, apiKey };
}

/** Lee con límite también cuando Content-Length no está presente o es incorrecto. */
async function readBytes(response: Response, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader();
  if (!reader) throw new IntervalsError('Intervals.icu devolvió un archivo vacío.');
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    if (Number(response.headers.get('content-length')) > max) throw new IntervalsError('La respuesta supera el tamaño permitido. Importa el archivo manualmente.');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) throw new IntervalsError('La respuesta supera el tamaño permitido. Importa el archivo manualmente.');
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

export function createIntervalsClient(credentials: IntervalsCredentials, signal: AbortSignal, fetcher: IntervalsFetch = fetch) {
  const { athleteId, apiKey } = validateCredentials(credentials);
  // URL fija, sin credenciales en query, sin cookies, redirecciones ni contenido remoto en errores.
  let lastRequestAt = 0;
  async function request(path: string, maxBytes: number): Promise<Uint8Array> {
    signal.throwIfAborted();
    const delay = Math.max(0, 150 - (Date.now() - lastRequestAt));
    if (delay) await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
      signal.addEventListener('abort', abort, { once: true });
    });
    signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      lastRequestAt = Date.now();
      const response = await fetcher(`https://intervals.icu/api/v1/${path}`, {
        headers: { Authorization: `Basic ${btoa(`API_KEY:${apiKey}`)}` },
        credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const seconds = Number(retry);
        const retryAt = retry && Number.isFinite(seconds)
          ? Date.now() + Math.max(60, seconds) * 1000
          : Math.max(Date.now() + 60_000, Date.parse(retry ?? '') || 0);
        throw new IntervalsError('Intervals.icu ha limitado las peticiones. Espera antes de volver a intentarlo.', retryAt);
      }
      if (response.status === 401) throw new IntervalsError('La clave de Intervals.icu no es válida o ha caducado.');
      if (response.status === 403) throw new IntervalsError('Intervals.icu no permite acceder a estos datos. Revisa los permisos y la fuente de los datos.');
      if (!response.ok) throw new IntervalsError(`No se pudo descargar desde Intervals.icu (HTTP ${response.status}).`, undefined, false);
      return await readBytes(response, maxBytes);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof IntervalsError) throw error;
      throw new IntervalsError('No se pudo contactar con Intervals.icu. Revisa la conexión y los permisos del navegador (CORS).');
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
  return {
    async activities(oldest: string, newest: string): Promise<IntervalsActivity[]> {
      const query = new URLSearchParams({ oldest, newest, fields: 'id,start_date,start_date_local,type,source,file_type,device_name' });
      const bytes = await request(`athlete/${athleteId}/activities?${query}`, 5 * 1024 * 1024);
      try { return z.array(activitySchema).parse(JSON.parse(new TextDecoder().decode(bytes))); }
      catch { throw new IntervalsError('La lista de actividades de Intervals.icu no tiene el formato esperado.'); }
    },
    async file(activity: IntervalsActivity): Promise<File> {
      const type = activity.file_type?.toLowerCase().replace(/^\./, '');
      if (!type || !/^(fit|gpx|tcx)(\.gz)?$/.test(type)) throw new IntervalsError('Esta actividad no tiene un original FIT, GPX o TCX compatible.', undefined, false);
      const bytes = await request(`activity/${encodeURIComponent(activity.id)}/file`, 20 * 1024 * 1024);
      const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
      const extension = type.replace(/\.gz$/, '') + (gzip ? '.gz' : '');
      return new File([new Uint8Array(bytes)], `intervals-${activity.id}.${extension}`, { type: 'application/octet-stream' });
    },
  };
}
