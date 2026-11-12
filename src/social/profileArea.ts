import type { Account } from '../auth/AccountBoundary';
import type { LatLng } from '../domain/types';
import { loadSettings, saveSettings } from '../settings/settings';
import { serverMessage } from './friends';
import type { Place } from './geocode';

const SKIP_KEY = 'fbt-zona-skip';
const SKIP_MS = 7 * 86_400_000;
export const SAVE_FAILED = 'No se ha podido guardar tu zona. Comprueba la conexión e inténtalo de nuevo.';
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Celda aproximada (2 decimales, unos 1-5 km): lo único de la ubicación que sale del móvil. */
export function areaCell(p: LatLng): { area_lat: number; area_lng: number } {
  return { area_lat: round2(p.lat), area_lng: round2(p.lng) };
}

/** Error del servidor al guardar la zona; su mensaje ya está listo para el usuario. */
export class AreaSaveError extends Error {}

/**
 * Guarda en el perfil el pueblo y su celda. Si aún no hay «Casa», la fija en el centro del pueblo,
 * solo en este dispositivo: así Rutas tiene punto de salida desde el primer día.
 */
export async function saveArea(account: Account, place: Place): Promise<void> {
  const { error } = await account.client
    .from('profiles')
    .update({ locality: place.name, ...areaCell(place) })
    .eq('id', account.user.id);
  if (error) throw new AreaSaveError(serverMessage(error.message) ?? SAVE_FAILED);
  const settings = await loadSettings();
  if (settings.home === null) await saveSettings({ ...settings, home: { lat: place.lat, lng: place.lng } });
}

export function zonaSkippedRecently(now: number): boolean {
  try {
    const at = Number(localStorage.getItem(SKIP_KEY));
    return at > 0 && now - at < SKIP_MS;
  } catch {
    return false;
  }
}

export function skipZona(now: number): void {
  try {
    localStorage.setItem(SKIP_KEY, String(now));
  } catch {
    /* sin almacenamiento: se volverá a preguntar en el próximo inicio */
  }
}
