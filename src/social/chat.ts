import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Chat entre amigos. Todo pasa por RPC del servidor (migración `202611190001_chat.sql`): aquí solo se
 * validan las entradas, se llama y se convierten las filas. Diseño en
 * `docs/superpowers/specs/2026-11-19-chat-design.md`.
 */
export type ChatKind = 'text' | 'ride' | 'route' | 'library_route' | 'proposal' | 'system';
export type Conversation = {
  id: string;
  kind: 'direct' | 'group';
  /** Solo en grupos. */
  title: string | null;
  /** La otra persona, en una conversación de dos. */
  peerId: string | null;
  peerName: string | null;
  peerAvatarVersion: number | null;
  /** Hasta dónde ha leído la otra persona: de ahí sale «Visto». */
  peerLastReadAt: string | null;
  /** `null`: aún no hay ningún mensaje. */
  lastKind: ChatKind | null;
  lastPreview: string;
  /** El último mensaje está borrado: la lista dice «Mensaje borrado». */
  lastDeleted: boolean;
  lastSenderId: string | null;
  lastMessageAt: string;
  unread: number;
  muted: boolean;
  /** Falso si ya no sois amigos: la conversación queda en solo lectura. */
  canSend: boolean;
};
export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  createdAt: string;
  kind: ChatKind;
  body: string;
  payload: unknown;
  deleted: boolean;
};
type Rpc = Pick<SupabaseClient, 'rpc'>;

export const MAX_MESSAGE_CHARS = 2000;
const PAGE_SIZE = 50;
const GENERIC = 'No se ha podido completar. Comprueba la conexión e inténtalo de nuevo.';
const INVALID_MESSAGE = 'Escribe un mensaje de 2000 caracteres como mucho.';
const INVALID_REPORT = 'Explica el motivo en 5 a 500 caracteres.';
/** Mensajes del servidor en lo que tiene que saber o hacer el usuario. */
const MESSAGES = new Map<string, string>([
  ['Conversación no disponible', 'Esta conversación ya no está disponible.'],
  ['Ya no sois amigos', 'Ya no sois amigos: no puedes escribir aquí.'],
  ['Mensaje no válido', INVALID_MESSAGE],
  ['Demasiados mensajes seguidos', 'Vas muy rápido. Espera un momento y vuelve a enviar.'],
  ['Límite diario de mensajes', 'Has llegado al límite de mensajes de hoy.'],
  ['Usuario no disponible', 'Este ciclista no está disponible para interactuar.'],
  ['Denuncia no válida', INVALID_REPORT],
  ['Límite diario de denuncias', 'Has llegado al límite de denuncias de hoy.'],
  ['Cuenta registrada necesaria', 'Necesitas una cuenta registrada para usar la comunidad.'],
  ['Sesión necesaria', 'Vuelve a iniciar sesión para continuar.'],
]);

async function call<T>(client: Rpc, fn: string, args?: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await (args ? client.rpc(fn, args) : client.rpc(fn));
  if (error) throw new Error(MESSAGES.get(error.message) ?? GENERIC);
  return data as T | null;
}

type MessageRow = {
  id: string; conversation_id: string; sender_id: string; sender_name: string | null; created_at: string;
  kind: ChatKind; body: string | null; payload: unknown; deleted: boolean | null;
};
const toMessage = (row: MessageRow): Message => ({
  id: row.id,
  conversationId: row.conversation_id,
  senderId: row.sender_id,
  senderName: row.sender_name ?? '',
  createdAt: row.created_at,
  kind: row.kind,
  body: row.body ?? '',
  payload: row.payload ?? {},
  deleted: row.deleted === true,
});

type ConversationRow = {
  id: string; kind: 'direct' | 'group'; title: string | null; peer_id: string | null; peer_name: string | null;
  peer_avatar_version: number | null; peer_last_read_at: string | null; last_kind: ChatKind | null;
  last_preview: string | null; last_sender_id: string | null; last_message_at: string; unread: number | null;
  muted: boolean | null; can_send: boolean | null; last_deleted: boolean | null;
};
const toConversation = (row: ConversationRow): Conversation => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  peerId: row.peer_id,
  peerName: row.peer_name,
  peerAvatarVersion: row.peer_avatar_version,
  peerLastReadAt: row.peer_last_read_at,
  lastKind: row.last_kind,
  lastPreview: row.last_preview ?? '',
  lastDeleted: row.last_deleted === true,
  lastSenderId: row.last_sender_id,
  lastMessageAt: row.last_message_at,
  unread: row.unread ?? 0,
  muted: row.muted === true,
  canSend: row.can_send === true,
});

/** Identificador que pone el cliente: reintentar un envío con el mismo no duplica el mensaje. */
export const newMessageId = (): string => crypto.randomUUID();

/** Abre la conversación con un amigo, o devuelve la que ya existe. */
export async function openDirect(client: Rpc, userId: string): Promise<string> {
  const id = await call<string>(client, 'chat_open_direct', { target_id: userId });
  if (!id) throw new Error(GENERIC);
  return id;
}

export async function listConversations(client: Rpc): Promise<Conversation[]> {
  return ((await call<ConversationRow[]>(client, 'chat_list_conversations')) ?? []).map(toConversation);
}

/** Una página de mensajes, del más antiguo al más nuevo. Con `before`, la página anterior a esa fecha. */
export async function listMessages(client: Rpc, conversationId: string, before?: string): Promise<Message[]> {
  const rows = await call<MessageRow[]>(client, 'chat_list_messages', { conversation: conversationId, before_at: before ?? null, page_size: PAGE_SIZE });
  return (rows ?? []).map(toMessage).reverse();
}

export async function sendText(client: Rpc, conversationId: string, body: string, id: string): Promise<Message> {
  const text = body.trim();
  // El servidor cuenta caracteres, no unidades UTF-16: un emoji es uno.
  if (!text || [...text].length > MAX_MESSAGE_CHARS) throw new Error(INVALID_MESSAGE);
  const rows = await call<MessageRow[]>(client, 'chat_send', {
    message_id: id, conversation: conversationId, message_kind: 'text', message_body: text, message_payload: {},
  });
  if (!rows?.[0]) throw new Error(GENERIC);
  return toMessage(rows[0]);
}

export async function markRead(client: Rpc, conversationId: string): Promise<void> {
  await call(client, 'chat_mark_read', { conversation: conversationId });
}

/** Solo el autor. El mensaje queda como «Mensaje borrado» para todos. */
export async function deleteMessage(client: Rpc, messageId: string): Promise<void> {
  await call(client, 'chat_delete_message', { message_id: messageId });
}

export async function setMuted(client: Rpc, conversationId: string, muted: boolean): Promise<void> {
  await call(client, 'chat_set_muted', { conversation: conversationId, muted });
}

/** Conversaciones no silenciadas con mensajes ajenos sin leer. */
export async function unreadCount(client: Rpc): Promise<number> {
  const count = await call<number>(client, 'chat_unread_count');
  return typeof count === 'number' ? count : 0;
}

/** Denuncia un mensaje ajeno. El servidor bloquea además a su autor. */
export async function reportMessage(client: Rpc, messageId: string, reason: string): Promise<void> {
  const text = reason.trim();
  if ([...text].length < 5 || [...text].length > 500) throw new Error(INVALID_REPORT);
  await call(client, 'report_chat_message', { message_id: messageId, reason: text });
}
