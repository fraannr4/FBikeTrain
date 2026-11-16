import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoredActivity, TrackPoint, DetectedClimb } from '../domain/types';
import { db } from '../db/db';
import { getTrack, listActivities } from '../db/repo';
import { detectClimbs } from '../metrics/climbs';
import { haversineM } from '../import/summary';
import { listCommunityChallenges, submitCommunityScore, type CommunityChallenge } from './communityChallenges';

type TrackReader = (id: string) => Promise<TrackPoint[] | undefined>;
const finite = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n);
const positive = (n: number) => Number.isFinite(n) && n > 0;
const gps = (p: TrackPoint) => finite(p.lat) && Math.abs(p.lat) <= 90 && finite(p.lng) && Math.abs(p.lng) <= 180;

/** Tiempo transcurrido, incluidas las paradas. No une huecos >120 s ni saltos >35 m/s. */
export function bestDistanceSpeed(points: TrackPoint[], distanceM: number): number {
  if (!positive(distanceM)) return 0;
  const runs: { d: number; t: number }[][] = [];
  let run: { d: number; t: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i], prev = points[i - 1];
    if (!finite(p.t)) { run = []; continue; }
    if (!prev || !run.length) { run = [{ d: 0, t: p.t / 1000 }]; runs.push(run); continue; }
    const dt = (p.t - prev.t) / 1000;
    const delta = finite(p.dist) && finite(prev.dist) ? p.dist - prev.dist
      : gps(p) && gps(prev) ? haversineM(prev.lat!, prev.lng!, p.lat!, p.lng!) : NaN;
    if (!(dt > 0 && dt <= 120 && finite(delta) && delta >= 0 && delta <= 1000 && delta / dt <= 35)) {
      run = [{ d: 0, t: p.t / 1000 }]; runs.push(run); continue;
    }
    run.push({ d: run[run.length - 1].d + delta, t: p.t / 1000 });
  }
  let best = 0;
  for (const samples of runs) {
    // A piecewise linear minimum has a vertex at either end of the distance window.
    let j = 0;
    for (let i = 0; i < samples.length; i++) {
      const a = samples[i];
      while (j < samples.length && samples[j].d < a.d + distanceM) j++;
      if (j === samples.length) break;
      const b = samples[j], before = samples[j - 1];
      const t = b.d === a.d + distanceM ? b.t : before.t + (b.t - before.t) * (a.d + distanceM - before.d) / (b.d - before.d);
      if (t > a.t) best = Math.max(best, distanceM / (t - a.t));
    }
    j = 0;
    for (let i = 0; i < samples.length; i++) {
      const b = samples[i], target = b.d - distanceM;
      if (target < 0) continue;
      while (j + 1 < i && samples[j + 1].d <= target) j++;
      const a = samples[j], after = samples[j + 1];
      if (!after) continue;
      const t = a.d === target ? a.t : a.t + (after.t - a.t) * (target - a.d) / (after.d - a.d);
      if (b.t > t) best = Math.max(best, distanceM / (b.t - t));
    }
  }
  return best;
}

function segmentCell(p: TrackPoint): string {
  // Mercator with fixed 100 m cells: identity only, never sent as coordinates.
  const lat = Math.max(-85, Math.min(85, p.lat!)) * Math.PI / 180;
  return `${Math.floor(p.lng! * 111319.49 / 100)},${Math.floor(6378137 * Math.log(Math.tan(Math.PI / 4 + lat / 2)) / 100)}`;
}

/** Approximate directed signature; crossing a cell boundary can prevent recognition. */
export async function climbSegmentKey(climb: DetectedClimb, points: TrackPoint[]): Promise<string | null> {
  const a = points[climb.startIdx], b = points[climb.endIdx];
  if (!a || !b || !gps(a) || !gps(b) || !positive(climb.lengthM)) return null;
  let mid = a, distance = 0;
  for (let i = climb.startIdx + 1; i <= climb.endIdx; i++) {
    if (!gps(points[i]) || !gps(points[i - 1])) return null;
    distance += haversineM(points[i - 1].lat!, points[i - 1].lng!, points[i].lat!, points[i].lng!);
    if (distance >= climb.lengthM / 2) { mid = points[i]; break; }
  }
  const value = `fbt-climb-v1:${segmentCell(a)}:${segmentCell(mid)}:${segmentCell(b)}:${Math.round(climb.lengthM / 100)}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}

function usableClimb(climb: DetectedClimb, points: TrackPoint[]): boolean {
  for (let i = climb.startIdx; i <= climb.endIdx; i++) {
    const p = points[i], prev = points[i - 1];
    if (!gps(p) || !finite(p.t)) return false;
    if (i === climb.startIdx) continue;
    const dt = (p.t - prev.t) / 1000;
    const distance = haversineM(prev.lat!, prev.lng!, p.lat!, p.lng!);
    if (!(dt > 0 && dt <= 120 && distance <= 1000 && distance / dt <= 35)) return false;
  }
  return true;
}

export async function segmentOptions(): Promise<{ key: string; name: string; distanceM: number }[]> {
  const activities = (await listActivities()).filter(a => !a.id.startsWith('demo-') && a.hasTrack).slice(-50).reverse();
  const home = (await db.settings.get('app'))?.value.home;
  const options = new Map<string, { key: string; name: string; distanceM: number }>();
  for (const activity of activities) {
    const points = await getTrack(activity.id);
    if (!points) continue;
    for (const climb of detectClimbs(points)) {
      if (!usableClimb(climb, points)) continue;
      if (home && [climb.start, climb.end].some(p => haversineM(p.lat, p.lng, home.lat, home.lng) < 1000)) continue;
      const key = await climbSegmentKey(climb, points);
      if (key && !options.has(key)) options.set(key, {
        key, name: `Subida ${(climb.lengthM / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km · ${Math.round(climb.gainM)} m+ · ${key.slice(0, 6)}`,
        distanceM: Math.round(climb.lengthM),
      });
      if (options.size >= 100) return [...options.values()];
    }
  }
  return [...options.values()];
}

/** Only completed, non-demo rides inside the member's consent window count. */
export async function scoreCommunityChallenge(
  challenge: CommunityChallenge, userId: string, activities: StoredActivity[], readTrack: TrackReader = getTrack, now = Date.now(),
): Promise<number> {
  const member = challenge.members.find(m => m.id === userId);
  if (member?.status !== 'accepted' || !member.accepted_at) return 0;
  const from = Date.parse(member.accepted_at), to = Math.min(Date.parse(challenge.deadline), now);
  let score = 0;
  const seen = new Set<string>();
  for (const a of activities) {
    const total = a.totals;
    if (seen.has(a.id) || a.id.startsWith('demo-') || a.sport !== 'cycling' || !finite(a.startTime)
      || a.startTime < from || !positive(total.elapsedTimeS) || a.startTime + total.elapsedTimeS * 1000 > to
      || !positive(total.distanceM) || !positive(total.movingTimeS)) continue;
    seen.add(a.id);
    if (challenge.kind === 'distance') score += total.distanceM;
    else if (challenge.kind === 'elevation') score += positive(total.elevGainM) ? total.elevGainM : 0;
    else if (challenge.kind === 'rides') score++;
    else {
      const points = await readTrack(a.id);
      if (!points) continue;
      // Do not use track points outside the activity/consent period.
      const end = Math.min(to, a.startTime + total.elapsedTimeS * 1000);
      // A sentinel breaks continuity instead of bridging a removed corrupt/out-of-window point.
      const valid = points.map(p => finite(p.t) && p.t >= a.startTime && p.t <= end ? p : { t: NaN });
      if (challenge.kind === 'speed' && challenge.distance_m) score = Math.max(score, bestDistanceSpeed(valid, challenge.distance_m));
      else if (challenge.kind === 'segment' && challenge.segment_key) {
        for (const climb of detectClimbs(valid)) {
          if (!positive(climb.timeS) || climb.lengthM / climb.timeS > 35 || !usableClimb(climb, valid)) continue;
          if (await climbSegmentKey(climb, valid) === challenge.segment_key) score = score === 0 ? climb.timeS : Math.min(score, climb.timeS);
        }
      }
    }
  }
  // Stable precision makes repeated snapshots idempotent and ties reproducible.
  return Math.round(score * 1000) / 1000;
}

const pending = new WeakMap<SupabaseClient, Promise<void>>();
type SyncOptions = { challengeId?: string; replaceRemote?: boolean };
const sourceKey = (challengeId: string) => `community-score-source:${challengeId}`;
/** A snapshot replaces the previous total, so retries, reimports and local deletions cannot add twice. */
export function syncCommunityScores(client: SupabaseClient, userId: string, options: SyncOptions = {}): Promise<void> {
  const existing = pending.get(client);
  if (existing) return options.replaceRemote ? existing.catch(() => {}).then(() => syncCommunityScores(client, userId, options)) : existing;
  const job = (async () => {
    const databaseName = db.name;
    const challenges: CommunityChallenge[] = [];
    for (let offset = 0; ; offset += 50) {
      const page = await listCommunityChallenges(client, offset);
      challenges.push(...page);
      if (page.length < 50) break;
    }
    const active = challenges.filter(c => (!options.challengeId || c.id === options.challengeId) && c.status === 'active' && Date.parse(c.deadline) > Date.now()
      && c.members.some(m => m.id === userId && m.status === 'accepted'));
    if (!active.length) return;
    const activities = await listActivities();
    for (const c of active) {
      if (db.name !== databaseName) return;
      const remote = c.members.find(m => m.id === userId)?.score;
      const previous = (await db.meta.get(sourceKey(c.id)))?.value as { userId?: string; score?: number } | undefined;
      // A fresh device must not erase (or replace) another device's submitted history.
      // Local provenance is a convenience guard, not proof of sporting authenticity.
      if (!options.replaceRemote && remote && remote > 0 && (previous?.userId !== userId || previous.score !== remote)) continue;
      const score = await scoreCommunityChallenge(c, userId, activities);
      if (db.name !== databaseName) return;
      // A known source may send zero after local deletion; a fresh empty device sends nothing.
      if (Date.parse(c.deadline) > Date.now() && remote !== score && (score > 0 || previous || options.replaceRemote)) {
        await submitCommunityScore(client, c.id, score);
        if (db.name === databaseName) await db.meta.put({ key: sourceKey(c.id), value: { userId, score } });
      } else if (options.replaceRemote) {
        await db.meta.put({ key: sourceKey(c.id), value: { userId, score } });
      }
    }
  })().finally(() => { pending.delete(client); });
  pending.set(client, job);
  return job;
}
