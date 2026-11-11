import { z } from 'zod';
import { db } from '../db/db';
import type { LatLng } from '../domain/types';
import { difficulty, type Difficulty, type UserReference } from '../metrics/reference';
import { formatKm, formatMeters } from '../ui/format';
import {
  MAX_NEARBY_CARDS, MAX_WIKILOC_GPX_BYTES, WIKILOC_AUTHOR_MAX, WIKILOC_NAME_MAX, fitsGpx, isWikilocUrl,
} from './wikilocLimits';

/**
 * «Wikiloc cerca»: datos que el marcador lee de la vista de Wikiloc del propio usuario
 * (nombre, km, desnivel, dificultad, autor y enlace) y su orden según lo que pide.
 * Nada de aquí consulta wikiloc.com: solo se construye el enlace que abre el usuario.
 * Las cifras del mensaje van en km y metros tal como las muestra Wikiloc.
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

const WikilocIdSchema = z.string().regex(/^\d{1,20}$/);
const WikilocUrlSchema = z.string().max(2048).refine(isWikilocUrl, 'El enlace no es de wikiloc.com.');
const NameSchema = z.string().min(1).max(WIKILOC_NAME_MAX);
const AuthorSchema = z.string().max(WIKILOC_AUTHOR_MAX).nullable();

export const WikilocCardSchema = z.strictObject({
  id: WikilocIdSchema,
  nombre: NameSchema,
  km: z.number().min(0).max(1000),
  desnivelM: z.number().min(0).max(20_000).nullable(),
  dificultad: z.enum(['facil', 'moderado', 'dificil', 'muy-dificil', 'experto']).nullable(),
  autor: AuthorSchema,
  url: WikilocUrlSchema,
});
export type WikilocCard = z.infer<typeof WikilocCardSchema>;

export { MAX_NEARBY_CARDS, MAX_WIKILOC_GPX_BYTES };
const NearbyCardsSchema = z.array(WikilocCardSchema).max(MAX_NEARBY_CARDS);

export const WikilocListMessageSchema = z.strictObject({ v: z.literal(1), kind: z.literal('list'), rutas: NearbyCardsSchema });
export const WikilocTrackMessageSchema = z.strictObject({
  v: z.literal(1),
  kind: z.literal('track'),
  id: WikilocIdSchema,
  url: WikilocUrlSchema,
  nombre: NameSchema,
  autor: AuthorSchema,
  gpx: z.string().min(1).refine(fitsGpx, 'El GPX supera 5 MB.'),
});
/** Mensaje versionado del marcador «→ FBikeTrain»: la lista de la vista o el GPX de una ruta. */
export const WikilocMessageSchema = z.discriminatedUnion('kind', [WikilocListMessageSchema, WikilocTrackMessageSchema]);
export type WikilocMessage = z.infer<typeof WikilocMessageSchema>;
export type WikilocTrackMessage = z.infer<typeof WikilocTrackMessageSchema>;

/** Lo que pide el usuario: la distancia, el desnivel si lo escribe y el inicio. Solo en este dispositivo. */
const WikilocRequestSchema = z.strictObject({
  distanceKm: z.number().gt(0).max(1000),
  elevGainM: z.number().min(0).max(20_000).nullable(),
  start: z.strictObject({ lat: z.number().min(-85).max(85), lng: z.number().min(-180).max(180) }),
});
export type WikilocRequest = z.infer<typeof WikilocRequestSchema>;

// Almacenamiento en la base de la cuenta: la última lista, la última ruta recibida y la última petición.
export type WikilocNearbyRow = { key: 'nearby'; savedAt: number; rutas: WikilocCard[] };
export type WikilocTrackRow = { key: 'track'; savedAt: number; track: WikilocTrackMessage };
export type WikilocRequestRow = { key: 'request'; request: WikilocRequest };
export type WikilocRow = WikilocNearbyRow | WikilocTrackRow | WikilocRequestRow;
export type NearbyState =
  | { state: 'none' }
  | { state: 'expired'; savedAt: number }
  | { state: 'ok'; savedAt: number; rutas: WikilocCard[] };
export type ReceivedTrackState =
  | { state: 'none' }
  | { state: 'expired'; savedAt: number }
  | { state: 'ok'; savedAt: number; track: WikilocTrackMessage };

/** La lista y la ruta recibida caducan a los 7 días: las rutas de Wikiloc cambian y no se guardan más de lo necesario. */
export const NEARBY_TTL_MS = 7 * 24 * 3600 * 1000;

async function readRow<K extends WikilocRow['key']>(key: K): Promise<Extract<WikilocRow, { key: K }> | undefined> {
  const row = await db.wikilocNearby.get(key);
  return row?.key === key ? (row as Extract<WikilocRow, { key: K }>) : undefined;
}

export async function saveNearby(rutas: WikilocCard[], now = Date.now()): Promise<void> {
  await db.wikilocNearby.put({ key: 'nearby', savedAt: now, rutas: NearbyCardsSchema.parse(rutas) });
}

/** Una lista caducada se borra y se informa una vez como `expired`. */
export async function loadNearby(now = Date.now()): Promise<NearbyState> {
  const row = await readRow('nearby');
  if (!row) return { state: 'none' };
  if (now - row.savedAt > NEARBY_TTL_MS) {
    await clearNearby();
    return { state: 'expired', savedAt: row.savedAt };
  }
  return { state: 'ok', savedAt: row.savedAt, rutas: row.rutas };
}

export async function clearNearby(): Promise<void> {
  await db.wikilocNearby.delete('nearby');
}

/** La última ruta que ha enviado el marcador, para adaptarla. Una nueva sustituye a la anterior. */
export async function saveReceivedTrack(track: WikilocTrackMessage, now = Date.now()): Promise<void> {
  await db.wikilocNearby.put({ key: 'track', savedAt: now, track: WikilocTrackMessageSchema.parse(track) });
}

/** Como la lista: una ruta caducada se borra y se informa una vez como `expired`. */
export async function loadReceivedTrack(now = Date.now()): Promise<ReceivedTrackState> {
  const row = await readRow('track');
  if (!row) return { state: 'none' };
  if (now - row.savedAt > NEARBY_TTL_MS) {
    await clearReceivedTrack();
    return { state: 'expired', savedAt: row.savedAt };
  }
  return { state: 'ok', savedAt: row.savedAt, track: row.track };
}

export async function clearReceivedTrack(): Promise<void> {
  await db.wikilocNearby.delete('track');
}

/** Se guarda al buscar o al adaptar: la ventana que abre el marcador la necesita para adaptar la ruta. */
export async function saveWikilocRequest(request: WikilocRequest): Promise<void> {
  await db.wikilocNearby.put({ key: 'request', request: WikilocRequestSchema.parse(request) });
}

export async function loadWikilocRequest(): Promise<WikilocRequest | null> {
  const row = await readRow('request');
  const parsed = row ? WikilocRequestSchema.safeParse(row.request) : null;
  return parsed?.success ? parsed.data : null;
}

// Orden por lo pedido. Los márgenes de recorte y alargado son los de la adaptación (Task 2).
/** Se admiten rutas de 0,5× a 1,6× la distancia pedida (50 % a 160 %): se pueden recortar o alargar. */
export const ADMIT_MIN_PCT = 50;
export const ADMIT_MAX_PCT = 160;
/** Más de un 8 % por encima de lo pedido: se recorta. */
export const TRIM_ABOVE_PCT = 8;
/** Más de un 20 % por debajo de lo pedido: se alarga. */
export const EXTEND_BELOW_PCT = 20;
/**
 * Supuesto: el error relativo del desnivel se mide sobre al menos 100 m, para que pedir
 * un desnivel muy bajo no anule la distancia; y una ruta sin desnivel conocido cuenta
 * como si se desviara un 100 %, detrás de las que sí lo tienen y encajan.
 */
const ELEV_FLOOR_M = 100;
const MISSING_ELEV_PENALTY = 1;
/** Cercanías que redondean al mismo 1 % empatan, y las desempata el nivel. */
const TIE_RESOLUTION = 100;
/** En el empate va primero la ruta Media para el usuario, luego la Suave y luego la Dura. */
const LEVEL_ORDER: Record<Difficulty, number> = { Media: 0, Suave: 1, Dura: 2 };

export type RankTarget = { distanceKm: number; elevGainM?: number };
export type RankedWikiloc = {
  card: WikilocCard;
  /** Suave, Media o Dura con las cifras publicadas frente a la referencia; null sin referencia. */
  etiqueta: Difficulty | null;
  ajuste: 'encaja' | 'recortar' | 'alargar';
  motivo: string;
};
export type DiscardedWikiloc = { card: WikilocCard; motivo: string };

const km = (value: number) => formatKm(value * 1000, value < 10 ? 1 : 0);

/** Orden por unidades de código, como `<` entre textos: estable entre navegadores, sin depender del idioma. */
function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Manda lo pedido: filtra por distancia y ordena por cercanía. El nivel nunca descarta. */
export function rankForTarget(cards: WikilocCard[], target: RankTarget, ref: UserReference | null): { ranked: RankedWikiloc[]; discarded: DiscardedWikiloc[] } {
  const { distanceKm, elevGainM } = target;
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) throw new RangeError('La distancia pedida no es válida.');
  if (elevGainM !== undefined && (!Number.isFinite(elevGainM) || elevGainM < 0)) throw new RangeError('El desnivel pedido no es válido.');
  const asked = `${km(distanceKm)} pedidos`;
  const kept: (RankedWikiloc & { bucket: number; level: number })[] = [];
  const discarded: DiscardedWikiloc[] = [];
  for (const card of cards) {
    // En porcentajes enteros, para que los límites exactos no dependan del redondeo.
    if (card.km * 100 < distanceKm * ADMIT_MIN_PCT) {
      discarded.push({ card, motivo: `Demasiado corta: ${km(card.km)} frente a ${asked} (mínimo ${km(distanceKm * ADMIT_MIN_PCT / 100)}).` });
      continue;
    }
    if (card.km * 100 > distanceKm * ADMIT_MAX_PCT) {
      discarded.push({ card, motivo: `Demasiado larga: ${km(card.km)} frente a ${asked} (máximo ${km(distanceKm * ADMIT_MAX_PCT / 100)}).` });
      continue;
    }
    const deviation = (card.km - distanceKm) * 100;
    let ajuste: RankedWikiloc['ajuste'];
    let motivo: string;
    if (deviation > distanceKm * TRIM_ABOVE_PCT) {
      ajuste = 'recortar';
      motivo = `Se recorta de ${km(card.km)} a ${km(distanceKm)}.`;
    } else if (deviation < -distanceKm * EXTEND_BELOW_PCT) {
      ajuste = 'alargar';
      motivo = `Se alarga de ${km(card.km)} a ${km(distanceKm)}.`;
    } else {
      ajuste = 'encaja';
      motivo = `Encaja: ${km(card.km)} frente a ${asked}.`;
    }
    let score = Math.abs(card.km - distanceKm) / distanceKm;
    if (elevGainM !== undefined) {
      if (card.desnivelM === null) {
        score += MISSING_ELEV_PENALTY;
        motivo += ' Desnivel sin dato.';
      } else {
        score += Math.abs(card.desnivelM - elevGainM) / Math.max(elevGainM, ELEV_FLOOR_M);
        motivo += ` Desnivel: ${formatMeters(card.desnivelM)} frente a ${formatMeters(elevGainM)} pedidos.`;
      }
    }
    const etiqueta = ref ? difficulty({ distanceM: card.km * 1000, elevGainM: card.desnivelM ?? 0 }, ref) : null;
    kept.push({ card, etiqueta, ajuste, motivo, bucket: Math.round(score * TIE_RESOLUTION), level: etiqueta ? LEVEL_ORDER[etiqueta] : 0 });
  }
  kept.sort((a, b) => a.bucket - b.bucket || a.level - b.level || compareIds(a.card.id, b.card.id));
  return { ranked: kept.map(({ card, etiqueta, ajuste, motivo }) => ({ card, etiqueta, ajuste, motivo })), discarded };
}
