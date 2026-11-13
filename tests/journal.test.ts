import type { SupabaseClient } from '@supabase/supabase-js';
import { createPost, deletePost, listJournal, type JournalRide } from '../src/social/journal';

const ride: JournalRide = { activity_date: '2026-01-01', distance_m: 42000, moving_time_s: 5400, elev_gain_m: 650 };
function fake(data: unknown = null, message?: string) {
  const rpc = vi.fn().mockResolvedValue({ data, error: message ? { message } : null });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('cuaderno social', () => {
  it('pide el feed de amigos o el cuaderno del autor con cursor explícito', async () => {
    const f = fake([]);
    expect(await listJournal(f.client, null)).toEqual([]);
    expect(f.rpc).toHaveBeenCalledWith('list_profile_posts', { target_id: null, before_created_at: null, before_id: null });
    await listJournal(f.client, 'u2', { createdAt: '2026-01-01T10:00:00Z', id: 'post-1' });
    expect(f.rpc).toHaveBeenCalledWith('list_profile_posts', { target_id: 'u2', before_created_at: '2026-01-01T10:00:00Z', before_id: 'post-1' });
    expect(await listJournal(fake().client, null)).toEqual([]);
  });

  it('crea notas y salidas opt-in enviando solo las cifras permitidas', async () => {
    const f = fake('p1');
    const extraRide = { ...ride, lat: 41.6, lng: 2.3, track: [[1, 2]], name: 'Casa' };
    expect(await createPost(f.client, { body: '  Mi carretera de hoy  ', visibility: 'friends', ride: extraRide })).toBe('p1');
    expect(f.rpc).toHaveBeenCalledWith('create_profile_post', { body: 'Mi carretera de hoy', visibility: 'friends', ride });
    expect(JSON.stringify(f.rpc.mock.calls)).not.toMatch(/lat|lng|track|Casa/);
    await createPost(f.client, { body: '', visibility: 'everyone', ride });
    await createPost(f.client, { body: 'Solo texto', visibility: 'friends', ride: null });
  });

  it('no llama al servidor con texto vacío, demasiado largo, visibilidad o cifras inválidas', async () => {
    const f = fake();
    const inputs = [
      { body: ' ', visibility: 'friends' as const, ride: null },
      { body: 'x'.repeat(1001), visibility: 'friends' as const, ride: null },
      { body: 'x', visibility: 'bad' as 'friends', ride: null },
      ...[
        { ...ride, activity_date: '2026-02-31' }, { ...ride, distance_m: NaN },
        { ...ride, distance_m: 0 }, { ...ride, moving_time_s: Infinity },
        { ...ride, moving_time_s: 604801 }, { ...ride, elev_gain_m: -1 },
      ].map(r => ({ body: 'x', visibility: 'friends' as const, ride: r })),
    ];
    for (const input of inputs) await expect(createPost(f.client, input)).rejects.toThrow('cifras válidas');
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it('elimina solo por id y traduce cuota, sesión, permisos y errores desconocidos', async () => {
    const f = fake();
    await deletePost(f.client, 'p1');
    expect(f.rpc).toHaveBeenCalledWith('delete_profile_post', { post_id: 'p1' });
    await expect(deletePost(fake(null, 'Publicación no disponible').client, 'p1')).rejects.toThrow('no es tuya');
    await expect(listJournal(fake(null, 'Sesión necesaria').client, null)).rejects.toThrow('iniciar sesión');
    await expect(createPost(fake(null, 'Límite diario de publicaciones').client, { body: 'x', visibility: 'friends', ride: null })).rejects.toThrow('20 publicaciones');
    await expect(createPost(fake().client, { body: 'x', visibility: 'friends', ride: null })).rejects.toThrow('Comprueba la conexión');
    await expect(listJournal(fake(null, 'SQL internal information').client, null)).rejects.toThrow('Comprueba la conexión');
    const network = fake();
    network.rpc.mockRejectedValue(new Error('Network internals'));
    await expect(listJournal(network.client, null)).rejects.toThrow('Comprueba la conexión');
  });
});
