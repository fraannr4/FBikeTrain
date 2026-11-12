import { db } from '../../db/db';

/**
 * Hasta el 2026-11-12 cada persona conectaba su cuenta de Ride with GPS y la clave y el token se guardaban
 * en la tabla `meta`. Ahora se usa la cuenta común desde el servidor: se borra lo que quedara guardado.
 */
export async function clearLegacyRwgpsCredentials(): Promise<void> {
  await db.meta.delete('rwgps:credentials');
}
