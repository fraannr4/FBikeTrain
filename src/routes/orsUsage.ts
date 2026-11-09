import { db } from '../db/db';

/**
 * Contador local de peticiones a ORS. Como en la FAQ de ORS, el día dura 24 h desde la primera
 * petición. No ve lo que gasten otros navegadores con la misma clave.
 */
export type OrsUsage = { count: number; windowStart: number };

const KEY = 'orsUsage';
const WINDOW_MS = 24 * 3600_000;

async function current(now: number): Promise<OrsUsage | null> {
  const row = await db.meta.get(KEY);
  const usage = row?.value as OrsUsage | undefined;
  return usage && now - usage.windowStart < WINDOW_MS ? usage : null;
}

export async function getOrsUsage(now: number): Promise<OrsUsage> {
  return (await current(now)) ?? { count: 0, windowStart: now };
}

export async function recordOrsCall(now: number): Promise<void> {
  const usage = await current(now);
  const value: OrsUsage = usage ? { ...usage, count: usage.count + 1 } : { count: 1, windowStart: now };
  await db.meta.put({ key: KEY, value });
}
