import type { SupabaseClient } from '@supabase/supabase-js';

/** Mismo formato que la restricción `profiles.username` de la base. */
export const USERNAME_RE = /^[a-z0-9_]{3,32}$/;
export const USERNAME_HELP = 'Entre 3 y 32 letras minúsculas, números o guiones bajos.';
export const USERNAME_FORMAT = 'Usa entre 3 y 32 letras minúsculas, números o guiones bajos, sin espacios ni tildes.';
export const USERNAME_TAKEN = 'Ese nombre de usuario ya está ocupado. Elige otro.';
export const PROFILE_SAVE_FAILED = 'No se pudo guardar el perfil. Inténtalo de nuevo.';
/** Nombre que pone la base a un perfil recién creado; no lo ha elegido el ciclista. */
export const DEFAULT_DISPLAY_NAME = 'Ciclista';

/** El alta crea el perfil con el id sin guiones como nombre de usuario provisional. */
export const isDefaultUsername = (userId: string, username: string) => username === userId.replace(/-/g, '');

/** Falta el paso de perfil si el usuario sigue siendo el provisional o no hay nombre visible. */
export function needsProfileSetup(userId: string, row: unknown): boolean {
  if (!row || typeof row !== 'object') return false;
  const { username, display_name: name } = row as { username?: unknown; display_name?: unknown };
  if (typeof username !== 'string') return false;
  return isDefaultUsername(userId, username) || typeof name !== 'string' || !name.trim();
}

/** Mensaje para el usuario ante un fallo al guardar el perfil; la unicidad la decide la base. */
export const profileSaveMessage = (error: { code?: string } | null | undefined) =>
  error?.code === '23505' ? USERNAME_TAKEN : PROFILE_SAVE_FAILED;

/** Actualiza campos del perfil propio. Devuelve el mensaje de error o null si se guardó. */
export async function updateOwnProfile(client: SupabaseClient, userId: string, fields: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await client.from('profiles').update(fields).eq('id', userId).select('id').single();
  return error || !data ? profileSaveMessage(error) : null;
}
