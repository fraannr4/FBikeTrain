import type { SupabaseClient } from '@supabase/supabase-js';
import type { PushResult, RemoteChange, RemoteItem, SyncRemote } from './engine';
import type { SyncKind } from './local';

/** La cuenta no admite más datos (150 MB o 60 000 datos). */
export class SyncQuotaError extends Error {
  constructor() {
    super('La copia de la cuenta está llena');
    this.name = 'SyncQuotaError';
  }
}

type Row = { kind: SyncKind; item_id: string; changed_ms: number };

/** La copia de la cuenta en Supabase: cuatro funciones que solo actúan sobre el usuario de la sesión. */
export function supabaseRemote(client: SupabaseClient): SyncRemote {
  async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    if (error) {
      if (error.code === '53400' || error.message === 'sync_quota') throw new SyncQuotaError();
      throw new Error(`Sincronización: ${name} ha fallado`);
    }
    return data as T;
  }
  return {
    key: (candidate) => call<string>('sync_key', { candidate }),
    async list(after, max) {
      const rows = await call<Array<Row & { seq: number; deleted: boolean }>>('sync_list', { after, max_rows: max });
      return rows.map((r): RemoteChange => ({ seq: Number(r.seq), kind: r.kind, id: r.item_id, changedAt: Number(r.changed_ms), deleted: r.deleted }));
    },
    async fetch(keys) {
      const rows = await call<Array<Row & { payload: string | null }>>('sync_fetch', { keys: keys.map((k) => ({ kind: k.kind, item_id: k.id })) });
      return rows.map((r): RemoteItem => ({ kind: r.kind, id: r.item_id, changedAt: Number(r.changed_ms), payload: r.payload }));
    },
    async push(items) {
      const rows = await call<Array<Row & { accepted: boolean }>>('sync_push', {
        items: items.map((i) => ({ kind: i.kind, item_id: i.id, changed_ms: i.changedAt, payload: i.payload })),
      });
      return rows.map((r): PushResult => ({ kind: r.kind, id: r.item_id, changedAt: Number(r.changed_ms), accepted: r.accepted }));
    },
  };
}
