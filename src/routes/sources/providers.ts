import { buildOverpassQuery, parseOverpass } from './overpass.ts';
import { assertPublicHtml, parsePublicGpx, parseWikilocDetail, safeWikilocUrl, wikilocLinks } from './wikiloc.ts';
import { RouteSourceError, type RouteReference, type RouteSearch } from './schema.ts';

export const SOURCE_USER_AGENT = 'FBikeTrain-RouteSources/1.0 (+https://github.com/fraannr4/FBikeTrain)';
export type SourceTransport = (url: string, init?: RequestInit) => Promise<string>;

/** URL de búsqueda confirmada en el permiso de Wikiloc, nunca recibida del cliente. */
export function wikilocSearchUrl(template: string, input: RouteSearch): string {
  if (!['{lat}', '{lon}', '{radiusM}'].every(key => template.includes(key))
    && !['{south}', '{north}', '{west}', '{east}'].every(key => template.includes(key))) throw new RouteSourceError('unavailable');
  const dy = input.radiusM / 111_195;
  const dx = dy / Math.cos(input.lat * Math.PI / 180);
  if (Math.abs(input.lon) + dx > 180) throw new RouteSourceError('unavailable');
  const values: Record<string, number> = { ...input, south: input.lat - dy, north: input.lat + dy, west: input.lon - dx, east: input.lon + dx };
  const expanded = template.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(String(values[key])));
  const url = safeWikilocUrl(expanded);
  if (!url || /undefined|\{|\}/.test(expanded)) throw new RouteSourceError('unavailable');
  return url;
}

export async function loadWikiloc(input: RouteSearch, fetchedAt: string, transport: SourceTransport, template: string): Promise<RouteReference[]> {
  const html = await transport(wikilocSearchUrl(template, input));
  const urls = wikilocLinks(html);
  const references: RouteReference[] = [];
  for (const url of urls) {
    try {
      const { reference, gpxUrl } = parseWikilocDetail(await transport(url), url, fetchedAt);
      references.push(reference);
      if (gpxUrl) {
        try {
          const gpx = await transport(gpxUrl);
          assertPublicHtml(gpx);
          reference.geometry = parsePublicGpx(gpx);
        } catch (error) {
          if (error instanceof RouteSourceError && ['blocked', 'html_changed', 'busy', 'cancelled'].includes(error.code)) throw error;
          // Un GPX público inválido conserva la ficha sin geometría.
        }
      }
    } catch (error) {
      // No insistir tras bloqueo/cambio: conservar incluso la ficha cuyo GPX falló.
      if (error instanceof RouteSourceError && ['blocked', 'html_changed'].includes(error.code)) {
        if (!references.length) throw error;
        break;
      }
      throw error;
    }
  }
  return references;
}

export async function loadOverpass(input: RouteSearch, fetchedAt: string, transport: SourceTransport): Promise<RouteReference[]> {
  const text = await transport('https://overpass-api.de/api/interpreter', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: buildOverpassQuery(input) }) });
  try { return parseOverpass(JSON.parse(text), input, fetchedAt); }
  catch { throw new RouteSourceError('invalid_response'); }
}

export async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new RouteSourceError('invalid_response');
  let text = '', size = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new RouteSourceError('invalid_response'); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

/** Cada salto HTTP se cuenta; se rechazan redirecciones para no seguir login/captchas. */
export function sourceTransport(source: 'wikiloc' | 'osm', deps: {
  fetch: typeof fetch; claim: (source: 'wikiloc' | 'osm') => Promise<boolean>; signal: AbortSignal;
}): SourceTransport {
  let lastRequest = 0;
  return async (url, init) => {
    deps.signal.throwIfAborted();
    if (source === 'wikiloc' && !safeWikilocUrl(url)) throw new RouteSourceError('blocked');
    const delay = Math.max(0, lastRequest + 1050 - Date.now());
    if (delay) await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new RouteSourceError('cancelled')); };
      const timer = setTimeout(() => { deps.signal.removeEventListener('abort', abort); resolve(); }, delay);
      deps.signal.addEventListener('abort', abort, { once: true });
      if (deps.signal.aborted) abort();
    });
    deps.signal.throwIfAborted();
    if (!await deps.claim(source)) throw new RouteSourceError('busy');
    deps.signal.throwIfAborted();
    lastRequest = Date.now();
    const response = await deps.fetch(url, { ...init, redirect: 'manual', credentials: 'omit', signal: deps.signal,
      headers: { ...Object.fromEntries(new Headers(init?.headers)), 'User-Agent': SOURCE_USER_AGENT, Accept: source === 'osm' ? 'application/json' : 'text/html,application/gpx+xml,application/xml' } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new RouteSourceError(response.status === 429 ? 'busy' : 'blocked');
    }
    return readLimited(response, source === 'osm' ? 8_000_000 : 2_000_000);
  };
}
