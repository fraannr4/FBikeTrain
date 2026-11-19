import { useEffect, useState } from 'react';
import type { Account } from '../../auth/AccountBoundary';
import { COMMUNITY_CHANGED_EVENT } from '../../social/communityBadge';
import { listFriends } from '../../social/friends';

/**
 * Solicitudes de amistad recibidas sin responder. Solo con cuenta registrada. Se vuelve a leer al
 * cambiar `reloadKey`, al responder (`COMMUNITY_CHANGED_EVENT`) y al volver a la app. Si falla la
 * red, cero.
 */
export function useFriendRequests(account: Account | null, reloadKey?: unknown): number {
  const [n, setN] = useState(0);
  const client = account && !account.user.is_anonymous ? account.client : null;
  useEffect(() => {
    if (!client) {
      setN(0);
      return;
    }
    let alive = true;
    let seq = 0;
    const read = () => {
      if (document.hidden) return;
      const mine = ++seq;
      listFriends(client).then(
        (rows) => { if (alive && mine === seq) setN(rows.filter((f) => f.status === 'pending' && f.direction === 'received').length); },
        () => { if (alive && mine === seq) setN(0); },
      );
    };
    read();
    window.addEventListener(COMMUNITY_CHANGED_EVENT, read);
    document.addEventListener('visibilitychange', read);
    return () => {
      alive = false;
      window.removeEventListener(COMMUNITY_CHANGED_EVENT, read);
      document.removeEventListener('visibilitychange', read);
    };
  }, [client, reloadKey]);
  return n;
}
