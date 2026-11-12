import type { LatLng } from '../domain/types';
import { haversineM } from '../import/summary';
import { referenceSite, type ReferenceRoute, type RoutePoint } from '../routes/library';
import type { RwgpsNearbyRoute } from '../routes/sources/rwgpsImport';
import { routeBearing } from '../routes/sources/rwgpsProposals';
import { DIRECCIONES, type AiReference, type Direccion } from './contracts';

/** Rutas conocidas que se enseñan a la IA como mucho. */
export const MAX_AI_REFERENCES = 6;
/** Una referencia más larga que la distancia máxima en más de esto no sirve de base. */
const MAX_OVER_PCT = 0.2;
const MAX_NAME = 80;

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Metadatos y esqueleto local; solo el resumen explícito `forAi` sale hacia el modelo. */
export type KnownRoute = {
  name: string;
  distanceM: number;
  ascentM: number | null;
  source: AiReference['fuente'];
  url?: string;
  author?: string;
  libraryId?: string;
  points?: RoutePoint[];
  /** Ride with GPS: lo más cerca que pasa del inicio y hacia dónde va. */
  startKm?: number;
  direction?: Direccion;
};

export function libraryReferences(routes: ReferenceRoute[], start: LatLng, radiusM: number): KnownRoute[] {
  return routes.filter(route => {
    const first = route.points[0];
    return first && haversineM(start.lat, start.lng, first.lat, first.lng) <= radiusM;
  }).map(route => ({
    name: route.name, distanceM: route.summary.distanceM, ascentM: route.summary.elevGainM,
    source: referenceSite(route.sourceUrl) === 'wikiloc' ? 'wikiloc' : 'biblioteca',
    ...(route.sourceUrl ? { url: route.sourceUrl } : {}), ...(route.author ? { author: route.author } : {}),
    libraryId: route.id, points: route.points,
  }));
}

/** Una de las 8 direcciones a partir del rumbo en grados. */
export const directionName = (deg: number): Direccion => DIRECCIONES[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/**
 * Rutas de la colección común de Ride with GPS como rutas conocidas. Su trazado simplificado se queda
 * en el navegador como esqueleto para el motor; a la IA solo le llegan nombre, cifras y dirección.
 */
export function rwgpsReferences(routes: RwgpsNearbyRoute[], start: LatLng): KnownRoute[] {
  return routes.map(route => ({
    name: route.name, distanceM: route.distanceM, ascentM: route.elevGainM, source: 'rwgps',
    url: `https://ridewithgps.com/routes/${route.id}`, author: route.author, points: route.line,
    startKm: round1(route.passM / 1000),
    direction: directionName(routeBearing(route.line, start)),
  }));
}

const normalizedName = (name: string) => name.normalize('NFKC').trim().toLocaleLowerCase('es').replace(/\s+/g, ' ');

/**
 * Referencias para la IA: solo nombre, fuente y cifras, con un id propio (`ref1`, `ref2`...).
 * `byId` lleva de cada id a la referencia original, con su enlace, que nunca sale hacia la IA.
 */
export function pickReferences(
  refs: KnownRoute[],
  maxDistanciaKm: number,
): { forAi: AiReference[]; byId: Map<string, KnownRoute> } {
  const forAi: AiReference[] = [];
  const byId = new Map<string, KnownRoute>();
  const ordered = [...refs].sort((a, b) => Number(!!b.libraryId) - Number(!!a.libraryId));
  ordered.forEach(ref => {
    if (forAi.length >= MAX_AI_REFERENCES || ref.distanceM <= 0 || !Number.isFinite(ref.distanceM) || ref.distanceM > 2_000_000) return;
    // Una ruta de biblioteca larga se puede recortar; las referencias externas no tienen ese contrato.
    if (!ref.libraryId && ref.distanceM / 1000 > maxDistanciaKm * (1 + MAX_OVER_PCT)) return;
    if ([...byId.values()].some(previous => normalizedName(previous.name) === normalizedName(ref.name)
      || (previous.source === ref.source && Math.abs(previous.distanceM - ref.distanceM) / Math.max(previous.distanceM, ref.distanceM) < 0.02))) return;
    const id = `ref${forAi.length + 1}`;
    forAi.push({
      id,
      nombre: ref.name.slice(0, MAX_NAME),
      fuente: ref.source,
      distanciaKm: round1(ref.distanceM / 1000),
      desnivelM: ref.ascentM === null ? null : Math.round(ref.ascentM),
      ...(ref.startKm !== undefined ? { aInicioKm: ref.startKm } : {}),
      ...(ref.direction ? { direccion: ref.direction } : {}),
    });
    byId.set(id, ref);
  });
  return { forAi, byId };
}
