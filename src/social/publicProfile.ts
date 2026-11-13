import type { SupabaseClient } from '@supabase/supabase-js';
import { listFriends, type FriendRow } from './friends';

export type PublicProfile = { id: string; username: string; display_name: string };

/** Solo identidad pública. No pedir email, zona, coordenadas ni datos locales del otro ciclista. */
export async function loadPublicProfile(client: SupabaseClient, id: string): Promise<{
  profile: PublicProfile | null;
  friendship: FriendRow | null;
}> {
  const [response, friends] = await Promise.all([
    client.from('profiles').select('id,username,display_name').eq('id', id).maybeSingle(),
    listFriends(client),
  ]);
  if (response.error) throw new Error('No se pudo cargar el perfil. Comprueba la conexión e inténtalo de nuevo.');
  return { profile: response.data as PublicProfile | null, friendship: friends.find(f => f.profile.id === id) ?? null };
}
