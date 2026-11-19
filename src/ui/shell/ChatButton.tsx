import { Link } from 'react-router-dom';
import { useAccount } from '../../auth/AccountBoundary';
import { chatUnreadLabel } from '../../social/chatBadge';
import { MessageCircle } from '../icons';
import { useChatUnreadCount } from './ChatUnreadContext';

/** Acceso al chat en la barra superior de las pantallas raíz del móvil, junto a tu foto. En PC lo lleva el carril. */
export function ChatButton() {
  const account = useAccount();
  const unread = useChatUnreadCount();
  if (!account || account.user.is_anonymous) return null;
  return (
    <Link className="icon-btn appbar-chat" to="/chat" aria-label={chatUnreadLabel(unread)}>
      <MessageCircle className="ic" aria-hidden="true" />
      {unread > 0 ? (
        <span className="tab-badge" aria-hidden="true">
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
