import type { SupabaseClient } from '@supabase/supabase-js';

type RealtimeClient = Pick<SupabaseClient, 'channel' | 'removeChannel'>;

/** Cada cuánto se vuelve a pedir la conversación abierta cuando el canal no está vivo. */
export const POLL_MS = 10_000;

/**
 * Canal de tiempo real de una conversación. Solo avisa de que hay algo nuevo (`onPoke`): el contenido se
 * vuelve a pedir por RPC, así el nombre del autor y las reglas de visibilidad salen siempre del servidor.
 * `onStatus` dice si el canal está vivo; si no lo está, quien llama sondea cada `POLL_MS`.
 * No se escucha `DELETE`: Supabase no lo filtra por RLS, y un mensaje borrado llega como `UPDATE`.
 * Devuelve la función que cierra el canal.
 */
export function subscribeConversation(client: RealtimeClient, conversationId: string, onPoke: () => void, onStatus: (live: boolean) => void): () => void {
  let closed = false;
  const poke = () => { if (!closed) onPoke(); };
  const filter = `conversation_id=eq.${conversationId}`;
  const channel = client.channel(`chat:${conversationId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter }, poke)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter }, poke)
    .subscribe((status: string) => { if (!closed) onStatus(status === 'SUBSCRIBED'); });
  return () => {
    if (closed) return;
    closed = true;
    void client.removeChannel(channel);
  };
}
