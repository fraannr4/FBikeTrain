import { previewLine, visibleConversations } from '../ui/chat/model';
import type { Conversation } from './chat';
import { challengeNeedsYou } from './communityBadge';
import type { CommunityChallenge } from './communityChallenges';
import type { FriendRow } from './friends';

/** Una fila de «Tu gente» en Inicio: lo que alguien espera de ti. */
export type PendingItem = {
  kind: 'chat' | 'challenge' | 'friend';
  id: string;            // conversación, reto o amistad
  personId: string | null;
  name: string;          // quién
  text: string;          // «¿Quedamos a las 8:15 mejor?», «Te reta: más kilómetros esta semana», «Quiere ser tu amigo»
  at: string | null;     // ISO, para ordenar y para la hora
  unread: number;        // solo chats
  to: string;            // /chat/<id>, /retos/comunidad/<id>, /perfil/amigos (rutas del router)
};

const fromChat = (c: Conversation, myId: string): PendingItem => ({
  kind: 'chat',
  id: c.id,
  personId: c.kind === 'direct' ? c.peerId : null,
  name: (c.kind === 'group' ? c.title : c.peerName) || 'Ciclista',
  text: previewLine(c, myId),
  at: c.lastMessageAt,
  unread: c.unread,
  to: `/chat/${encodeURIComponent(c.id)}`,
});

/** Invitación: quién te reta. Aceptado que acaba hoy: el reto mismo. */
function fromChallenge(c: CommunityChallenge, myId: string): PendingItem {
  const invited = c.members.find((m) => m.id === myId)?.status === 'pending';
  const creator = c.members.find((m) => m.id === c.creator_id);
  return {
    kind: 'challenge',
    id: c.id,
    personId: invited ? c.creator_id : null,
    name: invited ? creator?.display_name || creator?.username || 'Ciclista' : c.title,
    text: invited ? `Te reta: ${c.title}` : 'Acaba hoy',
    at: c.created_at,
    unread: 0,
    to: `/retos/comunidad/${encodeURIComponent(c.id)}`,
  };
}

const fromRequest = (f: FriendRow): PendingItem => ({
  kind: 'friend',
  id: f.friendship_id,
  personId: f.profile.id,
  name: f.profile.display_name || f.profile.username,
  text: 'Quiere ser tu amigo',
  at: null,
  unread: 0,
  to: '/perfil/amigos',
});

const time = (i: PendingItem) => (i.at ? Date.parse(i.at) : -Infinity);

/** De más reciente a más antiguo; lo que no tiene fecha, al final. */
export function pendingItems(conversations: Conversation[], challenges: CommunityChallenge[], friends: FriendRow[], myId: string, now: number): PendingItem[] {
  return [
    ...visibleConversations(conversations).filter((c) => c.unread > 0).map((c) => fromChat(c, myId)),
    ...challenges.filter((c) => challengeNeedsYou(c, myId, now)).map((c) => fromChallenge(c, myId)),
    ...friends.filter((f) => f.status === 'pending' && f.direction === 'received').map(fromRequest),
  ].sort((a, b) => time(b) - time(a));
}
