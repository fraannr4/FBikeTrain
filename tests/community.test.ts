import type { SupabaseClient } from '@supabase/supabase-js';
import { blockCyclist, listBlockedCyclists, listCyclists, reportCyclist, touchCommunityActivity } from '../src/social/community';

const fake = (data: unknown = null, error: { message: string; code?: string } | null = null) => {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc, client: { rpc } as unknown as SupabaseClient };
};

it('lists all cyclists without requiring a search term and pages the search', async () => {
  const f = fake([{ id: 'p2', display_name: 'Ana' }]);
  expect(await listCyclists(f.client)).toHaveLength(1);
  expect(f.rpc).toHaveBeenLastCalledWith('list_cyclists', { query_text: '', page_offset: 0 });
  await listCyclists(f.client, ' Ana ', 50);
  expect(f.rpc).toHaveBeenLastCalledWith('list_cyclists', { query_text: 'Ana', page_offset: 50 });
});

it('uses only the intended fields in safety RPCs', async () => {
  const f = fake();
  await blockCyclist(f.client, 'p2', true);
  expect(f.rpc).toHaveBeenLastCalledWith('block_cyclist', { target_id: 'p2', blocked: true });
  await reportCyclist(f.client, 'p2', '  Acoso  ');
  expect(f.rpc).toHaveBeenLastCalledWith('report_cyclist', { target_id: 'p2', reason: 'Acoso' });
  await touchCommunityActivity(f.client);
  expect(f.rpc).toHaveBeenLastCalledWith('touch_community_activity');
  expect(await listBlockedCyclists(f.client)).toEqual([]);
});

it('rejects invalid pagination and report text before calling the server', async () => {
  const f = fake();
  await expect(listCyclists(f.client, '', -1)).rejects.toThrow('Página no válida');
  await expect(reportCyclist(f.client, 'p2', ' ')).rejects.toThrow('motivo');
  expect(f.rpc).not.toHaveBeenCalled();
});

it('explains quota and registered-account failures without exposing server internals', async () => {
  await expect(listCyclists(fake(null, { message: 'Cuenta registrada necesaria' }).client)).rejects.toThrow('cuenta registrada');
  await expect(listCyclists(fake(null, { message: 'SQL stack private' }).client)).rejects.toThrow('conexión');
  await expect(blockCyclist(fake(null, { message: 'Límite diario de interacciones', code: 'P0429' }).client, 'p2', true)).rejects.toThrow('20');
});
