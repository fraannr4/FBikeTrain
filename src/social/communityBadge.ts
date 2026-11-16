import { localDay } from '../metrics/calendar';
import type { CommunityChallenge } from './communityChallenges';

/** Se lanza al responder una invitación: la barra vuelve a contar sin esperar a cambiar de pantalla. */
export const COMMUNITY_CHANGED_EVENT = 'fbt-community-changed';

export const notifyCommunityChanged = () => window.dispatchEvent(new Event(COMMUNITY_CHANGED_EVENT));

/**
 * Lo que pide una acción en Retos: invitaciones por aceptar y retos aceptados que acaban hoy
 * (día de Europe/Madrid). Los avisos de resultados no cuentan, para que el número no sea ruido.
 */
export function pendingChallenges(rows: CommunityChallenge[], userId: string, now: number): number {
  const today = localDay(now);
  return rows.filter((c) => {
    const deadline = Date.parse(c.deadline);
    if (c.status !== 'active' || !(deadline > now)) return false;
    const mine = c.members.find((m) => m.id === userId)?.status;
    return mine === 'pending' || (mine === 'accepted' && localDay(deadline) === today);
  }).length;
}
