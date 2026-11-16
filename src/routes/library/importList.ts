import type { ReferenceSource } from './rows.ts';

/**
 * Lo que el script del administrador necesita de cada GPX de `.rutas/`: de dónde sale (origen, id y
 * URL pública) y las cifras que trae su `<desc>`. Y un literal jsonb seguro para la Management API.
 */

type NamedSource = Exclude<ReferenceSource, 'rwgps' | 'other'>;

/** Dominios de las rutas publicadas que se reconocen por su enlace. */
const SITES: { source: Exclude<ReferenceSource, 'other'>; host: RegExp; path?: RegExp }[] = [
  { source: 'rwgps', host: /(^|\.)ridewithgps\.com$/, path: /^\/routes\// },
  { source: 'wikiloc', host: /(^|\.)wikiloc\.com$/ },
  { source: 'komoot', host: /(^|\.)komoot\.(com|de)$/ },
  { source: 'bikemap', host: /(^|\.)bikemap\.net$/ },
  { source: 'strava', host: /(^|\.)strava\.com$/, path: /^\/routes\// },
];
/** URL de una ruta por su id, para los nombres `<origen>-<id>.gpx` sin enlace. Wikiloc necesita el nombre de la ruta. */
const URL_BY_ID: Partial<Record<ReferenceSource, (id: string) => string>> = {
  rwgps: id => `https://ridewithgps.com/routes/${id}`,
  komoot: id => `https://www.komoot.com/tour/${id}`,
  bikemap: id => `https://www.bikemap.net/r/${id}`,
  strava: id => `https://www.strava.com/routes/${id}`,
};

function metadataBlock(gpxText: string): string {
  return /<metadata\b[^>]*>([\s\S]*?)<\/metadata>/i.exec(gpxText)?.[1] ?? '';
}

/** `<metadata>` sin su `<author>`: el enlace del autor (`/wikiloc/user.do`) no es la ruta. */
function metadataLinks(gpxText: string): string[] {
  const withoutAuthor = metadataBlock(gpxText).replace(/<author\b[\s\S]*?<\/author>/gi, '');
  return [...withoutAuthor.matchAll(/<link\b[^>]*\bhref\s*=\s*"([^"]+)"/gi)].map(m => m[1].replace(/&amp;/g, '&'));
}

function linkSource(href: string): { source: Exclude<ReferenceSource, 'other'>; sourceId: string } | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const site = SITES.find(s => s.host.test(host) && (!s.path || s.path.test(url.pathname)));
  const id = /(\d+)\/?$/.exec(url.pathname)?.[1];
  return site && id ? { source: site.source, sourceId: id } : null;
}

/** Origen e id por el nombre: `komoot-123.gpx`, `bikemap-9.gpx`, `wikiloc-…`, `strava-…`. */
export function gpxSource(fileName: string): { source: NamedSource; sourceId: string } | null;
/**
 * Origen, id y URL de un GPX de `.rutas/`. `rwgps-<id>.gpx` es Ride with GPS; si no, el `<link>` de
 * `<metadata>` (el del autor se ignora); si no, el nombre `<origen>-<id>.gpx`. Sin nada de eso,
 * `other` con `sourceId: null` (el script usa la huella de la geometría).
 */
export function gpxSource(fileName: string, gpxText: string): { source: ReferenceSource; sourceId: string | null; url: string | null };
export function gpxSource(fileName: string, gpxText?: string): { source: ReferenceSource; sourceId: string | null; url: string | null } | { source: NamedSource; sourceId: string } | null {
  const byName = /^(komoot|bikemap|wikiloc|strava)-(\d{1,20})\.gpx$/i.exec(fileName);
  const named = byName ? { source: byName[1].toLowerCase() as NamedSource, sourceId: byName[2] } : null;
  if (gpxText === undefined) return named;
  const rwgps = /^rwgps-(\d{1,20})\.gpx$/i.exec(fileName);
  if (rwgps) return { source: 'rwgps', sourceId: rwgps[1], url: URL_BY_ID.rwgps!(rwgps[1]) };
  const links = metadataLinks(gpxText).filter(href => /^https?:\/\//i.test(href));
  for (const href of links) {
    const found = linkSource(href);
    if (found) return { ...found, url: href };
  }
  if (named) return { ...named, url: URL_BY_ID[named.source]?.(named.sourceId) ?? null };
  return { source: 'other', sourceId: null, url: links[0] ?? null };
}

/** Cifras `clave=valor` del `<desc>` de `<metadata>` (como en los `rwgps-*.gpx`). Lo que falte no sale. */
export function descFields(gpxText: string): { distanceM?: number; elevGainM?: number; unpavedPct?: number } {
  const desc = /<desc>([^<]*)<\/desc>/i.exec(metadataBlock(gpxText))?.[1] ?? '';
  const fields = new Map(desc.split(';').map(part => part.split('=').map(s => s.trim()) as [string, string | undefined]));
  const out: Record<string, number> = {};
  for (const [key, name] of [['distance_m', 'distanceM'], ['elev_gain_m', 'elevGainM'], ['unpaved_pct', 'unpavedPct']]) {
    const raw = fields.get(key);
    const value = Number(raw);
    if (raw && Number.isFinite(value) && value >= 0) out[name] = value;
  }
  return out;
}

/** `$tagN$<json>$tagN$::jsonb` con la primera etiqueta que no aparece en el JSON: no se puede cerrar desde el texto. */
export function sqlJsonLiteral(value: unknown): string {
  const json = JSON.stringify(value);
  let n = 1;
  while (json.includes(`$tag${n}$`)) n++;
  return `$tag${n}$${json}$tag${n}$::jsonb`;
}
