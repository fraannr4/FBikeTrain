import { useEffect, useState } from 'react';
import type { Account } from '../../auth/AccountBoundary';
import { COMMUNITY_CHANGED_EVENT, pendingChallenges } from '../../social/communityBadge';
import { listCommunityChallenges } from '../../social/communityChallenges';

/**
 * Contador de la pestaña Retos. Solo con cuenta registrada. Se vuelve a leer al entrar o salir de
 * Retos (`reloadKey`), al responder una invitación (`COMMUNITY_CHANGED_EVENT`) y al volver a la app.
 * Si falla la red, no hay contador.
 */
export function useCommunityBadge(account: Account | null, reloadKey?: unknown): number {
  const [n, setN] = useState(0);
  const client = account && !account.user.is_anonymous ? account.client : null;
  const userId = account?.user.id;
  useEffect(() => {
    if (!client || !userId) {
      setN(0);
      return;
    }
    let alive = true;
    let seq = 0;
    const read = () => {
      if (document.hidden) return;
      const mine = ++seq;
      listCommunityChallenges(client, 0).then(
        (rows) => { if (alive && mine === seq) setN(pendingChallenges(rows, userId, Date.now())); },
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
  }, [client, userId, reloadKey]);
  return n;
}
