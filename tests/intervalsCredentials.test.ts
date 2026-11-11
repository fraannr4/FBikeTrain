import { webcrypto } from 'node:crypto';
import { CyclingDb } from '../src/db/db';
import { CONNECTION_KEY, CREDENTIAL_KEY, loadConnection, saveConnection } from '../src/connections/intervalsCredentials';

const connection = { athleteId: '0', apiKey: 'synthetic-api-key', autoSync: true };
let database: CyclingDb;
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  database = new CyclingDb(`credentials-${Math.random()}`);
});
afterEach(async () => { await database.delete(); vi.unstubAllGlobals(); });

it('encrypts the key at rest with a non-exportable AES key and roundtrips after reopening', async () => {
  await saveConnection(database, connection);
  const stored = await database.meta.get(CONNECTION_KEY);
  expect(JSON.stringify(stored)).not.toContain(connection.apiKey);
  const key = (await database.meta.get(CREDENTIAL_KEY))!.value as CryptoKey;
  expect(key.extractable).toBe(false);
  await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  database.close();
  await database.open();
  expect(await loadConnection(database)).toEqual(connection);
});

it('migrates plaintext legacy connection without resetting sync progress', async () => {
  await database.meta.bulkPut([{ key: CONNECTION_KEY, value: connection }, { key: 'intervals:sync', value: { oldest: '2026-11-01' } }]);
  expect(await loadConnection(database)).toEqual(connection);
  expect(JSON.stringify(await database.meta.get(CONNECTION_KEY))).not.toContain(connection.apiKey);
  expect((await database.meta.get('intervals:sync'))?.value).toEqual({ oldest: '2026-11-01' });
});

it('fails closed when encrypted data cannot be decrypted', async () => {
  await saveConnection(database, connection);
  await database.meta.delete(CREDENTIAL_KEY);
  await expect(loadConnection(database)).rejects.toThrow('clave');
  expect(JSON.stringify(await database.meta.get(CONNECTION_KEY))).not.toContain(connection.apiKey);
});

it('removes both encrypted credentials and key when disconnecting, preserving activities', async () => {
  await saveConnection(database, connection);
  await database.meta.put({ key: 'intervals:sync', value: { oldest: '2026-11-01' } });
  await saveConnection(database);
  expect(await database.meta.get(CONNECTION_KEY)).toBeUndefined();
  expect(await database.meta.get(CREDENTIAL_KEY)).toBeUndefined();
  expect(await database.meta.get('intervals:sync')).toBeUndefined();
});

it('does not fall back to plaintext when WebCrypto is unavailable', async () => {
  vi.stubGlobal('crypto', {});
  await expect(saveConnection(database, connection)).rejects.toThrow('cifrado');
  expect(await database.meta.get(CONNECTION_KEY)).toBeUndefined();
});
