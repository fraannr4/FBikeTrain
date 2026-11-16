import type { StoredActivity, TrackPoint } from '../src/domain/types';
import type { CommunityChallenge } from '../src/social/communityChallenges';
import { bestDistanceSpeed, climbSegmentKey, scoreCommunityChallenge, syncCommunityScores } from '../src/social/challengeScoring';
import { detectClimbs } from '../src/metrics/climbs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from '../src/db/db';

const START = Date.parse('2026-11-16T09:00:00Z');
const challenge = (kind: CommunityChallenge['kind'] = 'distance'): CommunityChallenge => ({
  id: 'c', title: 'Reto sintético', kind, created_at: new Date(START).toISOString(), deadline: new Date(START + 86_400_000).toISOString(), creator_id: 'me',
  target_value: null, distance_m: 1000, segment_key: null, status: 'active', winner_ids: [],
  members: [{ id: 'me', username: 'me', display_name: 'Yo', status: 'accepted', accepted_at: new Date(START).toISOString(), score: null, updated_at: null }],
});
const ride = (id = 'a', over: Partial<StoredActivity> = {}): StoredActivity => ({
  id, startTime: START + 1000, sport: 'cycling', hasTrack: true, importedAt: START, source: 'gpx',
  totals: { distanceM: 2000, elevGainM: 200, elapsedTimeS: 400, movingTimeS: 300, avgSpeedMs: 6.67, maxSpeedMs: 10 }, ...over,
});

describe('retos: puntuación local y consentimiento', () => {
  it('suma una vez, excluye demo, fechas anteriores y salidas incompletas/futuras', async () => {
    const a = ride();
    const activities = [a, a, ride('demo-x'), ride('old', { startTime: START - 1 }), ride('late', { startTime: START + 86_300_000 }), ride('nan', { startTime: NaN })];
    expect(await scoreCommunityChallenge(challenge(), 'me', activities, undefined, START + 1000_000)).toBe(2000);
    expect(await scoreCommunityChallenge(challenge('elevation'), 'me', activities, undefined, START + 1000_000)).toBe(200);
    expect(await scoreCommunityChallenge(challenge('rides'), 'me', activities, undefined, START + 1000_000)).toBe(1);
  });
  it('no puntúa un invitado pendiente/rechazado ni una actividad anterior a aceptar', async () => {
    const c = challenge(); c.members[0].status = 'pending';
    expect(await scoreCommunityChallenge(c, 'me', [ride()])).toBe(0);
    c.members[0].status = 'accepted'; c.members[0].accepted_at = new Date(START + 2000).toISOString();
    expect(await scoreCommunityChallenge(c, 'me', [ride()])).toBe(0);
    expect(await scoreCommunityChallenge(c, 'outsider', [ride()])).toBe(0);
  });
  it('las cifras no válidas no contaminan desnivel o distancia', async () => {
    const a = ride(); a.totals.elevGainM = NaN;
    expect(await scoreCommunityChallenge(challenge('elevation'), 'me', [a])).toBe(0);
    a.totals.distanceM = Infinity;
    expect(await scoreCommunityChallenge(challenge(), 'me', [a])).toBe(0);
  });
});

describe('mejor media en una distancia continua', () => {
  const point = (t: number, dist: number): TrackPoint => ({ t: START + t * 1000, dist });
  it('interpola exactamente la distancia e incluye las paradas', () => {
    expect(bestDistanceSpeed([point(0, 0), point(60, 300), point(120, 600), point(180, 900), point(240, 1200)], 1000)).toBe(5);
    expect(bestDistanceSpeed([point(0, 0), point(50, 500), point(100, 500), point(150, 1000)], 1000)).toBeCloseTo(1000 / 150);
    expect(bestDistanceSpeed([point(0, 0), point(10, 500)], 1000)).toBe(0);
  });
  it('explora ventanas cuyo inicio está entre muestras (óptimo anclado al final)', () => {
    expect(bestDistanceSpeed([point(0, 0), point(100, 100), point(140, 500), point(180, 900), point(220, 1300)], 1000)).toBeCloseTo(10);
  });
  it('rechaza huecos, reinicios, velocidades imposibles y tiempos invertidos', () => {
    expect(bestDistanceSpeed([point(0, 0), point(200, 1000)], 1000)).toBe(0);
    expect(bestDistanceSpeed([point(0, 500), point(20, 400), point(40, 800)], 800)).toBe(0);
    expect(bestDistanceSpeed([point(0, 0), point(10, 1000)], 1000)).toBe(0);
    expect(bestDistanceSpeed([point(20, 0), point(10, 400), point(30, 900)], 800)).toBe(0);
    expect(bestDistanceSpeed([point(0, 0), { t: NaN, dist: 100 }, point(80, 1000)], 1000)).toBe(0);
  });
  it('usa el track local, nunca la velocidad media de la salida completa', async () => {
    const a = ride(); a.totals.avgSpeedMs = 30;
    const read = vi.fn().mockResolvedValue([point(1, 0), point(61, 300), point(121, 600), point(181, 900), point(241, 1200)]);
    expect(await scoreCommunityChallenge(challenge('speed'), 'me', [a], read)).toBe(5);
    expect(read).toHaveBeenCalledWith('a');
  });
});

describe('segmento/subida: firma orientada y sin geometría remota', () => {
  const points: TrackPoint[] = Array.from({ length: 100 }, (_, i) => ({ t: START + 1000 + i * 10_000, lat: 40 + i * .0002, lng: 2, ele: 100 + i * 1.5 }));
  it('compara una subida equivalente usando solo un código SHA-256', async () => {
    const climb = detectClimbs(points)[0];
    expect(climb).toBeDefined();
    const key = await climbSegmentKey(climb, points);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(await climbSegmentKey(climb, points)).toBe(key);
    const c = challenge('segment'); c.segment_key = key;
    const a = ride(); a.totals.elapsedTimeS = 1100;
    expect(await scoreCommunityChallenge(c, 'me', [a], async () => points)).toBe(climb.timeS);
    c.segment_key = '0'.repeat(64);
    expect(await scoreCommunityChallenge(c, 'me', [a], async () => points)).toBe(0);
  });
});

describe('snapshot idempotente del marcador', () => {
  beforeEach(async () => { await db.activities.clear(); await db.meta.clear(); });
  afterEach(async () => { await db.activities.clear(); await db.meta.clear(); });
  it('reemplaza el total y envía cero después de borrar, sin tracks ni datos identificativos de salidas', async () => {
    const c = challenge(); c.created_at = new Date(Date.now() - 86_400_000).toISOString(); c.deadline = new Date(Date.now() + 86_400_000).toISOString();
    c.members[0].accepted_at = c.created_at; c.members[0].score = 123;
    const rpc = vi.fn(async (name: string) => ({ data: name === 'list_community_challenges' ? [c] : null, error: null }));
    const client = { rpc } as unknown as SupabaseClient;
    await db.meta.put({ key: 'community-score-source:c', value: { userId: 'me', score: 123 } });
    await syncCommunityScores(client, 'me');
    expect(rpc).toHaveBeenCalledWith('submit_community_score', { challenge_id: 'c', score: 0 });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/lat|lng|points|activity_id|Casa/);
  });
  it('otro dispositivo vacío conserva el marcador remoto hasta reemplazo explícito', async () => {
    const c = challenge(); c.deadline = new Date(Date.now() + 86_400_000).toISOString(); c.members[0].score = 123;
    const rpc = vi.fn(async (name: string) => ({ data: name === 'list_community_challenges' ? [c] : null, error: null }));
    const client = { rpc } as unknown as SupabaseClient;
    await syncCommunityScores(client, 'me');
    expect(rpc).not.toHaveBeenCalledWith('submit_community_score', expect.anything());
    await syncCommunityScores(client, 'me', { challengeId: 'c', replaceRemote: true });
    expect(rpc).toHaveBeenCalledWith('submit_community_score', { challenge_id: 'c', score: 0 });
  });
  it('un origen local viejo no pisa una cifra distinta enviada desde otro dispositivo', async () => {
    const c = challenge(); c.deadline = new Date(Date.now() + 86_400_000).toISOString(); c.members[0].score = 200;
    await db.meta.put({ key: 'community-score-source:c', value: { userId: 'me', score: 100 } });
    const rpc = vi.fn(async (name: string) => ({ data: name === 'list_community_challenges' ? [c] : null, error: null }));
    await syncCommunityScores({ rpc } as unknown as SupabaseClient, 'me');
    expect(rpc).not.toHaveBeenCalledWith('submit_community_score', expect.anything());
  });
});
