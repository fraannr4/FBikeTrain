import { z } from 'zod';
import { db } from '../../db/db';
import type { RwgpsCredentials } from './ridewithgps';

/**
 * Clave de API y token de Ride with GPS. Se guardan solo en la base de esta cuenta en este navegador
 * (tabla `meta`), fuera de Ajustes: la copia de seguridad no los exporta. La contraseña nunca se guarda.
 */
const KEY = 'rwgps:credentials';
const schema = z.object({ apiKey: z.string().min(1), authToken: z.string().min(1) });

export async function loadRwgpsCredentials(): Promise<RwgpsCredentials | null> {
  const row = await db.meta.get(KEY);
  const parsed = schema.safeParse(row?.value);
  return parsed.success ? parsed.data : null;
}

export async function saveRwgpsCredentials(credentials: RwgpsCredentials): Promise<void> {
  await db.meta.put({ key: KEY, value: schema.parse({ apiKey: credentials.apiKey.trim(), authToken: credentials.authToken.trim() }) });
}

export async function clearRwgpsCredentials(): Promise<void> {
  await db.meta.delete(KEY);
}
