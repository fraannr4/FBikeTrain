import type { SupabaseClient } from '@supabase/supabase-js';

export type ProfileCard = {
  id: string;
  username: string;
  display_name: string;
  locality: string | null;
  distance_km: number | null;
};
export type FriendRow = {
  friendship_id: string;
  status: 'pending' | 'accepted';
  direction: 'sent' | 'received';
  profile: ProfileCard;
};
type Rpc = Pick<SupabaseClient, 'rpc'>;

const SHORT = 'Escribe al menos 3 letras.';
const GENERIC = 'No se ha podido completar. Comprueba la conexión e inténtalo de nuevo.';
/** Mensajes del servidor (migraciones de perfiles y de zona) en lo que tiene que hacer el usuario. */
const MESSAGES: Record<string, string> = {
  'Sin zona configurada': 'Indica tu zona en Ajustes para buscar cerca.',
  'Escribe al menos 3 letras': SHORT,
  'Búsqueda demasiado larga': 'Escribe 60 letras como mucho.',
  'Radio no válido': 'Elige 25 o 50 km.',
  'Solicitud no válida': 'No puedes enviarte una solicitud a ti mismo.',
  'Solicitud no disponible': 'Esa solicitud ya no está disponible.',
  'Sesión necesaria': 'Vuelve a iniciar sesión para continuar.',
};

async function call<T>(client: Rpc, fn: string, args?: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await (args ? client.rpc(fn, args) : client.rpc(fn));
  if (error) throw new Error(MESSAGES[error.message] ?? GENERIC);
  return data as T | null;
}

export async function searchProfiles(client: Rpc, q: string): Promise<ProfileCard[]> {
  const term = q.trim();
  if (term.length < 3) throw new Error(SHORT);
  return (await call<ProfileCard[]>(client, 'search_profiles', { q: term })) ?? [];
}

export async function searchProfilesNear(client: Rpc, radiusKm: 25 | 50): Promise<ProfileCard[]> {
  return (await call<ProfileCard[]>(client, 'search_profiles_near', { radius_km: radiusKm })) ?? [];
}

export async function listFriends(client: Rpc): Promise<FriendRow[]> {
  return (await call<FriendRow[]>(client, 'list_friends')) ?? [];
}

export async function requestFriendship(client: Rpc, targetId: string): Promise<void> {
  await call(client, 'request_friendship', { target_id: targetId });
}

export async function acceptFriendship(client: Rpc, friendshipId: string): Promise<void> {
  await call(client, 'accept_friendship', { request_id: friendshipId });
}

/** Rechazar, cancelar o quitar: la misma RPC, siempre por un participante. */
export async function removeFriendship(client: Rpc, friendshipId: string): Promise<void> {
  await call(client, 'remove_friendship', { request_id: friendshipId });
}
