import { describe, expect, it } from 'vitest';
import { duelLead, profileShareUrl, timeLeftLabel } from '../src/social/challengeStatus';
import type { CommunityChallenge, CommunityMember } from '../src/social/communityChallenges';

const H = 3_600_000;
const NOW = Date.parse('2026-11-16T10:00:00Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();

describe('timeLeftLabel', () => {
  it('cuenta días enteros hacia el cierre', () => {
    expect(timeLeftLabel(at(3 * 24 * H + H), NOW)).toBe('Quedan 3 días');
    expect(timeLeftLabel(at(1 * 24 * H + H), NOW)).toBe('Queda 1 día');
  });
  it('en el último día habla de horas', () => {
    expect(timeLeftLabel(at(5 * H), NOW)).toBe('Quedan 5 h');
    expect(timeLeftLabel(at(H / 2), NOW)).toBe('Queda menos de 1 h');
  });
  it('avisa del plazo cerrado', () => {
    expect(timeLeftLabel(at(-H), NOW)).toBe('Plazo cerrado');
    expect(timeLeftLabel('no-es-fecha', NOW)).toBe('');
  });
});

const member = (id: string, status: CommunityMember['status'], score: number | null): CommunityMember =>
  ({ id, username: id, display_name: id === 'me' ? 'Fran' : 'Marta', status, accepted_at: null, score, updated_at: null });
const duel = (kind: CommunityChallenge['kind'], mine: number | null, theirs: number | null, theirStatus: CommunityMember['status'] = 'accepted'): CommunityChallenge => ({
  id: 'c', title: 't', kind, created_at: at(-H), deadline: at(H), creator_id: 'me', target_value: null, distance_m: null, segment_key: null,
  status: 'active', members: [member('me', 'accepted', mine), member('p2', theirStatus, theirs)], winner_ids: [],
});

describe('duelLead', () => {
  it('dice quién va por delante y por cuánto', () => {
    expect(duelLead(duel('distance', 42_000, 38_500), 'me')).toEqual({ tone: 'ahead', text: 'Vas por delante: +3,5 km' });
    expect(duelLead(duel('distance', 38_500, 42_000), 'me')).toEqual({ tone: 'behind', text: 'Marta te saca 3,5 km' });
  });
  it('en un segmento gana el menor tiempo', () => {
    expect(duelLead(duel('segment', 600, 650), 'me')).toEqual({ tone: 'ahead', text: 'Vas por delante: +0:50' });
    expect(duelLead(duel('segment', 650, 600), 'me')).toEqual({ tone: 'behind', text: 'Marta te saca 0:50' });
  });
  it('reconoce el empate', () => {
    expect(duelLead(duel('distance', 5000, 5000), 'me')).toEqual({ tone: 'tied', text: 'Empatados' });
  });
  it('sin cifras de los dos, no compara', () => {
    expect(duelLead(duel('distance', 5000, null), 'me')).toBeNull();
    expect(duelLead(duel('distance', 5000, 0), 'me')).toBeNull();
    expect(duelLead(duel('distance', 5000, 4000, 'pending'), 'me')).toBeNull();
  });
  it('solo compara duelos', () => {
    const group = duel('distance', 5000, 4000);
    group.members.push(member('p3', 'accepted', 100));
    expect(duelLead(group, 'me')).toBeNull();
  });
});

describe('profileShareUrl', () => {
  it('apunta al perfil dentro de la app con enrutado por hash', () => {
    expect(profileShareUrl('https://x.github.io/FBikeTrain/?a=1#/perfil', 'abc-1')).toBe('https://x.github.io/FBikeTrain/#/personas/abc-1');
  });
});
