import { formatCommunityScore, lowerWins, type CommunityChallenge } from './communityChallenges';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** «Quedan 3 días», «Quedan 5 h» o «Plazo cerrado». Vacío si la fecha no es válida. */
export function timeLeftLabel(deadline: string, now: number): string {
  const end = Date.parse(deadline);
  if (!Number.isFinite(end)) return '';
  const left = end - now;
  if (left <= 0) return 'Plazo cerrado';
  const days = Math.floor(left / DAY);
  if (days >= 1) return days === 1 ? 'Queda 1 día' : `Quedan ${days} días`;
  const hours = Math.floor(left / HOUR);
  if (hours >= 1) return hours === 1 ? 'Queda 1 h' : `Quedan ${hours} h`;
  return 'Queda menos de 1 h';
}

export type DuelLead = { tone: 'ahead' | 'behind' | 'tied'; text: string };

/** Quién va por delante en un duelo con cifras de los dos, y por cuánto. En un segmento gana el menor tiempo. */
export function duelLead(challenge: CommunityChallenge, userId: string): DuelLead | null {
  if (challenge.members.length !== 2) return null;
  const mine = challenge.members.find(m => m.id === userId);
  const rival = challenge.members.find(m => m.id !== userId);
  if (!mine || !rival || mine.status !== 'accepted' || rival.status !== 'accepted') return null;
  const a = mine.score ?? 0;
  const b = rival.score ?? 0;
  if (a <= 0 || b <= 0) return null;
  if (a === b) return { tone: 'tied', text: 'Empatados' };
  const gap = formatCommunityScore(challenge.kind, Math.abs(a - b));
  const ahead = lowerWins(challenge.kind) ? a < b : a > b;
  return ahead ? { tone: 'ahead', text: `Vas por delante: +${gap}` } : { tone: 'behind', text: `${rival.display_name} te saca ${gap}` };
}

/** Enlace al perfil dentro de la app (enrutado por hash, también bajo la subruta de GitHub Pages). */
export function profileShareUrl(href: string, userId: string): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}#/personas/${encodeURIComponent(userId)}`;
}
