import type { SupabaseClient } from '@supabase/supabase-js';
import type { RoutePoint } from '../routes/library';
import type { RouteReference } from '../routes/sources/schema';
import { simplifyRouteReference } from '../routes/sources/limits';
import type { ProfileCard } from './friends';

/** Posición de la ruta del reto tal como la guarda el servidor. */
export type ChallengePoint = [number, number] | [number, number, number];
export type ChallengeStatus = 'pending' | 'accepted' | 'declined' | 'finished' | 'expired';
/** Cifras de la salida elegida: lo único que sube de una salida, nunca su track. */
export type ChallengeResult = {
  activity_date: string;
  moving_time_s: number;
  distance_m: number;
  avg_speed_ms: number;
  elev_gain_m: number | null;
  vam_mh: number | null;
};
export type Challenge = {
  id: string;
  status: ChallengeStatus;
  deadline: string;
  createdAt: string;
  routeName: string;
  distanceM: number;
  elevGainM: number | null;
  points: ChallengePoint[];
  rival: ProfileCard;
  mine: ChallengeResult | null;
  theirs: ChallengeResult | null;
  iAmChallenger: boolean;
};
type Row = {
  challenge: {
    id: string;
    status: ChallengeStatus;
    route_name: string;
    route_points: ChallengePoint[];
    distance_m: number;
    elev_gain_m: number | null;
    deadline: string;
    created_at: string;
    i_am_challenger: boolean;
  };
  rival: ProfileCard;
  mine: ChallengeResult | null;
  theirs: ChallengeResult | null;
};
type Rpc = Pick<SupabaseClient, 'rpc'>;

const GENERIC = 'No se ha podido completar. Comprueba la conexión e inténtalo de nuevo.';
/** Mensajes de la migración de retos en lo que tiene que hacer el usuario. */
const MESSAGES: Record<string, string> = {
  'Solo puedes retar a amigos': 'Solo puedes retar a amigos que hayan aceptado tu solicitud.',
  'Ruta no válida': 'La ruta no sirve para un reto. Elige otra de tu biblioteca.',
  'Reto no disponible': 'Ese reto ya no está disponible.',
  'Reto cerrado': 'El reto está cerrado: ha terminado, se ha rechazado o ha pasado el plazo de 30 días.',
  'Salida fuera del plazo': 'Elige una salida hecha desde el día del reto.',
  'Cifras no válidas': 'Esa salida no tiene un tiempo, una distancia y una velocidad válidos.',
  'Sesión necesaria': 'Vuelve a iniciar sesión para continuar.',
};

async function call<T>(client: Rpc, fn: string, args?: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await (args ? client.rpc(fn, args) : client.rpc(fn));
  if (error) throw new Error(MESSAGES[error.message] ?? GENERIC);
  return data as T | null;
}

const toPoint = (p: RoutePoint): ChallengePoint => {
  const lat = Number(p.lat.toFixed(6));
  const lng = Number(p.lng.toFixed(6));
  return p.ele === undefined ? [lat, lng] : [lat, lng, Math.round(p.ele * 10) / 10];
};

/**
 * Puntos de la ruta del reto: como mucho 2.000, con la misma simplificación que las rutas de fuentes
 * externas (`simplifyRouteReference`), que conserva los extremos.
 */
export function challengePoints(points: RoutePoint[]): ChallengePoint[] {
  if (points.length < 2) throw new Error('La ruta necesita al menos 2 puntos.');
  // La simplificación devuelve las mismas posiciones que recibe: así se recupera la altura de cada una.
  const byPosition = new Map(points.map((p) => [[p.lng, p.lat] as [number, number], p]));
  const line = [...byPosition.keys()];
  const kept = simplifyRouteReference({ geometry: { type: 'MultiLineString', coordinates: [line] } } as RouteReference).geometry!.coordinates[0];
  return kept.map((position) => toPoint(byPosition.get(position as [number, number])!));
}

export async function createChallenge(
  client: Rpc,
  input: { challengedId: string; routeName: string; points: ChallengePoint[]; distanceM: number; elevGainM: number | null },
): Promise<string> {
  const id = await call<string>(client, 'create_challenge', {
    challenged_id: input.challengedId,
    route_name: input.routeName,
    route_points: input.points,
    distance_m: Math.round(input.distanceM),
    elev_gain_m: input.elevGainM === null ? null : Math.round(input.elevGainM),
  });
  if (!id) throw new Error(GENERIC);
  return id;
}

export async function respondChallenge(client: Rpc, id: string, accept: boolean): Promise<void> {
  await call(client, 'respond_challenge', { challenge_id: id, accept });
}

export async function submitChallengeResult(client: Rpc, id: string, result: ChallengeResult): Promise<void> {
  await call(client, 'submit_challenge_result', { challenge_id: id, ...result });
}

export async function listChallenges(client: Rpc): Promise<Challenge[]> {
  const rows = (await call<Row[]>(client, 'list_challenges')) ?? [];
  return rows.map(({ challenge: c, rival, mine, theirs }) => ({
    id: c.id,
    status: c.status,
    deadline: c.deadline,
    createdAt: c.created_at,
    routeName: c.route_name,
    distanceM: c.distance_m,
    elevGainM: c.elev_gain_m,
    points: c.route_points,
    rival,
    mine,
    theirs,
    iAmChallenger: c.i_am_challenger,
  }));
}
