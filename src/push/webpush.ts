/**
 * Web Push sin dependencias: cifrado aes128gcm (RFC 8291) y cabecera VAPID (RFC 8292) con Web Crypto.
 * Código portable: lo usan la Edge Function (Deno) y las pruebas (Node); no toca el DOM.
 */
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const RECORD_SIZE = 4096;
const VAPID_LIFETIME_S = 12 * 3600;
const text = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};

async function hkdf(secret: ArrayBuffer | Uint8Array, salt: Uint8Array, info: Uint8Array, bits: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, key, bits));
}

/** Cifra `plaintext` para un navegador (clave p256dh y secreto auth en base64url). Devuelve el cuerpo completo del POST. */
export async function encryptPayload(
  plaintext: Uint8Array,
  p256dh: string,
  auth: string,
  options: { salt?: Uint8Array; serverKeys?: CryptoKeyPair } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = (() => { try { return b64urlDecode(p256dh); } catch { return new Uint8Array(0); } })();
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('p256dh');
  const authSecret = (() => { try { return b64urlDecode(auth); } catch { return new Uint8Array(0); } })();
  if (authSecret.length !== 16) throw new Error('auth');
  // Un registro único: datos + delimitador (1) + etiqueta GCM (16) en 4096 bytes como máximo.
  if (plaintext.length > RECORD_SIZE - 17) throw new Error('payload');
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const serverKeys = options.serverKeys ?? await crypto.subtle.generateKey(ECDH, true, ['deriveBits']) as CryptoKeyPair;
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic as BufferSource, ECDH, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, serverKeys.privateKey, 256);
  const ikm = await hkdf(shared, authSecret, concat(text.encode('WebPush: info\0'), uaPublic, serverPublic), 256);
  const cek = await hkdf(ikm, salt, text.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(ikm, salt, text.encode('Content-Encoding: nonce\0'), 96);
  const key = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
  const record = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, concat(plaintext, new Uint8Array([2])) as BufferSource));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = serverPublic.length;
  return concat(header, serverPublic, record);
}

export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

/** Valor de la cabecera `Authorization` para el servicio push de `endpoint`. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const publicBytes = b64urlDecode(keys.publicKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) throw new Error('vapid');
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64urlEncode(publicBytes.slice(1, 33)), y: b64urlEncode(publicBytes.slice(33, 65)),
  }, ECDSA, false, ['sign']);
  const part = (value: unknown) => b64urlEncode(text.encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + VAPID_LIFETIME_S, sub: keys.subject })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, text.encode(unsigned)));
  return `vapid t=${unsigned}.${b64urlEncode(signature)}, k=${keys.publicKey}`;
}
