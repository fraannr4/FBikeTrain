import { pendingChallenges } from '../src/social/communityBadge';
import type { CommunityChallenge, CommunityMember } from '../src/social/communityChallenges';

const NOW = Date.parse('2026-11-16T10:00:00Z');
const HOUR = 3_600_000;
const member = (id: string, status: CommunityMember['status']): CommunityMember => ({ id, username: id, display_name: id, status, accepted_at: null, score: null, updated_at: null });
const challenge = (id: string, mine: CommunityMember['status'], deadline: number, over: Partial<CommunityChallenge> = {}): CommunityChallenge => ({
  id, title: id, kind: 'distance', created_at: new Date(NOW - 48 * HOUR).toISOString(), deadline: new Date(deadline).toISOString(), creator_id: 'p2',
  target_value: null, distance_m: null, segment_key: null, status: 'active', members: [member('u1', mine), member('p2', 'accepted')], winner_ids: [], ...over,
});

describe('pendingChallenges', () => {
  it('cuenta las invitaciones por aceptar y los retos aceptados que acaban hoy', () => {
    const rows = [
      challenge('invitacion', 'pending', NOW + 72 * HOUR),
      challenge('acaba-hoy', 'accepted', NOW + 5 * HOUR),
      challenge('acaba-otro-dia', 'accepted', NOW + 72 * HOUR),
      challenge('rechazado', 'declined', NOW + 5 * HOUR),
      challenge('terminado', 'pending', NOW + 5 * HOUR, { status: 'finished' }),
      challenge('vencido', 'pending', NOW - HOUR),
    ];
    expect(pendingChallenges(rows, 'u1', NOW)).toBe(2);
  });

  it('sin retos, nada pendiente', () => {
    expect(pendingChallenges([], 'u1', NOW)).toBe(0);
  });
});
