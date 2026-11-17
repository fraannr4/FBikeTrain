import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchLikes, setLike } from '../src/social/likes';

type Result = { data?: unknown; error: { message: string; code?: string } | null };
function fakeClient(rpcResult: Result = { data: [], error: null }, writeResult: Result = { error: null }) {
  const rpc = vi.fn(async () => rpcResult);
  const insert = vi.fn(async () => writeResult);
  const match = vi.fn(async () => writeResult);
  const del = vi.fn(() => ({ match }));
  const from = vi.fn(() => ({ insert, delete: del }));
  return { client: { rpc, from } as unknown as SupabaseClient, rpc, from, insert, match };
}

describe('fetchLikes', () => {
  it('pide recuento y marca propia de todos los ids en una sola consulta', async () => {
    const { client, rpc } = fakeClient({ data: [{ object_id: 'a', like_count: 3, liked: true }, { object_id: 'b', like_count: 0, liked: false }], error: null });
    const result = await fetchLikes(client, 'challenge', ['a', 'b']);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('list_likes', { kind: 'challenge', ids: ['a', 'b'] });
    expect(result).toEqual({ a: { count: 3, liked: true }, b: { count: 0, liked: false } });
  });

  it('no consulta nada si no hay objetos y reparte en tandas de 100 si hay más', async () => {
    const empty = fakeClient();
    expect(await fetchLikes(empty.client, 'post', [])).toEqual({});
    expect(empty.rpc).not.toHaveBeenCalled();
    const many = fakeClient();
    const ids = Array.from({ length: 230 }, (_, i) => `id${i}`);
    await fetchLikes(many.client, 'post', ids);
    expect(many.rpc.mock.calls.map(call => (call as unknown as [string, { ids: string[] }])[1].ids.length)).toEqual([100, 100, 30]);
  });

  it('descarta ids repetidos antes de consultar', async () => {
    const { client, rpc } = fakeClient();
    await fetchLikes(client, 'post', ['a', 'a', 'b']);
    expect(rpc).toHaveBeenCalledWith('list_likes', { kind: 'post', ids: ['a', 'b'] });
  });

  it('lanza un mensaje en castellano si falla la lectura', async () => {
    const { client } = fakeClient({ error: { message: 'boom internal' } });
    await expect(fetchLikes(client, 'post', ['a'])).rejects.toThrow('No se han podido cargar los me gusta.');
  });
});

describe('setLike', () => {
  it('da me gusta insertando solo mi usuario, el tipo y el id', async () => {
    const { client, from, insert } = fakeClient();
    await setLike(client, 'u1', 'post', 'p1', true);
    expect(from).toHaveBeenCalledWith('likes');
    expect(insert).toHaveBeenCalledWith({ user_id: 'u1', object_type: 'post', object_id: 'p1' });
  });

  it('trata un me gusta duplicado como ya dado', async () => {
    const { client } = fakeClient({ data: [], error: null }, { error: { message: 'duplicate key', code: '23505' } });
    await expect(setLike(client, 'u1', 'post', 'p1', true)).resolves.toBeUndefined();
  });

  it('quita el me gusta propio filtrando por usuario, tipo y objeto', async () => {
    const { client, match } = fakeClient();
    await setLike(client, 'u1', 'challenge', 'c1', false);
    expect(match).toHaveBeenCalledWith({ user_id: 'u1', object_type: 'challenge', object_id: 'c1' });
  });

  it('lanza un mensaje en castellano si el servidor rechaza la escritura', async () => {
    const { client } = fakeClient({ data: [], error: null }, { error: { message: 'new row violates row-level security policy', code: '42501' } });
    await expect(setLike(client, 'u1', 'post', 'p1', true)).rejects.toThrow('No se ha podido guardar tu me gusta. Inténtalo de nuevo.');
  });
});
