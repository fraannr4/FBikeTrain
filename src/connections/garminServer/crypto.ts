const encoder = new TextEncoder();
export const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
export const randomSecret = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}
async function key(value: string) {
  const bytes = decode(value);
  if (bytes.length !== 32) throw new Error('configuration');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
/** AES-GCM with per-account authenticated context; plaintext never reaches persisted rows. */
export async function encryptSecret(value: string, encryptionKey: string, account: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`garmin:v1:${account}`) }, await key(encryptionKey), encoder.encode(value));
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(cipher))}`;
}
export async function decryptSecret(value: string, encryptionKey: string, account: string): Promise<string> {
  const [version, iv, ciphertext] = value.split('.');
  if (version !== 'v1' || !iv || !ciphertext) throw new Error('cipher');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: encoder.encode(`garmin:v1:${account}`) }, await key(encryptionKey), decode(ciphertext)));
}
