import type { SupabaseClient } from '@supabase/supabase-js';
import type { RoutePoint } from '../routes/library';
import type { ChallengePoint } from './challenges';
import type { RouteResult } from './routeChallenge';

export type ChallengeKind = 'distance' | 'elevation' | 'rides' | 'segment' | 'speed' | 'route';
export type CommunityMember = { id: string; username: string; display_name: string; status: 'pending' | 'accepted' | 'declined'; accepted_at: string | null; score: number | null; updated_at: string | null };
export type CommunityChallenge = {
  id: string; title: string; kind: ChallengeKind; created_at: string; deadline: string; creator_id: string;
  target_value: number | null; distance_m: number | null; segment_key: string | null; status: 'active' | 'finished';
  /** Solo en los retos de ruta: la distancia de la ruta ya recortada. */
  route_distance_m?: number | null;
  members: CommunityMember[]; winner_ids: string[];
};
export type CommunityNotification = { id: string; kind: string; challenge_id: string | null; actor_id: string | null; created_at: string; read_at: string | null };
export type NewCommunityChallenge = { title: string; kind: ChallengeKind; duration_days: number; invited_ids: string[]; target_value?: number | null; distance_m?: number | null; segment_key?: string | null };
type Rpc = Pick<SupabaseClient, 'rpc'>;
const GENERIC = 'No se ha podido completar. Comprueba la conexión e inténtalo de nuevo.';
const ERRORS: Record<string, string> = {
  'Sesión necesaria': 'Inicia sesión con una cuenta registrada para participar.',
  'Cuenta registrada necesaria': 'Inicia sesión con una cuenta registrada para participar.',
  'Límite diario de invitaciones': 'Has enviado 20 solicitudes o invitaciones en 24 horas. Prueba mañana.',
  'Límite diario de solicitudes': 'Has enviado 20 solicitudes o invitaciones en 24 horas. Prueba mañana.',
  'Reto no disponible': 'Este reto ya no está disponible para tu cuenta.',
  'Reto cerrado': 'El plazo del reto ha terminado. El marcador ya está cerrado.',
  'Reto no válido': 'Revisa el título, los participantes y el plazo de 1 a 30 días.',
  'Interacción no disponible': 'No se puede interactuar con este ciclista.',
  'Usuario no disponible': 'Este ciclista no está disponible para interactuar.',
  'Invitación no disponible': 'Esta invitación ya no está disponible. Actualiza el reto.',
  'Aviso no disponible': 'Este aviso ya no está disponible.',
  'Cifras no válidas': 'Las cifras de esta salida no sirven para el reto.',
};
export type NewRouteChallenge = { title: string; duration_days: number; invited_ids: string[]; points: ChallengePoint[]; distance_m: number };
async function call<T>(client: Rpc, name: string, args?: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await (args ? client.rpc(name, args) : client.rpc(name));
  if (error) throw new Error(ERRORS[error.message] ?? GENERIC);
  return data as T | null;
}
export const listCommunityChallenges = async (client: Rpc, offset = 0) => (await call<CommunityChallenge[]>(client, 'list_community_challenges', { page_offset: offset })) ?? [];
export const getCommunityChallenge = (client: Rpc, id: string) => call<CommunityChallenge>(client, 'get_community_challenge', { challenge_id: id });
export async function createCommunityChallenge(client: Rpc, input: NewCommunityChallenge): Promise<string> {
  const id = await call<string>(client, 'create_community_challenge', { ...input, target_value: input.target_value ?? null, distance_m: input.distance_m ?? null, segment_key: input.segment_key ?? null });
  if (!id) throw new Error(GENERIC);
  return id;
}
export async function respondCommunityChallenge(client: Rpc, id: string, accept: boolean): Promise<void> { await call(client, 'respond_community_challenge', { challenge_id: id, accept }); }
export async function submitCommunityScore(client: Rpc, id: string, score: number): Promise<void> {
  if (!Number.isFinite(score) || score < 0) throw new Error('Cifras no válidas');
  await call(client, 'submit_community_score', { challenge_id: id, score });
}
export async function createRouteChallenge(client: Rpc, input: NewRouteChallenge): Promise<string> {
  const id = await call<string>(client, 'create_route_challenge', {
    title: input.title, duration_days: input.duration_days, invited_ids: input.invited_ids, route_points: input.points, distance_m: input.distance_m,
  });
  if (!id) throw new Error(GENERIC);
  return id;
}
/** Solo el resultado de la salida: nunca su track. */
export async function submitRouteResult(client: Rpc, id: string, result: RouteResult): Promise<void> {
  await call(client, 'submit_route_result', {
    challenge_id: id, moving_time_s: result.movingTimeS, coverage: result.coverage, ridden_at: new Date(result.riddenAt).toISOString(), activity_ref: result.activityRef,
  });
}
/** Geometría del reto de ruta: la RLS solo la entrega a los participantes. */
export async function getRouteChallengeGeometry(client: Pick<SupabaseClient, 'from'>, id: string): Promise<{ points: RoutePoint[]; distanceM: number } | null> {
  const { data, error } = await client.from('community_route_challenges').select('points,distance_m').eq('challenge_id', id).maybeSingle();
  if (error) throw new Error(GENERIC);
  if (!data) return null;
  const row = data as { points: ChallengePoint[]; distance_m: number };
  return { points: row.points.map(([lat, lng, ele]) => (ele === undefined ? { lat, lng } : { lat, lng, ele })), distanceM: row.distance_m };
}
export const listCommunityNotifications = async (client: Rpc, offset = 0) => (await call<CommunityNotification[]>(client, 'list_community_notifications', { page_offset: offset })) ?? [];
export async function readCommunityNotification(client: Rpc, id: string): Promise<void> { await call(client, 'read_community_notification', { notification_id: id }); }

export const CHALLENGE_LABELS: Record<ChallengeKind, string> = { distance: 'Kilómetros', elevation: 'Desnivel', rides: 'Salidas', segment: 'Segmento o subida', speed: 'Mejor media', route: 'Ruta' };
/** En estos retos gana el menor tiempo. */
export const lowerWins = (kind: ChallengeKind) => kind === 'segment' || kind === 'route';
const number = (n: number, digits = 1) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: digits }).format(n);
export function formatCommunityScore(kind: ChallengeKind, value: number | null): string {
  if (value === null || (kind === 'segment' && value === 0)) return 'Sin registro';
  if (kind === 'distance') return `${number(value / 1000)} km`;
  if (kind === 'elevation') return `${number(value, 0)} m`;
  if (kind === 'rides') return `${number(value, 0)} ${value === 1 ? 'salida' : 'salidas'}`;
  if (kind === 'speed') return `${number(value * 3.6)} km/h`;
  const seconds = Math.round(value);
  if (kind === 'route') return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function rankedCommunityMembers(challenge: CommunityChallenge): CommunityMember[] {
  return challenge.members.filter(m => m.status === 'accepted').sort((a, b) => {
    const aScore = a.score && a.score > 0 ? a.score : null;
    const bScore = b.score && b.score > 0 ? b.score : null;
    if (aScore === null) return bScore === null ? a.display_name.localeCompare(b.display_name, 'es') : 1;
    if (bScore === null) return -1;
    return lowerWins(challenge.kind) ? aScore - bScore : bScore - aScore;
  });
}
