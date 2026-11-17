/**
 * Cifrado de la copia entre dispositivos. Cada dato se comprime (gzip) y se cifra con AES-GCM de
 * 256 bits antes de salir del navegador; el tipo y el identificador van como datos asociados, así
 * que un contenido no puede moverse a otra fila sin que el descifrado falle.
 * Formato: base64( iv de 12 bytes || cifrado ).
 */
type Bytes = Uint8Array<ArrayBuffer>;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(text: string): Bytes {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Clave nueva al azar, en base64 (44 caracteres). */
export function newKey(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

export function importKey(base64: string): Promise<CryptoKey> {
  const raw = fromBase64(base64);
  if (raw.length !== KEY_BYTES) throw new Error('Clave de sincronización no válida');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function pipe(bytes: Bytes, transform: CompressionStream | DecompressionStream): Promise<Bytes> {
  const writer = transform.writable.getWriter();
  // Sin esperar: la escritura no acaba hasta que se lee la salida.
  void writer.write(bytes).then(() => writer.close()).catch(() => undefined);
  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

export async function seal(key: CryptoKey, label: string, value: unknown): Promise<string> {
  const packed = await pipe(new Uint8Array(encoder.encode(JSON.stringify(value))), new CompressionStream('gzip'));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(label) }, key, packed));
  const out = new Uint8Array(IV_BYTES + sealed.length);
  out.set(iv);
  out.set(sealed, IV_BYTES);
  return toBase64(out);
}

/** Lanza si la clave no es la de la cuenta, si el contenido se ha alterado o si no es de esa fila. */
export async function open(key: CryptoKey, label: string, payload: string): Promise<unknown> {
  const bytes = fromBase64(payload);
  const packed = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES), additionalData: encoder.encode(label) }, key, bytes.subarray(IV_BYTES),
  ));
  return JSON.parse(decoder.decode(await pipe(packed, new DecompressionStream('gzip'))));
}
