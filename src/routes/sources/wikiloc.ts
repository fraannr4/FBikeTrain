import { DOMParser } from '@xmldom/xmldom';
import { routeReferenceSchema, RouteSourceError, type RouteReference } from './schema.ts';

function decode(text: string): string {
  return text.replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => {
    const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
    return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
  }).replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, key: string) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[key] ?? '');
}
const plain = (html: string) => decode(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
export function assertPublicHtml(html: string): void {
  if (/g-recaptcha|cf-chl-|verify you are human|captcha|access denied|<title[^>]*>[^<]*(?:login|iniciar sesi[oó]n)/i.test(html)) throw new RouteSourceError('blocked');
}
export function safeWikilocUrl(value: string, base = 'https://es.wikiloc.com'): string | undefined {
  try {
    const url = new URL(decode(value), base);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !['es.wikiloc.com', 'www.wikiloc.com'].includes(url.hostname)) return;
    return url.href;
  } catch { return; }
}
const hrefs = (html: string) => [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
export function wikilocLinks(html: string): string[] {
  assertPublicHtml(html);
  const urls = [...new Set(hrefs(html).map(href => safeWikilocUrl(href)).filter((url): url is string => Boolean(url && /^\/(rutas-ciclismo|road-biking-trails)\/[^/]+-\d+$/.test(new URL(url).pathname))))].slice(0, 3);
  if (!urls.length && !/no (?:se han encontrado|hay) rutas|no trails found|id=["']no-results["']/i.test(html)) throw new RouteSourceError('html_changed');
  return urls;
}
function quantity(value: string): number {
  // Página en castellano; puntos de miles y coma decimal.
  return Number(value.replace(/\./g, '').replace(',', '.').replace(/\s/g, ''));
}
export function parseWikilocDetail(html: string, url: string, fetchedAt: string): { reference: RouteReference; gpxUrl?: string } {
  assertPublicHtml(html);
  const text = plain(html);
  const name = plain(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '');
  const authorSection = /<(h[2-4])\b[^>]*>\s*Autor\s*<\/\1>([\s\S]*?)(?=<h[1-4]\b|$)/i.exec(html)?.[2] ?? '';
  const author = plain(/<a\b[^>]*href=["'][^"']*\/wikiloc\/user\.do\?[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(authorSection)?.[1] ?? '');
  const distance = /\bDistancia\s+([\d.,\s]+?)\s*(km|m)\b/i.exec(text);
  const ascent = /Desnivel (?:positivo|\+)\s+([\d.,\s]+?)\s*m\b/i.exec(text);
  if (!name || !author || !distance || !ascent) throw new RouteSourceError('html_changed');
  const parsed = routeReferenceSchema.safeParse({ source: 'wikiloc', url, author, name,
    distanceM: quantity(distance[1]) * (distance[2].toLowerCase() === 'km' ? 1000 : 1), ascentM: quantity(ascent[1]), fetchedAt });
  if (!parsed.success) throw new RouteSourceError('html_changed');
  // Solo enlaces .gpx explícitos: nunca endpoints privados, formularios o descarga autenticada.
  const gpxUrl = hrefs(html).map(href => safeWikilocUrl(href, url)).find(href => href && /\.gpx$/i.test(new URL(href).pathname) && !/login|premium|register/i.test(new URL(href).pathname) && !new URL(href).search);
  return { reference: parsed.data, ...(gpxUrl ? { gpxUrl } : {}) };
}
export function parsePublicGpx(xml: string): NonNullable<RouteReference['geometry']> {
  if (xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new RouteSourceError('invalid_response');
  try {
    const doc = new DOMParser({ onError: () => { throw new Error('xml'); } }).parseFromString(xml, 'application/xml');
    if (doc.documentElement?.localName !== 'gpx') throw new Error('gpx');
    const tracks = Array.from(doc.getElementsByTagNameNS('*', 'trkseg'));
    const segments = tracks.length ? tracks : Array.from(doc.getElementsByTagNameNS('*', 'rte'));
    const coordinates = segments.map(segment => Array.from(segment.getElementsByTagNameNS('*', tracks.length ? 'trkpt' : 'rtept')).map(p => {
      const lat = p.getAttribute('lat'), lon = p.getAttribute('lon');
      if (lat === null || lon === null || !lat.trim() || !lon.trim()) throw new Error('point');
      return [Number(lon), Number(lat)];
    }));
    const geometry = { type: 'MultiLineString' as const, coordinates };
    // Reutiliza las restricciones GeoJSON del contrato sin duplicarlas.
    const schema = routeReferenceSchema.shape.geometry;
    return schema.parse(geometry)!;
  } catch { throw new RouteSourceError('invalid_response'); }
}
