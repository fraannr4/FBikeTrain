import type { SupabaseClient } from '@supabase/supabase-js';
import {
  acceptFriendship,
  listFriends,
  removeFriendship,
  requestFriendship,
  searchProfiles,
  searchProfilesNear,
  type FriendRow,
  type ProfileCard,
} from '../src/social/friends';

const card: ProfileCard = { id: 'p2', username: 'ana_ruta', display_name: 'Ana Ruta', locality: 'Villa Prueba', distance_km: 10 };

function fake(result: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('llamadas de amistad y búsqueda', () => {
  it('cada función llama a su RPC con los parámetros exactos', async () => {
    const rows: FriendRow[] = [{ friendship_id: 'f1', status: 'pending', direction: 'sent', profile: card }];
    let f = fake({ data: [card] });
    expect(await searchProfiles(f.client, '  Ana ')).toEqual([card]);
    expect(f.rpc).toHaveBeenCalledWith('search_profiles', { q: 'Ana' });
    f = fake({ data: [card] });
    expect(await searchProfilesNear(f.client, 50)).toEqual([card]);
    expect(f.rpc).toHaveBeenCalledWith('search_profiles_near', { radius_km: 50 });
    f = fake({ data: rows });
    expect(await listFriends(f.client)).toEqual(rows);
    expect(f.rpc).toHaveBeenCalledWith('list_friends');
    f = fake({});
    await requestFriendship(f.client, 'p2');
    expect(f.rpc).toHaveBeenCalledWith('request_friendship', { target_id: 'p2' });
    f = fake({});
    await acceptFriendship(f.client, 'f1');
    expect(f.rpc).toHaveBeenCalledWith('accept_friendship', { request_id: 'f1' });
    f = fake({});
    await removeFriendship(f.client, 'f1');
    expect(f.rpc).toHaveBeenCalledWith('remove_friendship', { request_id: 'f1' });
  });

  it('sin datos devuelve listas vacías', async () => {
    expect(await searchProfiles(fake({ data: null }).client, 'Ana')).toEqual([]);
    expect(await listFriends(fake({ data: null }).client)).toEqual([]);
  });

  it('traduce los errores conocidos y da uno general para el resto', async () => {
    const fails = (message: string) => fake({ error: { message } }).client;
    await expect(searchProfilesNear(fails('Sin zona configurada'), 25)).rejects.toThrow('Indica tu zona en Ajustes para buscar cerca.');
    await expect(searchProfiles(fails('Escribe al menos 3 letras'), 'Ana')).rejects.toThrow('Escribe al menos 3 letras.');
    await expect(requestFriendship(fails('Solicitud no válida'), 'p1')).rejects.toThrow('No puedes enviarte una solicitud a ti mismo.');
    await expect(acceptFriendship(fails('Solicitud no disponible'), 'f1')).rejects.toThrow('Esa solicitud ya no está disponible.');
    await expect(listFriends(fails('Failed to fetch'))).rejects.toThrow('No se ha podido completar. Comprueba la conexión e inténtalo de nuevo.');
  });

  it('con menos de 3 letras no llama al servidor', async () => {
    const f = fake({ data: [card] });
    await expect(searchProfiles(f.client, ' ab ')).rejects.toThrow('Escribe al menos 3 letras.');
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
