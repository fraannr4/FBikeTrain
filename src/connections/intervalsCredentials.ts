import type { CyclingDb } from '../db/db';
import { createApiKeyCredentialProvider, IntervalsError, validateCredentials, type IntervalsCredentials } from './intervalsClient';
import { withConnectionLock } from './connectionLock';

export const CONNECTION_KEY = 'intervals:connection';
export const CREDENTIAL_KEY = 'intervals:credential-key';
export const SYNC_KEY = 'intervals:sync';
export type IntervalsConnection = IntervalsCredentials & { autoSync: boolean };
type EncryptedConnection = { version: 1; athleteId: string; autoSync: boolean; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer };

function cryptoApi(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) throw new Error('Este navegador no permite el cifrado local. Usa una conexión HTTPS y un navegador actualizado.');
  return crypto.subtle;
}

async function encrypt(database: CyclingDb, connection: IntervalsConnection): Promise<{ value: EncryptedConnection; key: CryptoKey }> {
  const subtle = cryptoApi();
  const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(database.name) }, key, new TextEncoder().encode(connection.apiKey));
  return { value: { version: 1, athleteId: connection.athleteId, autoSync: connection.autoSync, iv, ciphertext }, key };
}

export async function loadConnection(database: CyclingDb): Promise<IntervalsConnection | undefined> {
  // Una instantánea atómica impide mezclar ciphertext y clave durante cambios en otra pestaña.
  const [connectionRow, keyRow] = await database.meta.bulkGet([CONNECTION_KEY, CREDENTIAL_KEY]);
  const stored = connectionRow?.value as EncryptedConnection | IntervalsConnection | undefined;
  if (!stored) return undefined;
  if ('apiKey' in stored) {
    const connection = { ...validateCredentials(stored), autoSync: stored.autoSync };
    const encrypted = await encrypt(database, connection);
    // El cifrado se hace fuera de la transacción para que IndexedDB no la cierre durante WebCrypto.
    await database.transaction('rw', database.meta, async () => {
      const current = (await database.meta.get(CONNECTION_KEY))?.value;
      if (JSON.stringify(current) !== JSON.stringify(stored)) return;
      await database.meta.bulkPut([{ key: CREDENTIAL_KEY, value: encrypted.key }, { key: CONNECTION_KEY, value: encrypted.value }]);
    });
    return loadConnection(database);
  }
  try {
    const key = keyRow?.value as CryptoKey | undefined;
    if (!key || stored.version !== 1) throw new Error();
    const plaintext = await cryptoApi().decrypt({ name: 'AES-GCM', iv: stored.iv, additionalData: new TextEncoder().encode(database.name) }, key, stored.ciphertext);
    return { ...validateCredentials({ athleteId: stored.athleteId, apiKey: new TextDecoder().decode(plaintext) }), autoSync: stored.autoSync };
  } catch {
    throw new Error('No se puede descifrar la clave de Intervals.icu. Desconecta y vuelve a guardar la conexión.');
  }
}

export async function saveConnection(database: CyclingDb, input?: IntervalsConnection): Promise<void> {
  const saved = await withConnectionLock(database, async () => {
    await writeConnection(database, input);
    return true;
  });
  if (!saved) throw new IntervalsError('Hay una sincronización o un cambio de conexión en curso en otra ventana. Espera a que termine y vuelve a intentarlo.');
}

async function writeConnection(database: CyclingDb, input?: IntervalsConnection): Promise<void> {
  if (!input) {
    await database.meta.bulkDelete([CONNECTION_KEY, CREDENTIAL_KEY, SYNC_KEY]);
    return;
  }
  const connection = { ...validateCredentials(input), autoSync: input.autoSync };
  let previous: IntervalsConnection | undefined;
  try { previous = await loadConnection(database); }
  catch { /* Una clave dañada se puede reemplazar explícitamente desde Ajustes. */ }
  const encrypted = await encrypt(database, connection);
  await database.transaction('rw', database.meta, async () => {
    await database.meta.bulkPut([{ key: CREDENTIAL_KEY, value: encrypted.key }, { key: CONNECTION_KEY, value: encrypted.value }]);
    if (previous?.athleteId !== connection.athleteId || previous?.apiKey !== connection.apiKey) await database.meta.delete(SYNC_KEY);
  });
}

export async function resolveIntervalsConnection(database: CyclingDb) {
  const connection = await loadConnection(database);
  return connection ? { provider: createApiKeyCredentialProvider(connection), autoSync: connection.autoSync } : undefined;
}
