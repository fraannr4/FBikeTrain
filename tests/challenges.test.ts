import type { SupabaseClient } from '@supabase/supabase-js';
import {
  challengePoints,
  createChallenge,
  getChallenge,
  listChallenges,
  respondChallenge,
  submitChallengeResult,
  type ChallengeResult,
} from '../src/social/challenges';
import type { RoutePoint } from '../src/routes/library';

function fake(result: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('detalle de retos antiguos', () => {
  const old = { id: 'old', challenger_id: 'u1', challenged_id: 'u2', status: 'accepted', deadline: '2020-01-02T00:00:00Z', created_at: '2020-01-01T00:00:00Z', route_name: 'Ruta antigua', route_points: [[1, 2], [2, 3]], distance_m: 1000, elev_gain_m: null };
  function archive(data: unknown) {
    const rpc = vi.fn().mockResolvedValue({ data: Array.from({ length: 100 }, (_, i) => ({ challenge: { id: `recent-${i}` }, rival: {}, mine: null, theirs: null })) });
    const from = vi.fn((table: string) => ({ select: vi.fn(() => ({ eq: vi.fn(() => {
      if (table === 'challenges') return { maybeSingle: async () => ({ data }) };
      if (table === 'profiles') return { single: async () => ({ data: { id: 'u2', username: 'ana', display_name: 'Ana' } }) };
      return Promise.resolve({ data: [{ user_id: 'u1', activity_date: '2020-01-01', moving_time_s: 600, distance_m: 1000, avg_speed_ms: 2, elev_gain_m: null, vam_mh: null }] });
    }) })) }));
    return { client: { rpc, from } as unknown as SupabaseClient, from };
  }
  it('lee por id fuera de los últimos 100 y calcula la caducidad', async () => {
    const { client, from } = archive(old);
    const result = await getChallenge(client, 'old', 'u1');
    expect(result).toMatchObject({ id: 'old', status: 'expired', iAmChallenger: true, rival: { id: 'u2' }, mine: { distance_m: 1000 }, theirs: null });
    expect(result?.mine).not.toHaveProperty('user_id');
    expect(from).toHaveBeenCalledWith('challenge_results');
  });
  it('no muestra un reto ausente ni de terceros', async () => {
    const missing = archive(null);
    expect(await getChallenge(missing.client, 'old', 'u1')).toBeNull();
    const foreign = archive(old);
    expect(await getChallenge(foreign.client, 'old', 'stranger')).toBeNull();
    expect(foreign.from).toHaveBeenCalledTimes(1);
  });
});

/** Recta sintética hacia el este, un punto cada ~8 m. */
const line = (n: number, ele = true): RoutePoint[] =>
  Array.from({ length: n }, (_, i) => ({ lat: 41.6, lng: 2.29 + i * 0.0001, ...(ele ? { ele: 100 + i / 10 } : {}) }));

describe('challengePoints', () => {
  it('pasa a [lat, lng, ele] o [lat, lng] sin simplificar si cabe', () => {
    expect(challengePoints([{ lat: 41.6, lng: 2.29, ele: 100 }, { lat: 41.61, lng: 2.3 }])).toEqual([[41.6, 2.29, 100], [41.61, 2.3]]);
  });

  it('simplifica a 2.000 puntos o menos y conserva los extremos', () => {
    const points = line(12_000);
    const out = challengePoints(points);
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out.length).toBeGreaterThan(100);
    expect(out[0]).toEqual([41.6, 2.29, 100]);
    expect(out[out.length - 1]).toEqual([points[11_999].lat, Number(points[11_999].lng.toFixed(6)), points[11_999].ele]);
  });

  it('rechaza una ruta de menos de 2 puntos', () => {
    expect(() => challengePoints([{ lat: 41.6, lng: 2.29 }])).toThrow('La ruta necesita al menos 2 puntos.');
    expect(() => challengePoints([])).toThrow('La ruta necesita al menos 2 puntos.');
  });
});

describe('llamadas de retos', () => {
  const result: ChallengeResult = { activity_date: '2026-11-10', moving_time_s: 5400, distance_m: 42000, avg_speed_ms: 7.78, elev_gain_m: 600, vam_mh: 400 };

  it('cada función llama a su RPC con los parámetros exactos', async () => {
    let f = fake({ data: 'r1' });
    expect(await createChallenge(f.client, { challengedId: 'p2', routeName: 'Vuelta', points: [[41.6, 2.29], [41.61, 2.3]], distanceM: 42_499.6, elevGainM: 610.4 })).toBe('r1');
    expect(f.rpc).toHaveBeenCalledWith('create_challenge', {
      challenged_id: 'p2', route_name: 'Vuelta', route_points: [[41.6, 2.29], [41.61, 2.3]], distance_m: 42_500, elev_gain_m: 610,
    });
    f = fake({});
    await respondChallenge(f.client, 'r1', false);
    expect(f.rpc).toHaveBeenCalledWith('respond_challenge', { challenge_id: 'r1', accept: false });
    f = fake({});
    await submitChallengeResult(f.client, 'r1', result);
    expect(f.rpc).toHaveBeenCalledWith('submit_challenge_result', { challenge_id: 'r1', ...result });
  });

  it('listChallenges convierte las filas del servidor', async () => {
    const rival = { id: 'p2', username: 'ana_ruta', display_name: 'Ana Ruta', locality: null, distance_km: null };
    const f = fake({
      data: [
        {
          challenge: {
            id: 'r1', status: 'accepted', route_name: 'Vuelta', route_points: [[41.6, 2.29], [41.61, 2.3]], distance_m: 42500,
            elev_gain_m: null, deadline: '2026-12-10T10:00:00Z', created_at: '2026-11-10T10:00:00Z', i_am_challenger: true,
          },
          rival,
          mine: result,
          theirs: null,
        },
      ],
    });
    expect(await listChallenges(f.client)).toEqual([
      {
        id: 'r1', status: 'accepted', routeName: 'Vuelta', points: [[41.6, 2.29], [41.61, 2.3]], distanceM: 42500, elevGainM: null,
        deadline: '2026-12-10T10:00:00Z', createdAt: '2026-11-10T10:00:00Z', iAmChallenger: true, rival, mine: result, theirs: null,
      },
    ]);
    expect(f.rpc).toHaveBeenCalledWith('list_challenges');
    expect(await listChallenges(fake({ data: null }).client)).toEqual([]);
  });

  it('traduce los errores del servidor', async () => {
    const fails = (message: string) => fake({ error: { message } }).client;
    const input = { challengedId: 'p3', routeName: 'Vuelta', points: [[41.6, 2.29], [41.61, 2.3]] as [number, number][], distanceM: 1000, elevGainM: null };
    await expect(createChallenge(fails('Solo puedes retar a amigos'), input)).rejects.toThrow('Solo puedes retar a amigos que hayan aceptado tu solicitud.');
    await expect(submitChallengeResult(fails('Reto cerrado'), 'r1', result)).rejects.toThrow(
      'El reto está cerrado: ha terminado, se ha rechazado o ha pasado el plazo de 30 días.',
    );
    await expect(listChallenges(fails('Failed to fetch'))).rejects.toThrow('No se ha podido completar. Comprueba la conexión e inténtalo de nuevo.');
  });
});
