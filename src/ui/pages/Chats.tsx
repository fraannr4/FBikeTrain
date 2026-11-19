import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import { listConversations, type Conversation } from '../../social/chat';
import { CHAT_CHANGED_EVENT } from '../../social/chatBadge';
import { listTime, previewLine, visibleConversations } from '../chat/model';
import { Banner } from '../components/Banner';
import { EmptyState } from '../components/EmptyState';
import { List, ListRow } from '../components/ListRow';
import { Page } from '../components/Page';
import { SkeletonRows } from '../components/Skeleton';
import { StateView } from '../components/StateView';
import { formatCount } from '../format';
import { CircleAlert, MessageCircle, SquarePen, Users } from '../icons';
import { ProfileAvatar } from '../profile/ProfileAvatar';
import '../styles/profile.css';
import '../styles/chat.css';

const REFRESH_MS = 30_000;
const message = (e: unknown) => (e instanceof Error ? e.message : 'No se ha podido completar. Comprueba la conexión e inténtalo de nuevo.');
export const REGISTERED_ONLY = 'Necesitas una cuenta registrada para usar el chat.';

/** `#/chat`: pantalla raíz con la lista de conversaciones. «Nuevo chat» abre tus amigos. */
export function Chats() {
  const account = useAccount();
  return (
    <Page
      title="Chat"
      actions={
        <Link className="icon-btn" to="/perfil/amigos" aria-label="Nuevo chat">
          <SquarePen className="ic" aria-hidden="true" />
        </Link>
      }
    >
      {account && !account.user.is_anonymous ? <ConversationList account={account} /> : <p>{REGISTERED_ONLY}</p>}
    </Page>
  );
}

/**
 * Conversaciones, de la más reciente a la más antigua. Se relee al entrar, al volver a la app, al leer
 * una conversación y cada 30 s a la vista. También es la columna de la izquierda en escritorio.
 */
export function ConversationList({ account }: { account: Account }) {
  const { client, user } = account;
  const [rows, setRows] = useState<Conversation[] | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const list = await listConversations(client);
      setRows(visibleConversations(list));
      setNow(Date.now());
      setError('');
    } catch (e) {
      setError(message(e));
    }
  }, [client]);

  useEffect(() => {
    void load();
    const visible = () => { if (!document.hidden) void load(); };
    const timer = window.setInterval(visible, REFRESH_MS);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener(CHAT_CHANGED_EVENT, visible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener(CHAT_CHANGED_EVENT, visible);
    };
  }, [load]);

  const retry = <button type="button" className="btn btn--secondary" onClick={() => void load()}>Reintentar</button>;
  if (rows === null) {
    return error
      ? <StateView icon={CircleAlert} tone="error" level={2} title="No se han podido cargar tus conversaciones" text={error} action={retry} />
      : <SkeletonRows rows={3} label="Cargando tus conversaciones…" />;
  }
  return (
    <>
      {error ? <Banner tone="error" action={retry}>{error}</Banner> : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title="Aún no has hablado con nadie"
          text="Aquí verás tus conversaciones. Puedes escribir a cualquiera de tus amigos."
          action={<Link className="btn btn--primary" to="/perfil/amigos">Escribe a un amigo</Link>}
        />
      ) : (
        <List inset className="chat-list" label="Conversaciones">
          {rows.map((c) => {
            const name = (c.kind === 'group' ? c.title : c.peerName) || 'Ciclista';
            const preview = previewLine(c, user.id);
            const time = listTime(c.lastMessageAt, now);
            const unread = c.unread > 0 ? `${c.unread === 1 ? '1 mensaje sin leer' : `${formatCount(c.unread)} mensajes sin leer`}` : '';
            return (
              <ListRow
                key={c.id}
                to={`/chat/${encodeURIComponent(c.id)}`}
                lead={c.kind === 'direct' && c.peerId
                  ? <ProfileAvatar client={client} userId={c.peerId} name={name} version={c.peerAvatarVersion ?? 0} />
                  : <span className="profile-avatar chat-group-avatar"><Users className="ic" /></span>}
                title={name}
                meta={<span dir="auto">{preview}</span>}
                trail={
                  <span className="chat-row-side">
                    <time className="chat-row-time" dateTime={c.lastMessageAt}>{time}</time>
                    {c.unread > 0 ? <span className="chat-row-count" aria-hidden="true">{c.unread > 99 ? '99+' : formatCount(c.unread)}</span> : null}
                  </span>
                }
                ariaLabel={unread ? `${name}, ${unread}. ${preview} ${time}` : undefined}
              />
            );
          })}
        </List>
      )}
    </>
  );
}
