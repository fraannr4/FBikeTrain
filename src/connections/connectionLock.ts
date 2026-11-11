import type { CyclingDb } from '../db/db';

const active = new Set<string>();

/** Sin esperas: sincronizar, cambiar y desconectar comparten exclusión por cuenta y pestaña. */
export async function withConnectionLock<T>(database: CyclingDb, run: () => Promise<T>): Promise<T | undefined> {
  if (active.has(database.name)) return undefined;
  active.add(database.name);
  try {
    return await (typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request(`fbiketrain-intervals-${database.name}`, { ifAvailable: true }, lock => lock ? run() : undefined)
      : run());
  } finally { active.delete(database.name); }
}
