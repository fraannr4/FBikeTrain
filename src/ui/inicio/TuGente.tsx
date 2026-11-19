import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import { listConversations } from '../../social/chat';
import { CHAT_CHANGED_EVENT } from '../../social/chatBadge';
import { COMMUNITY_CHANGED_EVENT } from '../../social/communityBadge';
import { listCommunityChallenges } from '../../social/communityChallenges';
import { listFriends } from '../../social/friends';
import { pendingItems, type PendingItem } from '../../social/pending';
import { listTime } from '../chat/model';
import { List, ListRow } from '../components/ListRow';
import { Skeleton } from '../components/Skeleton';
import { formatCount } from '../format';
import { ChevronRight, Users } from '../icons';
import { ProfileAvatar } from '../profile/ProfileAvatar';
import '../styles/profile.css';
import '../styles/chat.css';

const SHOWN = 3;
type Loaded = { items: PendingItem[]; avatars: Map<string, number>; now: number };

/**
 * «Tu gente» en Inicio: hasta tres cosas que alguien espera de ti (chats sin leer, retos por
 * responder y solicitudes de amistad) y «Ver todo». Solo con cuenta registrada; sin ella no pinta
 * nada ni llama al servidor.
 */
export function TuGente() {
  const account = useAccount();
  return account && !account.user.is_anonymous ? <Pending account={account} /> : null;
}

function Pending({ account }: { account: Account }) {
  const { client, user } = account;
  const [state, setState] = useState<Loaded | 'loading' | 'failed'>('loading');

  useEffect(() => {
    let alive = true;
    const read = () => {
      if (document.hidden) return;
      Promise.all([listConversations(client), listCommunityChallenges(client, 0), listFriends(client)]).then(
        ([chats, retos, amigos]) => {
          if (!alive) return;
          const now = Date.now();
          const avatars = new Map(chats.map((c) => [c.id, c.peerAvatarVersion ?? 0]));
          setState({ items: pendingItems(chats, retos, amigos, user.id, now), avatars, now });
        },
        // Un fallo al releer no borra lo que ya se ve.
        () => { if (alive) setState((s) => (s === 'loading' ? 'failed' : s)); },
      );
    };
    read();
    window.addEventListener(CHAT_CHANGED_EVENT, read);
    window.addEventListener(COMMUNITY_CHANGED_EVENT, read);
    document.addEventListener('visibilitychange', read);
    return () => {
      alive = false;
      window.removeEventListener(CHAT_CHANGED_EVENT, read);
      window.removeEventListener(COMMUNITY_CHANGED_EVENT, read);
      document.removeEventListener('visibilitychange', read);
    };
  }, [client, user.id]);

  // Mientras carga, el alto de una fila: la semana no salta al llegar los datos.
  if (state === 'loading')
    return (
      <section className="people people--calm" aria-label="Tu gente" aria-busy="true">
        <div className="people-calm" role="status">
          <span className="sr-only">Cargando lo pendiente con tu gente…</span>
          <Skeleton width="45%" />
        </div>
      </section>
    );
  if (state === 'failed') return <CalmRow label="Tu gente. Abrir Gente" />;
  if (state.items.length === 0) return <CalmRow label="Tu gente: todo al día. Abrir Gente" note="Todo al día" />;

  const { items, avatars, now } = state;
  return (
    <section className="people" aria-labelledby="people-title">
      <div className="people-h">
        <h2 className="people-title" id="people-title">
          Tu gente
        </h2>
        <Link className="card-link" to="/gente" aria-label={`Ver todo lo pendiente con tu gente, ${formatCount(items.length)}`}>
          Ver todo
          <ChevronRight className="ic" aria-hidden="true" />
        </Link>
      </div>
      <List inset className="chat-list" label="Pendiente con tu gente">
        {items.slice(0, SHOWN).map((item) => {
          const time = item.at ? listTime(item.at, now) : '';
          const unread = item.unread === 1 ? '1 mensaje sin leer' : `${formatCount(item.unread)} mensajes sin leer`;
          return (
            <ListRow
              key={`${item.kind}-${item.id}`}
              to={item.to}
              lead={
                item.personId ? (
                  <ProfileAvatar client={client} userId={item.personId} name={item.name} version={avatars.get(item.id) ?? 0} />
                ) : (
                  <span className="profile-avatar chat-group-avatar">
                    <Users className="ic" />
                  </span>
                )
              }
              title={item.name}
              meta={<span dir="auto">{item.text}</span>}
              trail={
                <span className="chat-row-side">
                  {item.at ? (
                    <time className="chat-row-time" dateTime={item.at}>
                      {time}
                    </time>
                  ) : null}
                  {item.unread > 0 ? (
                    <span className="chat-row-count" aria-hidden="true">
                      {item.unread > 99 ? '99+' : formatCount(item.unread)}
                    </span>
                  ) : null}
                </span>
              }
              ariaLabel={item.unread > 0 ? `${item.name}, ${unread}. ${item.text} ${time}` : undefined}
            />
          );
        })}
      </List>
    </section>
  );
}

/** Una sola fila que lleva a Gente: «Todo al día» o, si no se ha podido saber, solo «Tu gente». */
function CalmRow({ label, note }: { label: string; note?: string }) {
  return (
    <section className="people people--calm" aria-label="Tu gente">
      <Link className="people-calm" to="/gente" aria-label={label}>
        <b>Tu gente</b>
        {note}
        <ChevronRight className="ic chev" aria-hidden="true" />
      </Link>
    </section>
  );
}
