import type { SupabaseClient } from '@supabase/supabase-js';
import { createCommunityChallenge, formatCommunityScore, getCommunityChallenge, listCommunityChallenges, listCommunityNotifications, rankedCommunityMembers, readCommunityNotification, respondCommunityChallenge, submitCommunityScore, type CommunityChallenge, type CommunityMember } from '../src/social/communityChallenges';

const fake = (data: unknown = null, error: { message: string } | null = null) => {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
};
const member = (id: string, score: number | null, status: CommunityMember['status'] = 'accepted'): CommunityMember => ({ id, username: id, display_name: id, score, status, accepted_at: null, updated_at: null });

describe('retos de comunidad', () => {
  it('envía únicamente definición e invitados; no sube tracks ni identidad del remitente', async () => {
    const { client, rpc } = fake('r1');
    expect(await createCommunityChallenge(client, { title: 'Cien', kind: 'distance', duration_days: 7, invited_ids: ['u2'], target_value: 100000 })).toBe('r1');
    expect(rpc).toHaveBeenCalledWith('create_community_challenge', { title: 'Cien', kind: 'distance', duration_days: 7, invited_ids: ['u2'], target_value: 100000, distance_m: null, segment_key: null });
    await submitCommunityScore(client, 'r1', 42000);
    expect(rpc).toHaveBeenLastCalledWith('submit_community_score', { challenge_id: 'r1', score: 42000 });
  });
  it('consulta todas las páginas y el detalle independiente del límite de listado', async () => {
    const { client, rpc } = fake([]);
    await listCommunityChallenges(client, 100);
    expect(rpc).toHaveBeenLastCalledWith('list_community_challenges', { page_offset: 100 });
    await getCommunityChallenge(client, 'old');
    expect(rpc).toHaveBeenLastCalledWith('get_community_challenge', { challenge_id: 'old' });
    await respondCommunityChallenge(client, 'old', false);
    expect(rpc).toHaveBeenLastCalledWith('respond_community_challenge', { challenge_id: 'old', accept: false });
    await listCommunityNotifications(client, 50);
    expect(rpc).toHaveBeenLastCalledWith('list_community_notifications', { page_offset: 50 });
    await readCommunityNotification(client, 'n1');
    expect(rpc).toHaveBeenLastCalledWith('read_community_notification', { notification_id: 'n1' });
  });
  it.each([NaN, Infinity, -Infinity, -1])('rechaza una cifra inválida %s antes de enviarla', async score => {
    const { client, rpc } = fake();
    await expect(submitCommunityScore(client, 'r', score)).rejects.toThrow('Cifras no válidas');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('muestra cuota y cierre como errores útiles; oculta detalles internos del servidor', async () => {
    await expect(createCommunityChallenge(fake(null, { message: 'Límite diario de invitaciones' }).client, { title: 'Meta', kind: 'rides', duration_days: 7, invited_ids: ['p'] })).rejects.toThrow('20 solicitudes o invitaciones');
    await expect(submitCommunityScore(fake(null, { message: 'Reto cerrado' }).client, 'r', 0)).rejects.toThrow('plazo del reto ha terminado');
    await expect(getCommunityChallenge(fake(null, { message: 'SELECT secret_private from auth' }).client, 'r')).rejects.toThrow('Comprueba la conexión');
  });
  it('ordena por cifra, excluye pendientes y pone ausencia/cero después de resultados', () => {
    const challenge = { kind: 'distance', members: [member('sin', null), member('cero', 0), member('dos', 20), member('uno', 10), member('pendiente', 999, 'pending'), member('rechazado', 999, 'declined')] } as CommunityChallenge;
    expect(rankedCommunityMembers(challenge).map(m => m.id)).toEqual(['dos', 'uno', 'cero', 'sin']);
    expect(rankedCommunityMembers({ ...challenge, kind: 'segment' }).map(m => m.id)).toEqual(['uno', 'dos', 'cero', 'sin']);
  });
  it('formatea las cinco unidades y redondea un tiempo cerca del minuto sin producir :60', () => {
    expect(formatCommunityScore('distance', 42500)).toBe('42,5 km');
    expect(formatCommunityScore('elevation', 800)).toBe('800 m');
    expect(formatCommunityScore('rides', 1)).toBe('1 salida');
    expect(formatCommunityScore('speed', 10)).toBe('36 km/h');
    expect(formatCommunityScore('segment', 119.9)).toBe('2:00');
    expect(formatCommunityScore('segment', 0)).toBe('Sin registro');
    expect(formatCommunityScore('distance', null)).toBe('Sin registro');
  });
});
