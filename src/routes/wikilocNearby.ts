import { z } from 'zod';
import { db } from '../db/db';
import type { LatLng } from '../domain/types';

/**
 * Enlace a Wikiloc con los filtros del usuario y la última petición (km, desnivel e inicio).
 * Nada de aquí consulta wikiloc.com: solo se construye el enlace que abre el usuario en su navegador.
 */

/** Actividad «ciclismo de carretera» en los filtros del mapa de Wikiloc. */
const ROAD_CYCLING_ACT = '29';
const KM_PER_DEG_LAT = 111.32;

/** Mapa de Wikiloc con un rectángulo de `radiusKm` alrededor del inicio: rutas que salen o pasan por la zona. */
export function wikilocSearchUrl(start: LatLng, radiusKm = 8): string {
  if (!Number.isFinite(start.lat) || Math.abs(start.lat) > 85 || !Number.isFinite(start.lng) || Math.abs(start.lng) > 180) {
    throw new RangeError('El inicio no es válido.');
  }
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) throw new RangeError('El radio no es válido.');
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLng = radiusKm / (KM_PER_DEG_LAT * Math.cos((start.lat * Math.PI) / 180));
  const corner = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const url = new URL('https://es.wikiloc.com/wikiloc/map.do');
  url.searchParams.set('sw', corner(start.lat - dLat, start.lng - dLng));
  url.searchParams.set('ne', corner(start.lat + dLat, start.lng + dLng));
  url.searchParams.set('act', ROAD_CYCLING_ACT);
  url.searchParams.set('page', '1');
  return url.href;
}

/** Lo que pide el usuario: la distancia, el desnivel si lo escribe y el inicio. Solo en este dispositivo. */
const WikilocRequestSchema = z.strictObject({
  distanceKm: z.number().gt(0).max(1000),
  elevGainM: z.number().min(0).max(20_000).nullable(),
  start: z.strictObject({ lat: z.number().min(-85).max(85), lng: z.number().min(-180).max(180) }),
});
export type WikilocRequest = z.infer<typeof WikilocRequestSchema>;

/** Filas de la tabla `wikilocNearby`. Las claves `nearby` y `track` eran del marcador retirado y se borran. */
export type WikilocRequestRow = { key: 'request'; request: WikilocRequest };
export type WikilocRow = WikilocRequestRow | { key: 'nearby' | 'track' };

export async function saveWikilocRequest(request: WikilocRequest): Promise<void> {
  await db.wikilocNearby.put({ key: 'request', request: WikilocRequestSchema.parse(request) });
}

export async function loadWikilocRequest(): Promise<WikilocRequest | null> {
  const row = await db.wikilocNearby.get('request');
  const parsed = row?.key === 'request' ? WikilocRequestSchema.safeParse(row.request) : null;
  return parsed?.success ? parsed.data : null;
}

/** Borra la lista y la ruta que guardaba el marcador retirado: ya no se usan. */
export async function clearLegacyWikilocRows(): Promise<void> {
  await db.wikilocNearby.bulkDelete(['nearby', 'track']);
}
