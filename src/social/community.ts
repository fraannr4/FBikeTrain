import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProfileCard } from './friends';

export type Cyclist = ProfileCard & {
  bio: string;
  riding_style: string;
  avatar_version: number;
  /** Día de actividad en el servidor; no es una ubicación ni una hora de salida. */
  last_active_at: string | null;
};
export type BlockedCyclist = Pick<Cyclist, 'id' | 'username' | 'display_name'>;
type Rpc = Pick<SupabaseClient, 'rpc'>;
const GENERIC = 'No se ha podido completar. Comprueba la conexión e inténtalo de nuevo.';

export function communityError(error: { message: string; code?: string }): string {
  if (error.message === 'Límite diario de denuncias') return 'Has alcanzado el límite de denuncias en 24 horas. Prueba más tarde.';
  if (error.code === 'P0429' || /Límite diario|Demasiadas|cuota/i.test(error.message)) return 'Has alcanzado el límite de 20 solicitudes e invitaciones en 24 horas. Prueba más tarde.';
  if (/Cuenta registrada|Sesión necesaria|registrad|anónim/i.test(error.message)) return 'Necesitas una cuenta registrada. Vuelve a iniciar sesión para continuar.';
  if (/bloquead|Ciclista no disponible|Usuario no disponible/i.test(error.message)) return 'Este ciclista no está disponible para interactuar.';
  if (/Página no válida/.test(error.message)) return 'Página no válida.';
  if (error.message === 'Búsqueda no válida') return 'Escribe un nombre de hasta 60 caracteres.';
  if (/Motivo|Denuncia no válida/i.test(error.message)) return 'Escribe un motivo de entre 5 y 500 caracteres.';
  return GENERIC;
}

async function call<T>(client: Rpc, fn: string, args?: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await (args ? client.rpc(fn, args) : client.rpc(fn));
  if (error) throw new Error(communityError(error));
  return data as T | null;
}

export async function listCyclists(client: Rpc, queryText = '', pageOffset = 0): Promise<Cyclist[]> {
  if (!Number.isInteger(pageOffset) || pageOffset < 0) throw new Error('Página no válida.');
  return await call<Cyclist[]>(client, 'list_cyclists', { query_text: queryText.trim(), page_offset: pageOffset }) ?? [];
}
export async function listBlockedCyclists(client: Rpc): Promise<BlockedCyclist[]> {
  return await call<BlockedCyclist[]>(client, 'list_blocked_cyclists') ?? [];
}
export async function blockCyclist(client: Rpc, targetId: string, blocked: boolean): Promise<void> {
  await call(client, 'block_cyclist', { target_id: targetId, blocked });
}
export async function reportCyclist(client: Rpc, targetId: string, reason: string): Promise<void> {
  const trimmed = reason.trim();
  if (trimmed.length < 5 || trimmed.length > 500) throw new Error('Escribe un motivo de entre 5 y 500 caracteres.');
  await call(client, 'report_cyclist', { target_id: targetId, reason: trimmed });
}
export async function touchCommunityActivity(client: Rpc): Promise<void> {
  await call(client, 'touch_community_activity');
}
