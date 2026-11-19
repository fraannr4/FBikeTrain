import type { Conversation } from '../src/social/chat';
import type { CommunityChallenge, CommunityMember } from '../src/social/communityChallenges';
import type { FriendRow } from '../src/social/friends';
import { pendingItems } from '../src/social/pending';

// Jueves 19 de noviembre de 2026, 12:00 en Madrid.
const NOW = Date.parse('2026-11-19T11:00:00Z');
const DAY = 86_400_000;
const ME = 'yo';

function chat(id: string, over: Partial<Conversation> = {}): Conversation {
  return {
    id, kind: 'direct', title: null, peerId: `p-${id}`, peerName: `Ciclista ${id}`, peerAvatarVersion: 0,
    peerLastReadAt: null, lastKind: 'text', lastPreview: `Hola desde ${id}`, lastDeleted: false,
    lastSenderId: `p-${id}`, lastMessageAt: '2026-11-19T09:00:00Z', unread: 1, muted: false, canSend: true,
    ...over,
  };
}

const member = (id: string, status: CommunityMember['status'], name = id): CommunityMember =>
  ({ id, username: id, display_name: name, status, accepted_at: null, score: null, updated_at: null });

function challenge(id: string, over: Partial<CommunityChallenge> = {}): CommunityChallenge {
  return {
    id, title: `Reto ${id}`, kind: 'distance', created_at: '2026-11-19T08:00:00Z',
    deadline: new Date(NOW + 7 * DAY).toISOString(), creator_id: 'marta', target_value: null, distance_m: null,
    segment_key: null, status: 'active', winner_ids: [],
    members: [member('marta', 'accepted', 'Marta Puig'), member(ME, 'pending')],
    ...over,
  };
}

const request = (id: string, direction: FriendRow['direction'] = 'received', status: FriendRow['status'] = 'pending'): FriendRow => ({
  friendship_id: id, status, direction,
  profile: { id: `u-${id}`, username: id, display_name: `Persona ${id}`, locality: null, distance_km: null },
});

describe('pendingItems: lo pendiente con tu gente, como lista', () => {
  it('sin nada pendiente, vacía', () => {
    expect(pendingItems([], [], [], ME, NOW)).toEqual([]);
  });

  it('un chat sin leer: quién, la última línea, cuántos y adónde lleva', () => {
    const [item] = pendingItems([chat('a', { unread: 2, lastPreview: '¿Quedamos a las 8:15 mejor?' })], [], [], ME, NOW);
    expect(item).toEqual({
      kind: 'chat', id: 'a', personId: 'p-a', name: 'Ciclista a', text: '¿Quedamos a las 8:15 mejor?',
      at: '2026-11-19T09:00:00Z', unread: 2, to: '/chat/a',
    });
  });

  it('deja fuera los chats leídos y los que la lista de chats no enseña', () => {
    const items = pendingItems(
      [chat('leido', { unread: 0 }), chat('vacio', { lastKind: null }), chat('sin-persona', { peerId: null }), chat('si')],
      [], [], ME, NOW,
    );
    expect(items.map((i) => i.id)).toEqual(['si']);
  });

  it('un chat con el último mensaje borrado dice «Mensaje borrado»', () => {
    const [item] = pendingItems([chat('b', { lastDeleted: true })], [], [], ME, NOW);
    expect(item.text).toBe('Mensaje borrado');
  });

  it('un grupo se nombra por su título y no tiene persona', () => {
    const [item] = pendingItems([chat('g', { kind: 'group', title: 'Grupeta del sábado', peerId: null, peerName: null })], [], [], ME, NOW);
    expect(item).toMatchObject({ name: 'Grupeta del sábado', personId: null, to: '/chat/g' });
  });

  it('una invitación a un reto: quién te reta y a qué', () => {
    const [item] = pendingItems([], [challenge('r1', { title: 'Más kilómetros esta semana' })], [], ME, NOW);
    expect(item).toEqual({
      kind: 'challenge', id: 'r1', personId: 'marta', name: 'Marta Puig', text: 'Te reta: Más kilómetros esta semana',
      at: '2026-11-19T08:00:00Z', unread: 0, to: '/retos/comunidad/r1',
    });
  });

  it('un reto aceptado que acaba hoy pide atención; los demás retos, no', () => {
    const today = new Date(NOW + 3 * 3_600_000).toISOString();
    const accepted = [member('marta', 'accepted', 'Marta Puig'), member(ME, 'accepted')];
    const items = pendingItems([], [
      challenge('hoy', { deadline: today, members: accepted }),
      challenge('luego', { members: accepted }),
      challenge('cerrado', { status: 'finished' }),
      challenge('vencido', { deadline: new Date(NOW - DAY).toISOString() }),
      challenge('rechazado', { members: [member('marta', 'accepted'), member(ME, 'declined')] }),
    ], [], ME, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'hoy', name: 'Reto hoy', text: 'Acaba hoy', personId: null });
  });

  it('una solicitud de amistad recibida; las enviadas y las aceptadas no cuentan', () => {
    const items = pendingItems([], [], [request('pol'), request('env', 'sent'), request('amigo', 'received', 'accepted')], ME, NOW);
    expect(items).toEqual([{
      kind: 'friend', id: 'pol', personId: 'u-pol', name: 'Persona pol', text: 'Quiere ser tu amigo',
      at: null, unread: 0, to: '/perfil/amigos',
    }]);
  });

  it('mezcla las tres fuentes de lo más reciente a lo más antiguo; lo que no tiene fecha, al final', () => {
    const items = pendingItems(
      [chat('viejo', { lastMessageAt: '2026-11-17T10:00:00Z' }), chat('nuevo', { lastMessageAt: '2026-11-19T10:42:00Z' })],
      [challenge('reto', { created_at: '2026-11-19T09:15:00Z' })],
      [request('pol')],
      ME, NOW,
    );
    expect(items.map((i) => i.id)).toEqual(['nuevo', 'reto', 'viejo', 'pol']);
  });
});
