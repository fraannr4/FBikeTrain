import type { Element } from '@xmldom/xmldom';
import { db } from '../db/db';
import type { Coord3 } from '../domain/types';
import { haversineM } from '../import/summary';
import { child, descendants, parseXml, text, toNumber } from '../import/xml';
import { toGpx } from './gpx';

/** Recorridos de referencia: no son actividades realizadas y no contienen tiempos ni sensores. */
export type RoutePoint = { lat: number; lng: number; ele?: number };
export type ReferenceRouteSummary = {
  distanceM: number;
  /** null si falta altura en cualquiera de los puntos; no se interpola ni inventa. */
  elevGainM: number | null;
  elevLossM: number | null;
  /** Cierre geométrico exacto (mismas coordenadas inicial/final), no proximidad visual. */
  closed: boolean;
  pointCount: number;
};
export type ReferenceRoute = {
  id: string;
  name: string;
  format: 'gpx' | 'tcx';
  sourceFileName: string;
  sourceUrl?: string;
  originalXml: string;
  originalPoints: RoutePoint[];
  points: RoutePoint[];
  summary: ReferenceRouteSummary;
  createdAt: number;
  updatedAt: number;
};
export type ParsedReferenceRoute = Omit<ReferenceRoute, 'id' | 'createdAt' | 'updatedAt'>;

// Límites de esta primera versión: evitan XML enormes y tracks ambiguos sin red de carreteras.
export const MAX_REFERENCE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_REFERENCE_POINTS = 50_000;
export const MAX_REFERENCE_GAP_M = 5_000;
/** Margen amplio que incluye alturas terrestres; rechaza desbordamientos y valores corruptos. */
export const MAX_REFERENCE_ELEVATION_M = 12_000;
export const REFERENCE_ROUTE_GEOMETRY_NOTICE = 'Un track detallado describe su geometría, pero no verifica el firme, los sentidos de circulación ni la accesibilidad actual de la vía.';

export class RouteLibraryError extends Error {
  constructor(message: string) { super(message); this.name = 'RouteLibraryError'; }
}

const copy = (points: RoutePoint[]) => points.map(point => ({ ...point }));
const same = (a: RoutePoint, b: RoutePoint) => a.lat === b.lat && a.lng === b.lng;

export function analyzeReferenceRoutePoints(points: RoutePoint[]): ReferenceRouteSummary {
  if (!Array.isArray(points) || points.length < 2) throw new RouteLibraryError('La ruta necesita al menos dos puntos.');
  if (points.length > MAX_REFERENCE_POINTS) throw new RouteLibraryError('La ruta supera el límite de 50.000 puntos.');
  let distanceM = 0;
  let gain = 0;
  let loss = 0;
  let allElevation = true;
  points.forEach((point, index) => {
    if (!point || !Number.isFinite(point.lat) || Math.abs(point.lat) > 90 || !Number.isFinite(point.lng) || Math.abs(point.lng) > 180) {
      throw new RouteLibraryError('La ruta contiene coordenadas ausentes o no válidas.');
    }
    if (point.ele !== undefined && (!Number.isFinite(point.ele) || Math.abs(point.ele) > MAX_REFERENCE_ELEVATION_M)) throw new RouteLibraryError('La ruta contiene una altura no válida.');
    if (point.ele === undefined) allElevation = false;
    if (index === 0) return;
    const previous = points[index - 1];
    const gap = haversineM(previous.lat, previous.lng, point.lat, point.lng);
    if (gap > MAX_REFERENCE_GAP_M) throw new RouteLibraryError('Hay un salto de más de 5 km entre puntos. Usa un track más detallado o calcula la conexión por carretera.');
    distanceM += gap;
    if (point.ele !== undefined && previous.ele !== undefined) {
      const difference = point.ele - previous.ele;
      if (difference > 0) gain += difference;
      else loss -= difference;
    }
  });
  if (distanceM <= 0) throw new RouteLibraryError('La ruta no contiene un recorrido con distancia.');
  return { distanceM, elevGainM: allElevation ? gain : null, elevLossM: allElevation ? loss : null, closed: same(points[0], points[points.length - 1]), pointCount: points.length };
}

function sourceLink(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new RouteLibraryError('El enlace de origen no es válido.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new RouteLibraryError('Usa un enlace de origen HTTP o HTTPS sin credenciales.');
  return url.href;
}

function numberField(value: string | null | undefined, field: string): number {
  const number = toNumber(value);
  if (number === undefined) throw new RouteLibraryError(`La ruta contiene ${field} ausente o no válido.`);
  return number;
}

function elevation(value: string | undefined): { ele?: number } {
  if (value === undefined || !value.trim()) return {};
  return { ele: numberField(value, 'una altura') };
}

function oneTrack(groups: Element[][]): Element[] {
  const used = groups.filter(group => group.length > 0);
  if (used.length !== 1) throw new RouteLibraryError(used.length === 0 ? 'El fichero no contiene un recorrido.' : 'El fichero contiene varios recorridos o segmentos. Importa uno solo para no unir saltos.');
  return used[0];
}

/** Lee GPX track y TCX Course/Activity. No requiere horas, nunca convierte la ruta en actividad. */
export function parseReferenceRoute(xml: string, fileName: string, url?: string): ParsedReferenceRoute {
  if (new TextEncoder().encode(xml).length > MAX_REFERENCE_FILE_BYTES) throw new RouteLibraryError('El fichero supera el límite de 10 MB.');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new RouteLibraryError('No se admiten declaraciones DOCTYPE ni entidades en los ficheros de ruta.');
  if (!/\.(gpx|tcx)$/i.test(fileName)) throw new RouteLibraryError('Selecciona un fichero GPX o TCX.');
  const doc = parseXml(xml);
  const root = doc.documentElement;
  let format: ReferenceRoute['format'];
  let name: string | undefined;
  let points: RoutePoint[];
  if (root?.localName === 'gpx') {
    format = 'gpx';
    const tracks = descendants(root, 'trk');
    const routes = descendants(root, 'rte');
    if (routes.length > 0) throw new RouteLibraryError('El GPX contiene una ruta de waypoints; exporta un track detallado o recalcula el recorrido por carretera antes de importarlo.');
    if (tracks.length !== 1) throw new RouteLibraryError('Selecciona un GPX con un solo track.');
    const container = tracks[0];
    name = text(child(container, 'name'));
    const raw = oneTrack(descendants(container, 'trkseg').map(segment => descendants(segment, 'trkpt')));
    if (raw.length > MAX_REFERENCE_POINTS) throw new RouteLibraryError('La ruta supera el límite de 50.000 puntos.');
    points = raw.map(point => ({ lat: numberField(point.getAttribute('lat'), 'latitud'), lng: numberField(point.getAttribute('lon'), 'longitud'), ...elevation(text(child(point, 'ele'))) }));
  } else if (root?.localName === 'TrainingCenterDatabase') {
    format = 'tcx';
    const containers = [...descendants(root, 'Course'), ...descendants(root, 'Activity')];
    if (containers.length !== 1) throw new RouteLibraryError('Selecciona un TCX con un solo recorrido.');
    const container = containers[0];
    name = text(child(container, 'Name'));
    const raw = oneTrack(descendants(container, 'Track').map(track => descendants(track, 'Trackpoint')));
    if (raw.length > MAX_REFERENCE_POINTS) throw new RouteLibraryError('La ruta supera el límite de 50.000 puntos.');
    points = raw.map(point => {
      const position = child(point, 'Position');
      return { lat: numberField(text(position && child(position, 'LatitudeDegrees')), 'latitud'), lng: numberField(text(position && child(position, 'LongitudeDegrees')), 'longitud'), ...elevation(text(child(point, 'AltitudeMeters'))) };
    });
  } else throw new RouteLibraryError('El fichero no es un GPX o TCX de rutas.');
  const sourceUrl = sourceLink(url);
  return {
    name: (name?.trim() || fileName.replace(/\.(gpx|tcx)$/i, '') || 'Ruta importada').slice(0, 120), format, sourceFileName: fileName,
    ...(sourceUrl ? { sourceUrl } : {}), originalXml: xml, originalPoints: copy(points), points,
    summary: analyzeReferenceRoutePoints(points),
  };
}

export async function importReferenceRoute(file: File, url?: string): Promise<ReferenceRoute> {
  if (file.size > MAX_REFERENCE_FILE_BYTES) throw new RouteLibraryError('El fichero supera el límite de 10 MB.');
  const parsed = parseReferenceRoute(await file.text(), file.name, url);
  const now = Date.now();
  const route: ReferenceRoute = { ...parsed, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
  await db.referenceRoutes.add(route);
  return route;
}

/** Guarda una ruta generada (Rutas o Rutas con IA) con su GPX exportado como original, para empalmarla. */
export async function saveGeneratedRoute(name: string, coords: Coord3[], fileName: string): Promise<ReferenceRoute> {
  const points = coords.map(([lng, lat, ele]) => ({ lat, lng, ele }));
  const summary = analyzeReferenceRoutePoints(points);
  const now = Date.now();
  const route: ReferenceRoute = {
    id: crypto.randomUUID(), name: name.trim().slice(0, 120) || 'Ruta generada', format: 'gpx', sourceFileName: fileName,
    originalXml: toGpx(name, coords), originalPoints: copy(points), points, summary, createdAt: now, updatedAt: now,
  };
  await db.referenceRoutes.add(route);
  return route;
}

/** Guarda el empalme elegido como una ruta más de la biblioteca; su original es el mismo GPX que se exporta. */
export async function saveSplicedRoute(name: string, points: RoutePoint[]): Promise<ReferenceRoute> {
  const routeName = name.trim().slice(0, 120) || 'Empalme';
  const summary = analyzeReferenceRoutePoints(points);
  const now = Date.now();
  const route: ReferenceRoute = {
    id: crypto.randomUUID(), name: routeName, format: 'gpx', sourceFileName: 'empalme.gpx',
    originalXml: routePointsToGpx(routeName, points), originalPoints: copy(points), points: copy(points), summary, createdAt: now, updatedAt: now,
  };
  await db.referenceRoutes.add(route);
  return route;
}

export function listReferenceRoutes(): Promise<ReferenceRoute[]> {
  return db.referenceRoutes.orderBy('updatedAt').reverse().toArray();
}
export function getReferenceRoute(id: string): Promise<ReferenceRoute | undefined> { return db.referenceRoutes.get(id); }
export function deleteReferenceRoute(id: string): Promise<void> { return db.referenceRoutes.delete(id); }

export async function saveReferenceRoute(route: ReferenceRoute): Promise<ReferenceRoute> {
  const original = await db.referenceRoutes.get(route.id);
  const source = original ?? route;
  analyzeReferenceRoutePoints(source.originalPoints);
  const name = route.name.trim();
  if (!name || name.length > 120) throw new RouteLibraryError('El nombre debe tener entre 1 y 120 caracteres.');
  const saved: ReferenceRoute = {
    ...source, name, points: copy(route.points), originalPoints: copy(source.originalPoints),
    summary: analyzeReferenceRoutePoints(route.points), updatedAt: Date.now(),
  };
  await db.referenceRoutes.put(saved);
  return saved;
}

/** Sustituye por geometría calculada y validada; no altera el original ni guarda automáticamente. */
export function replaceReferenceRoutePoints(route: ReferenceRoute, points: RoutePoint[]): ReferenceRoute {
  return { ...route, points: copy(points), originalPoints: copy(route.originalPoints), summary: analyzeReferenceRoutePoints(points), updatedAt: Date.now() };
}

export function trimReferenceRoute(route: ReferenceRoute, from: number, to: number): ReferenceRoute {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to >= route.points.length || from >= to) throw new RouteLibraryError('Selecciona un inicio y un final válidos, con al menos dos puntos.');
  return replaceReferenceRoutePoints(route, route.points.slice(from, to + 1));
}
export function reverseReferenceRoute(route: ReferenceRoute): ReferenceRoute {
  return replaceReferenceRoutePoints(route, [...route.points].reverse());
}
export function restoreReferenceRoute(route: ReferenceRoute): ReferenceRoute {
  return replaceReferenceRoutePoints(route, route.originalPoints);
}
export function changeReferenceRouteStart(route: ReferenceRoute, index: number): ReferenceRoute {
  if (!analyzeReferenceRoutePoints(route.points).closed) throw new RouteLibraryError('Solo se puede cambiar el inicio de una ruta cerrada exactamente. Calcula antes la conexión por carretera.');
  const ring = route.points.slice(0, -1);
  if (!Number.isInteger(index) || index < 0 || index >= ring.length) throw new RouteLibraryError('El punto de inicio no es válido.');
  return replaceReferenceRoutePoints(route, [...ring.slice(index), ...ring.slice(0, index), ring[index]]);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Exportación 1.1 compatible con navegación; sin horas ni alturas inventadas. */
export function referenceRouteToGpx(route: ReferenceRoute): string {
  return routePointsToGpx(route.name, route.points);
}

/** El mismo GPX para cualquier recorrido de puntos (también los empalmes). */
export function routePointsToGpx(routeName: string, points: RoutePoint[]): string {
  analyzeReferenceRoutePoints(points);
  const name = escapeXml(routeName);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="FBikeTrain" xmlns="http://www.topografix.com/GPX/1/1">',
    `<metadata><name>${name}</name></metadata><trk><name>${name}</name><trkseg>`,
    ...points.map(point => `<trkpt lat="${point.lat.toFixed(7)}" lon="${point.lng.toFixed(7)}">${point.ele === undefined ? '' : `<ele>${point.ele.toFixed(2)}</ele>`}</trkpt>`),
    '</trkseg></trk></gpx>',
  ].join('\n');
}
