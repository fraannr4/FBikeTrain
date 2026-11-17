import type { SupabaseClient } from '@supabase/supabase-js';

/** «challenge»: reto de la comunidad. «post»: salida compartida, es decir, publicación del cuaderno. */
export type LikeKind = 'challenge' | 'post';
export type LikeState = { count: number; liked: boolean };
type Client = Pick<SupabaseClient, 'rpc' | 'from'>;

const READ_ERROR = 'No se han podido cargar los me gusta.';
export const WRITE_ERROR = 'No se ha podido guardar tu me gusta. Inténtalo de nuevo.';
/** Límite de list_likes por llamada. */
const BATCH = 100;

type Row = { object_id: string; like_count: number; liked: boolean };

/** Recuento y marca propia de una lista de objetos: una consulta por cada 100, nunca una por objeto. */
export async function fetchLikes(client: Client, kind: LikeKind, ids: string[]): Promise<Record<string, LikeState>> {
  const unique = [...new Set(ids)];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += BATCH) batches.push(unique.slice(i, i + BATCH));
  const pages = await Promise.all(batches.map(async batch => {
    const { data, error } = await client.rpc('list_likes', { kind, ids: batch });
    if (error) throw new Error(READ_ERROR);
    return (data ?? []) as Row[];
  }));
  const result: Record<string, LikeState> = {};
  for (const row of pages.flat()) result[row.object_id] = { count: row.like_count, liked: row.liked };
  return result;
}

/** El servidor solo admite escribir el propio «me gusta» sobre objetos visibles. */
export async function setLike(client: Client, userId: string, kind: LikeKind, id: string, liked: boolean): Promise<void> {
  const key = { user_id: userId, object_type: kind, object_id: id };
  const { error } = liked ? await client.from('likes').insert(key) : await client.from('likes').delete().match(key);
  // 23505: ya estaba dado; el resultado que quería el usuario es el mismo.
  if (error && error.code !== '23505') throw new Error(WRITE_ERROR);
}
