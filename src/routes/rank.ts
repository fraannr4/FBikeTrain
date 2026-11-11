import { difficulty, type Difficulty, type UserReference } from '../metrics/reference';
import { formatKm, formatMeters } from '../ui/format';

/**
 * Orden de rutas ya hechas (catálogo, biblioteca o un GPX subido) por lo que pide el usuario:
 * manda la distancia y, si la escribe, el desnivel. El nivel solo etiqueta y desempata.
 */

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
/** Lo mínimo para ordenar: identificador estable, km y desnivel publicado (null si no se conoce). */
export type RankCard = { id: string; km: number; desnivelM: number | null };
export type RankedRoute<C extends RankCard = RankCard> = {
  card: C;
  /** Suave, Media o Dura con las cifras publicadas frente a la referencia; null sin referencia. */
  etiqueta: Difficulty | null;
  ajuste: 'encaja' | 'recortar' | 'alargar';
  motivo: string;
};
export type DiscardedRoute<C extends RankCard = RankCard> = { card: C; motivo: string };

const km = (value: number) => formatKm(value * 1000, value < 10 ? 1 : 0);

/** Orden por unidades de código, como `<` entre textos: estable entre navegadores, sin depender del idioma. */
function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Manda lo pedido: filtra por distancia y ordena por cercanía. El nivel nunca descarta. */
export function rankForTarget<C extends RankCard>(cards: C[], target: RankTarget, ref: UserReference | null): { ranked: RankedRoute<C>[]; discarded: DiscardedRoute<C>[] } {
  const { distanceKm, elevGainM } = target;
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) throw new RangeError('La distancia pedida no es válida.');
  if (elevGainM !== undefined && (!Number.isFinite(elevGainM) || elevGainM < 0)) throw new RangeError('El desnivel pedido no es válido.');
  const asked = `${km(distanceKm)} pedidos`;
  const kept: (RankedRoute<C> & { bucket: number; level: number })[] = [];
  const discarded: DiscardedRoute<C>[] = [];
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
    let ajuste: RankedRoute['ajuste'];
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
