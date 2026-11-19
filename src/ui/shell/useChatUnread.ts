import { useEffect, useState } from 'react';
import type { Account } from '../../auth/AccountBoundary';
import { unreadCount } from '../../social/chat';
import { CHAT_CHANGED_EVENT } from '../../social/chatBadge';

const REFRESH_MS = 60_000;

/**
 * Conversaciones de chat con mensajes sin leer. Solo con cuenta registrada. Se vuelve a leer al cambiar
 * de pantalla (`reloadKey`), al leer o recibir mensajes (`CHAT_CHANGED_EVENT`), al volver a la app (otro
 * dispositivo pudo leerlos) y cada minuto con la app a la vista. Si falla la red, no hay contador.
 */
export function useChatUnread(account: Account | null, reloadKey?: unknown): number {
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
      Promise.resolve().then(() => unreadCount(client)).then(
        (count) => { if (alive && mine === seq) setN(count); },
        () => { if (alive && mine === seq) setN(0); },
      );
    };
    read();
    const timer = window.setInterval(read, REFRESH_MS);
    window.addEventListener(CHAT_CHANGED_EVENT, read);
    document.addEventListener('visibilitychange', read);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(CHAT_CHANGED_EVENT, read);
      document.removeEventListener('visibilitychange', read);
    };
  }, [client, reloadKey]);
  return n;
}
