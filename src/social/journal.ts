import type { SupabaseClient } from '@supabase/supabase-js';

export type RidingStyle = 'explorar' | 'subir' | 'fondo' | 'grupo';
export type JournalVisibility = 'everyone' | 'friends';
export type JournalRide = {
  activity_date: string;
  distance_m: number;
  moving_time_s: number;
  elev_gain_m: number | null;
};
export type JournalAuthor = {
  id: string;
  username: string;
  display_name: string;
  riding_style: RidingStyle;
  avatar_version: number;
};
export type JournalPost = {
  id: string;
  author_id: string;
  body: string;
  visibility: JournalVisibility;
  ride: JournalRide | null;
  created_at: string;
  author: JournalAuthor;
};
type Rpc = Pick<SupabaseClient, 'rpc'>;
const GENERIC = 'No se ha podido completar. Comprueba la conexión e inténtalo de nuevo.';
const MESSAGES: Record<string, string> = {
  'Sesión necesaria': 'Vuelve a iniciar sesión para continuar.',
  'Publicación no válida': 'Escribe una nota de hasta 1.000 caracteres o elige una salida con cifras válidas.',
  'Publicación no disponible': 'Esa publicación ya no está disponible o no es tuya.',
  'Límite diario de publicaciones': 'Has llegado a las 20 publicaciones de las últimas 24 horas. Prueba más tarde.',
  'Página no válida': 'No se han podido cargar más publicaciones. Actualiza el cuaderno.',
};

async function call<T>(client: Rpc, name: string, args: Record<string, unknown>): Promise<T | null> {
  try {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(MESSAGES[error.message] ?? GENERIC);
    return data as T | null;
  } catch (error) {
    if (error instanceof Error && (error.message === GENERIC || Object.values(MESSAGES).includes(error.message))) throw error;
    throw new Error(GENERIC);
  }
}

export async function listJournal(client: Rpc, targetId: string | null, cursor?: { createdAt: string; id: string }): Promise<JournalPost[]> {
  return await call<JournalPost[]>(client, 'list_profile_posts', {
    target_id: targetId,
    before_created_at: cursor?.createdAt ?? null,
    before_id: cursor?.id ?? null,
  }) ?? [];
}

/** Construye un objeto nuevo con solo cifras y fecha: nunca envía un track, coordenadas ni claves extra. */
function rideSnapshot(ride: JournalRide | null): JournalRide | null {
  if (ride === null) return null;
  if (!ride || typeof ride !== 'object') throw new Error(MESSAGES['Publicación no válida']);
  const validNumber = (value: unknown, max: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(ride.activity_date) ? new Date(`${ride.activity_date}T12:00:00Z`) : null;
  if (!day || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== ride.activity_date
    || !validNumber(ride.distance_m, 5000000) || !validNumber(ride.moving_time_s, 604800)
    || (ride.elev_gain_m !== null && (typeof ride.elev_gain_m !== 'number' || !Number.isFinite(ride.elev_gain_m) || ride.elev_gain_m < 0 || ride.elev_gain_m > 100000))) {
    throw new Error(MESSAGES['Publicación no válida']);
  }
  return { activity_date: ride.activity_date, distance_m: ride.distance_m, moving_time_s: ride.moving_time_s, elev_gain_m: ride.elev_gain_m };
}

export async function createPost(client: Rpc, input: { body: string; visibility: JournalVisibility; ride: JournalRide | null }): Promise<string> {
  const body = input.body.trim();
  if (body.length > 1000 || (!body && input.ride === null) || !['everyone', 'friends'].includes(input.visibility)) throw new Error(MESSAGES['Publicación no válida']);
  const id = await call<string>(client, 'create_profile_post', { body, visibility: input.visibility, ride: rideSnapshot(input.ride) });
  if (!id) throw new Error(GENERIC);
  return id;
}

export async function deletePost(client: Rpc, id: string): Promise<void> {
  await call(client, 'delete_profile_post', { post_id: id });
}
