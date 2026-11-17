import type { SupabaseClient } from '@supabase/supabase-js';
import { duelLead } from '../../social/challengeStatus';
import { formatCommunityScore, lowerWins, type CommunityChallenge } from '../../social/communityChallenges';
import { ProfileAvatar } from '../profile/ProfileAvatar';
import '../styles/profile.css';

/** Presentation only: existing member snapshots, with no extra profile queries. */
export function DuelComparison({ challenge, userId, client, compact = false }: {
  challenge: CommunityChallenge; userId: string; client: SupabaseClient; compact?: boolean;
}) {
  const mine = challenge.members.find(m => m.id === userId);
  const rival = challenge.members.find(m => m.id !== userId);
  if (!mine || !rival) return null;
  const comparable = [mine, rival].every(m => m.status === 'accepted' && (m.score ?? 0) > 0);
  const total = (mine.score ?? 0) + (rival.score ?? 0);
  const fraction = total > 0 ? (lowerWins(challenge.kind) ? (rival.score ?? 0) : (mine.score ?? 0)) / total : .5;
  const lead = challenge.status === 'active' ? duelLead(challenge, userId) : null;
  return <div className={`community-duel${compact ? ' community-duel--compact' : ''}`} role="group" aria-label="Comparativa del duelo">
    <div className="community-duel-people">{[mine, rival].map(member => <div className="community-duel-person" key={member.id}>
      <ProfileAvatar client={client} userId={member.id} name={member.display_name} version={(member as typeof member & { avatar_version?: number }).avatar_version ?? 0} />
      <span className="community-duel-name">{member.id === userId ? 'Tú' : member.display_name}</span>
      <strong>{member.status === 'pending' ? 'Pendiente' : member.status === 'declined' ? 'Rechazado' : challenge.kind === 'route' && !member.score ? 'Pendiente de salida' : formatCommunityScore(challenge.kind, member.score)}</strong>
    </div>)}</div>
    <span className="community-duel-vs" aria-hidden="true">VS</span>
    {comparable && <div className="community-duel-track" aria-hidden="true"><span style={{ transform: `scaleX(${fraction})` }} /></div>}
    {lead && <p className="community-duel-lead" data-tone={lead.tone}>{lead.text}</p>}
  </div>;
}
