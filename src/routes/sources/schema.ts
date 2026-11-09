import { z } from 'zod';

export const routeSearchSchema = z.strictObject({
  lat: z.number().finite().min(-85).max(85),
  lon: z.number().finite().min(-180).max(180),
  radiusM: z.number().int().min(100).max(25_000),
});
export type RouteSearch = z.infer<typeof routeSearchSchema>;
const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
// GeoJSON; no se unen segmentos separados con líneas inventadas.
export const routeReferenceSchema = z.strictObject({
  source: z.enum(['wikiloc', 'osm']),
  url: z.url().refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port;
    } catch { return false; }
  }),
  author: z.string().trim().min(1).max(300),
  name: z.string().trim().min(1).max(500),
  distanceM: z.number().finite().positive().max(20_000_000),
  // null significa que la fuente no ofrece elevación, nunca se inventa un cero.
  ascentM: z.number().finite().nonnegative().max(200_000).nullable(),
  geometry: z.strictObject({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(position).min(2).max(50_000)).min(1).max(500) }).optional(),
  fetchedAt: z.iso.datetime(),
}).superRefine((route, ctx) => {
  let url: URL;
  try { url = new URL(route.url); }
  catch { ctx.addIssue({ code: 'custom', message: 'URL no válida', path: ['url'] }); return; }
  const valid = route.source === 'wikiloc'
    ? ['es.wikiloc.com', 'www.wikiloc.com'].includes(url.hostname) && /^\/(rutas-ciclismo|road-biking-trails)\/[^/]+-\d+$/.test(url.pathname)
    : url.hostname === 'www.openstreetmap.org' && /^\/relation\/\d+$/.test(url.pathname);
  if (!valid) ctx.addIssue({ code: 'custom', message: 'Enlace de origen no válido', path: ['url'] });
});
export type RouteReference = z.infer<typeof routeReferenceSchema>;
export const routeReferencesSchema = z.array(routeReferenceSchema).max(10);
export class RouteSourceError extends Error {
  constructor(public readonly code: 'unavailable' | 'blocked' | 'html_changed' | 'invalid_response' | 'busy' | 'cancelled') { super(code); }
}
