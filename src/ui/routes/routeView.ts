import { TZDate } from '@date-fns/tz';
import { subWeeks } from 'date-fns';
import type { Coord3, LatLng } from '../../domain/types';
import { TZ } from '../../metrics/aggregate';
import { LONG_WINDOW_WEEKS } from '../../metrics/reference';
import { routeSide } from '../../routes/side';

/** Lo que las pantallas sacan de una ruta: su nombre por el lado del inicio y la ventana de la referencia. */

const SIDES = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
/**
 * Nombre de una vuelta por el lado del inicio hacia el que va: «Vuelta por el norte». Sin
 * topónimos (no hay geocodificador) y sin decir dónde está el inicio.
 */
export function routeName(coords: Coord3[], start: LatLng): string {
  const side = routeSide(coords, start);
  return side < 0 ? 'Vuelta alrededor del inicio' : `Vuelta por el ${SIDES[side]}`;
}

/**
 * Las salidas que necesita la referencia de nivel: las últimas 12 semanas de Madrid hasta `now`
 * (`computeReference` prueba 8 y, si no llegan, 12). Leer solo esas evita cargar miles de salidas.
 */
export function referenceRange(now: number): { from: number; to: number } {
  return { from: subWeeks(new TZDate(now, TZ), LONG_WINDOW_WEEKS).getTime(), to: now };
}
