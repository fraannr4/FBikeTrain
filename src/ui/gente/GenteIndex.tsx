import { Navigate } from 'react-router-dom';
import { useAccount } from '../../auth/AccountBoundary';
import { genteStart, useGentePending } from '../shell/GentePendingContext';

/** `#/gente`: abre la parte que tenga algo pendiente (si no, Chats). En el modo local no hay Gente: va a Más. */
export function GenteIndex() {
  const account = useAccount();
  const pending = useGentePending();
  const to = account && !account.user.is_anonymous ? genteStart(pending) : '/mas';
  return <Navigate replace to={to} />;
}
