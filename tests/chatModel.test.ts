import type { Conversation, Message } from '../src/social/chat';
import {
  clampMessage,
  counterText,
  groupByDay,
  isReadOnlyError,
  listTime,
  mergeMessages,
  messageTime,
  previewLine,
  seenMessageId,
  visibleConversations,
  type LocalMessage,
} from '../src/ui/chat/model';

const ME = 'u-me';
const PEER = 'u-peer';
const msg = (id: string, createdAt: string, over: Partial<LocalMessage> = {}): LocalMessage => ({
  id, conversationId: 'c1', senderId: PEER, senderName: 'Ana Prueba', createdAt, kind: 'text', body: `texto ${id}`, payload: {}, deleted: false, ...over,
});
const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'c1', kind: 'direct', title: null, peerId: PEER, peerName: 'Ana Prueba', peerAvatarVersion: 0, peerLastReadAt: null,
  lastKind: 'text', lastPreview: 'Hola', lastDeleted: false, lastSenderId: PEER, lastMessageAt: '2026-11-19T09:00:00Z',
  unread: 0, muted: false, canSend: true, ...over,
});

describe('mergeMessages', () => {
  it('no duplica un id y gana el del servidor sobre el optimista', () => {
    const optimistic = msg('m2', '2026-11-19T10:00:05Z', { senderId: ME, state: 'sending' });
    const server: Message = msg('m2', '2026-11-19T10:00:06Z', { senderId: ME, senderName: 'Yo' });
    const merged = mergeMessages([msg('m1', '2026-11-19T10:00:00Z'), optimistic], [server, server]);
    expect(merged.map(m => m.id)).toEqual(['m1', 'm2']);
    expect(merged[1].state).toBeUndefined();
    expect(merged[1].createdAt).toBe('2026-11-19T10:00:06Z');
  });

  it('conserva un mensaje fallido que el servidor no trae, y ordena por fecha y luego por id', () => {
    const failed = msg('zz', '2026-11-19T10:05:00Z', { senderId: ME, state: 'failed' });
    const merged = mergeMessages([failed], [msg('b', '2026-11-19T10:00:00Z'), msg('a', '2026-11-19T10:00:00Z'), msg('c', '2026-11-19T10:10:00Z')]);
    expect(merged.map(m => m.id)).toEqual(['a', 'b', 'zz', 'c']);
    expect(merged[2].state).toBe('failed');
  });
});

describe('groupByDay', () => {
  // 19 de noviembre de 2026 a las 10:00 en Madrid (UTC+1).
  const now = Date.parse('2026-11-19T09:00:00Z');

  it('separa hoy, ayer y una fecha anterior en Europe/Madrid', () => {
    const groups = groupByDay([
      msg('a', '2026-11-14T10:00:00Z'),
      msg('b', '2026-11-18T22:30:00Z'), // 23:30 en Madrid: ayer
      msg('c', '2026-11-18T23:30:00Z'), // 00:30 del 19 en Madrid: hoy
      msg('d', '2026-11-19T08:00:00Z'),
    ], now);
    expect(groups.map(g => g.label)).toEqual(['Sábado 14 de noviembre', 'Ayer', 'Hoy']);
    expect(groups.map(g => g.items.map(m => m.id))).toEqual([['a'], ['b'], ['c', 'd']]);
  });

  it('pone el año a un día de otro año', () => {
    expect(groupByDay([msg('a', '2025-12-31T12:00:00Z')], now)[0].label).toBe('Miércoles 31 de diciembre de 2025');
  });
});

describe('seenMessageId', () => {
  const thread = [
    msg('m1', '2026-11-19T09:00:00Z', { senderId: ME }),
    msg('m2', '2026-11-19T09:01:00Z'),
    msg('m3', '2026-11-19T09:02:00Z', { senderId: ME }),
    msg('m4', '2026-11-19T09:03:00Z', { senderId: ME }),
  ];

  it('devuelve el último mensaje propio que la otra persona ha leído', () => {
    expect(seenMessageId(conv({ peerLastReadAt: '2026-11-19T09:02:30Z' }), thread, ME)).toBe('m3');
    expect(seenMessageId(conv({ peerLastReadAt: '2026-11-19T09:03:00Z' }), thread, ME)).toBe('m4');
  });

  it('null sin lectura de la otra persona y null en grupos', () => {
    expect(seenMessageId(conv(), thread, ME)).toBeNull();
    expect(seenMessageId(conv({ kind: 'group', peerLastReadAt: '2026-11-19T10:00:00Z' }), thread, ME)).toBeNull();
  });

  it('no cuenta un mensaje que aún se envía o que falló', () => {
    const pending = [...thread, msg('m5', '2026-11-19T09:04:00Z', { senderId: ME, state: 'failed' })];
    expect(seenMessageId(conv({ peerLastReadAt: '2026-11-19T10:00:00Z' }), pending, ME)).toBe('m4');
  });
});

describe('previewLine', () => {
  it('texto propio con «Tú:» y ajeno tal cual', () => {
    expect(previewLine(conv({ lastSenderId: ME, lastPreview: 'Nos vemos' }), ME)).toBe('Tú: Nos vemos');
    expect(previewLine(conv({ lastPreview: '¿Quedamos?' }), ME)).toBe('¿Quedamos?');
  });

  it('«Mensaje borrado» sea cual sea el tipo', () => {
    expect(previewLine(conv({ lastDeleted: true, lastKind: 'ride' }), ME)).toBe('Mensaje borrado');
  });

  it('cada tipo dice qué se ha enviado y quién', () => {
    expect(previewLine(conv({ lastKind: 'ride' }), ME)).toBe('Te ha enviado una salida');
    expect(previewLine(conv({ lastKind: 'ride', lastSenderId: ME }), ME)).toBe('Has enviado una salida');
    expect(previewLine(conv({ lastKind: 'route' }), ME)).toBe('Te ha enviado una ruta');
    expect(previewLine(conv({ lastKind: 'library_route', lastSenderId: ME }), ME)).toBe('Has enviado una ruta');
    expect(previewLine(conv({ lastKind: 'proposal' }), ME)).toBe('Te ha propuesto una salida');
    expect(previewLine(conv({ lastKind: 'proposal', lastSenderId: ME }), ME)).toBe('Has propuesto una salida');
    expect(previewLine(conv({ lastKind: 'system', lastPreview: 'Marc se apunta' }), ME)).toBe('Marc se apunta');
    expect(previewLine(conv({ lastKind: null, lastPreview: '' }), ME)).toBe('');
  });
});

describe('visibleConversations', () => {
  it('quita las de dos sin mensajes o sin la otra persona', () => {
    const rows = [conv({ id: 'ok' }), conv({ id: 'empty', lastKind: null }), conv({ id: 'gone', peerId: null }), conv({ id: 'group', kind: 'group', peerId: null })];
    expect(visibleConversations(rows).map(c => c.id)).toEqual(['ok', 'group']);
  });
});

describe('horas y fechas', () => {
  const now = Date.parse('2026-11-19T09:00:00Z');
  it('hora de un mensaje en Madrid', () => {
    expect(messageTime('2026-11-19T08:30:00Z')).toBe('9:30');
    expect(messageTime('2026-11-19T17:05:00Z')).toBe('18:05');
  });
  it('en la lista: hora hoy, «Ayer» y día con mes antes', () => {
    expect(listTime('2026-11-19T08:42:00Z', now)).toBe('9:42');
    expect(listTime('2026-11-18T08:42:00Z', now)).toBe('Ayer');
    expect(listTime('2026-11-14T08:42:00Z', now)).toBe('14 nov');
  });
});

describe('campo de texto', () => {
  it('contador solo al pasar de 1800 caracteres, contando un emoji como uno', () => {
    expect(counterText('a'.repeat(1800))).toBeNull();
    expect(counterText('a'.repeat(1801))).toBe('1801/2000');
    expect(counterText('🚴'.repeat(1900))).toBe('1900/2000');
  });
  it('recorta a 2000 caracteres sin partir un emoji', () => {
    expect([...clampMessage('🚴'.repeat(2100))].length).toBe(2000);
    expect(clampMessage('hola')).toBe('hola');
  });
  it('reconoce los errores que dejan la conversación en solo lectura', () => {
    expect(isReadOnlyError('Ya no sois amigos: no puedes escribir aquí.')).toBe(true);
    expect(isReadOnlyError('Esta conversación ya no está disponible.')).toBe(true);
    expect(isReadOnlyError('Vas muy rápido. Espera un momento y vuelve a enviar.')).toBe(false);
  });
});
