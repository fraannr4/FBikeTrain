import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MAX_MESSAGE_CHARS,
  deleteMessage,
  listConversations,
  listMessages,
  markRead,
  newMessageId,
  openDirect,
  reportMessage,
  sendText,
  setMuted,
  unreadCount,
  type Conversation,
  type Message,
} from '../src/social/chat';
import { CHAT_CHANGED_EVENT, notifyChatChanged } from '../src/social/chatBadge';

const ROW = {
  id: 'm1', conversation_id: 'c1', sender_id: 'u1', sender_name: 'Ana Ruta',
  created_at: '2026-11-19T10:00:00+00:00', kind: 'text', body: 'Hola', payload: {}, deleted: false,
};
const MESSAGE: Message = {
  id: 'm1', conversationId: 'c1', senderId: 'u1', senderName: 'Ana Ruta',
  createdAt: '2026-11-19T10:00:00+00:00', kind: 'text', body: 'Hola', payload: {}, deleted: false,
};
const GENERIC = 'No se ha podido completar. Comprueba la conexión e inténtalo de nuevo.';

function fake(result: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('chat: llamadas al servidor', () => {
  it('cada función llama a su RPC con los parámetros exactos', async () => {
    let f = fake({ data: 'c1' });
    expect(await openDirect(f.client, 'u2')).toBe('c1');
    expect(f.rpc).toHaveBeenCalledWith('chat_open_direct', { target_id: 'u2' });

    f = fake({ data: [ROW] });
    expect(await sendText(f.client, 'c1', '  Hola  ', 'm1')).toEqual(MESSAGE);
    expect(f.rpc).toHaveBeenCalledWith('chat_send', { message_id: 'm1', conversation: 'c1', message_kind: 'text', message_body: 'Hola', message_payload: {} });

    f = fake({ data: [] });
    await listMessages(f.client, 'c1', '2026-11-19T10:00:00Z');
    expect(f.rpc).toHaveBeenCalledWith('chat_list_messages', { conversation: 'c1', before_at: '2026-11-19T10:00:00Z', page_size: 50 });
    f = fake({ data: [] });
    await listMessages(f.client, 'c1');
    expect(f.rpc).toHaveBeenCalledWith('chat_list_messages', { conversation: 'c1', before_at: null, page_size: 50 });

    f = fake({ data: [] });
    await listConversations(f.client);
    expect(f.rpc).toHaveBeenCalledWith('chat_list_conversations');

    f = fake({});
    await markRead(f.client, 'c1');
    expect(f.rpc).toHaveBeenCalledWith('chat_mark_read', { conversation: 'c1' });
    f = fake({});
    await deleteMessage(f.client, 'm1');
    expect(f.rpc).toHaveBeenCalledWith('chat_delete_message', { message_id: 'm1' });
    f = fake({});
    await setMuted(f.client, 'c1', true);
    expect(f.rpc).toHaveBeenCalledWith('chat_set_muted', { conversation: 'c1', muted: true });
    f = fake({ data: 3 });
    expect(await unreadCount(f.client)).toBe(3);
    expect(f.rpc).toHaveBeenCalledWith('chat_unread_count');
    f = fake({});
    await reportMessage(f.client, 'm1', '  Insultos en el chat  ');
    expect(f.rpc).toHaveBeenCalledWith('report_chat_message', { message_id: 'm1', reason: 'Insultos en el chat' });
  });

  it('listMessages devuelve los mensajes del más antiguo al más nuevo y con nombres en camelCase', async () => {
    const newer = { ...ROW, id: 'm2', created_at: '2026-11-19T10:05:00+00:00', body: 'Segundo' };
    const f = fake({ data: [newer, ROW] });
    const messages = await listMessages(f.client, 'c1');
    expect(messages.map(m => m.id)).toEqual(['m1', 'm2']);
    expect(messages[0]).toEqual(MESSAGE);
  });

  it('un mensaje borrado o con campos nulos llega sin texto y sin carga, no rompe', async () => {
    const f = fake({ data: [{ ...ROW, body: null, payload: null, sender_name: null, deleted: true }] });
    expect((await listMessages(f.client, 'c1'))[0]).toMatchObject({ body: '', payload: {}, senderName: '', deleted: true });
  });

  it('listConversations convierte snake_case y deja valores seguros si faltan', async () => {
    const row = {
      id: 'c1', kind: 'direct', title: null, peer_id: 'u2', peer_name: 'Ana Ruta', peer_avatar_version: 3,
      peer_last_read_at: '2026-11-19T09:00:00+00:00', last_kind: 'text', last_preview: 'Hola', last_sender_id: 'u2',
      last_message_at: '2026-11-19T10:00:00+00:00', unread: 2, muted: false, can_send: true, last_deleted: false,
    };
    const expected: Conversation = {
      id: 'c1', kind: 'direct', title: null, peerId: 'u2', peerName: 'Ana Ruta', peerAvatarVersion: 3,
      peerLastReadAt: '2026-11-19T09:00:00+00:00', lastKind: 'text', lastPreview: 'Hola', lastDeleted: false, lastSenderId: 'u2',
      lastMessageAt: '2026-11-19T10:00:00+00:00', unread: 2, muted: false, canSend: true,
    };
    let f = fake({ data: [row] });
    expect(await listConversations(f.client)).toEqual([expected]);
    f = fake({ data: [{ ...row, unread: null, last_preview: null, last_kind: null, peer_last_read_at: null, muted: null, can_send: null, last_deleted: null }] });
    expect((await listConversations(f.client))[0]).toMatchObject({ unread: 0, lastPreview: '', lastKind: null, peerLastReadAt: null, muted: false, canSend: false, lastDeleted: false });
    f = fake({ data: [{ ...row, last_preview: '', last_deleted: true }] });
    expect((await listConversations(f.client))[0]).toMatchObject({ lastPreview: '', lastDeleted: true });
    f = fake({ data: null });
    expect(await listConversations(f.client)).toEqual([]);
  });

  it('unreadCount devuelve 0 si el servidor no manda un número', async () => {
    expect(await unreadCount(fake({ data: null }).client)).toBe(0);
    expect(await unreadCount(fake({ data: 'x' }).client)).toBe(0);
  });

  it('sendText rechaza sin llamar al servidor un texto vacío o de más de 2000 caracteres', async () => {
    const f = fake({ data: [ROW] });
    for (const body of ['', '   ', '\n\n', 'x'.repeat(MAX_MESSAGE_CHARS + 1)]) {
      await expect(sendText(f.client, 'c1', body, 'm1')).rejects.toThrow('Escribe un mensaje de 2000 caracteres como mucho.');
    }
    expect(f.rpc).not.toHaveBeenCalled();
    await sendText(f.client, 'c1', 'x'.repeat(MAX_MESSAGE_CHARS), 'm1');
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });

  it('cuenta los 2000 caracteres como el servidor: un emoji es uno', async () => {
    const f = fake({ data: [ROW] });
    await sendText(f.client, 'c1', '😀'.repeat(MAX_MESSAGE_CHARS), 'm1');
    expect(f.rpc).toHaveBeenCalledTimes(1);
    await expect(sendText(f.client, 'c1', '😀'.repeat(MAX_MESSAGE_CHARS + 1), 'm1')).rejects.toThrow();
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });

  it('sendText falla con el mensaje genérico si el servidor no devuelve el mensaje guardado', async () => {
    await expect(sendText(fake({ data: [] }).client, 'c1', 'Hola', 'm1')).rejects.toThrow(GENERIC);
  });

  it('reportMessage exige un motivo de 5 a 500 caracteres antes de llamar', async () => {
    const f = fake({});
    for (const reason of ['', ' abc ', 'x'.repeat(501)]) {
      await expect(reportMessage(f.client, 'm1', reason)).rejects.toThrow('Explica el motivo en 5 a 500 caracteres.');
    }
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['Conversación no disponible', 'Esta conversación ya no está disponible.'],
    ['Ya no sois amigos', 'Ya no sois amigos: no puedes escribir aquí.'],
    ['Mensaje no válido', 'Escribe un mensaje de 2000 caracteres como mucho.'],
    ['Demasiados mensajes seguidos', 'Vas muy rápido. Espera un momento y vuelve a enviar.'],
    ['Límite diario de mensajes', 'Has llegado al límite de mensajes de hoy.'],
    ['Usuario no disponible', 'Este ciclista no está disponible para interactuar.'],
    ['Denuncia no válida', 'Explica el motivo en 5 a 500 caracteres.'],
    ['Cuenta registrada necesaria', 'Necesitas una cuenta registrada para usar la comunidad.'],
    ['Sesión necesaria', 'Vuelve a iniciar sesión para continuar.'],
    ['Failed to fetch', GENERIC],
    ['toString', GENERIC],
  ])('traduce «%s»', async (server, shown) => {
    await expect(sendText(fake({ error: { message: server } }).client, 'c1', 'Hola', 'm1')).rejects.toThrow(shown);
  });

  it('newMessageId devuelve un UUID distinto cada vez', () => {
    const a = newMessageId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(newMessageId()).not.toBe(a);
  });
});

describe('chat: aviso de cambios para la insignia', () => {
  it('notifyChatChanged lanza el evento en window', () => {
    const heard = vi.fn();
    window.addEventListener(CHAT_CHANGED_EVENT, heard);
    notifyChatChanged();
    window.removeEventListener(CHAT_CHANGED_EVENT, heard);
    expect(CHAT_CHANGED_EVENT).toBe('fbt-chat-changed');
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
