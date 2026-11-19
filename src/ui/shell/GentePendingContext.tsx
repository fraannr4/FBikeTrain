import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Account } from '../../auth/AccountBoundary';
import { useChatUnread } from './useChatUnread';
import { useCommunityBadge } from './useCommunityBadge';
import { useFriendRequests } from './useFriendRequests';

/** Lo pendiente en «Gente»: conversaciones sin leer, solicitudes de amistad y retos por atender. */
export type GentePending = { chats: number; amigos: number; retos: number; total: number };

const NONE: GentePending = { chats: 0, amigos: 0, retos: 0, total: 0 };
const GentePendingContext = createContext<GentePending>(NONE);

/** El armazón cuenta una vez lo pendiente; el muelle, el carril y `GenteNav` lo leen de aquí. */
export function GentePendingProvider({ value, children }: { value: GentePending; children: ReactNode }) {
  return <GentePendingContext.Provider value={value}>{children}</GentePendingContext.Provider>;
}

export const useGentePending = () => useContext(GentePendingContext);

/** Parte de «Gente» que se abre: la primera con pendientes en este orden; sin nada, Chats. */
export function genteStart(p: GentePending): '/chat' | '/retos' | '/perfil/amigos' {
  if (p.chats > 0) return '/chat';
  if (p.retos > 0) return '/retos';
  if (p.amigos > 0) return '/perfil/amigos';
  return '/chat';
}

/**
 * Los tres contadores, para el armazón. El chat se recuenta en cada cambio de pantalla (consulta corta;
 * un mensaje puede llegar en cualquiera); Retos y Amigos, al entrar y salir de sus pantallas.
 */
export function useGenteCounts(account: Account | null, pathname: string): GentePending {
  const chats = useChatUnread(account, pathname);
  const retos = useCommunityBadge(account, pathname.startsWith('/retos') ? pathname : '');
  const amigos = useFriendRequests(account, pathname.startsWith('/perfil/amigos') ? pathname : '');
  return useMemo(() => ({ chats, amigos, retos, total: chats + amigos + retos }), [chats, amigos, retos]);
}
