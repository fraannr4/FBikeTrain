import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'fbiketrain-avatars';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_AVATAR_BYTES = 512 * 1024;
const MAX_SIDE = 8192;
const MAX_PIXELS = 40_000_000;
const PHOTO_ERROR = 'No se puede leer esa foto. Prueba con otra imagen JPEG, PNG o WebP.';
const blobs = new Map<string, Promise<Blob | null>>();

function pathFor(userId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('Vuelve a iniciar sesión para cambiar tu foto.');
  }
  return `${userId}/avatar.webp`;
}

function invalidate(userId: string) {
  for (const key of blobs.keys()) if (key.startsWith(`${userId}:`)) blobs.delete(key);
}

function bytesOf(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error(PHOTO_ERROR));
    reader.readAsArrayBuffer(file);
  });
}

/** Lee únicamente la cabecera; evita decodificar imágenes comprimidas con dimensiones desmesuradas. */
function dimensions(bytes: Uint8Array, mime: string): [number, number] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, size: number) => String.fromCharCode(...bytes.subarray(start, start + size));
  if (mime === 'image/png' && bytes.length >= 24 && bytes[0] === 137 && ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') {
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (mime === 'image/webp' && bytes.length >= 25 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    if (ascii(12, 4) === 'VP8X' && bytes.length >= 30) {
      return [1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)];
    }
    if (ascii(12, 4) === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
    if (ascii(12, 4) === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
      return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff];
    }
  }
  if (mime === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const startsFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) return null;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if (startsFrame.has(marker) && length >= 8) return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
      offset += length;
    }
  }
  return null;
}

function checkDimensions(size: [number, number] | null) {
  if (!size || size[0] < 1 || size[1] < 1) throw new Error(PHOTO_ERROR);
  if (size[0] > MAX_SIDE || size[1] > MAX_SIDE || size[0] * size[1] > MAX_PIXELS) {
    throw new Error('La foto es demasiado grande. Elige una de hasta 8.192 píxeles por lado y 40 megapíxeles.');
  }
}

/** Reencodificar solo los píxeles elimina EXIF y ubicación; el original nunca se sube. */
export async function prepareAvatar(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Elige una foto JPEG, PNG o WebP.');
  if (file.size > MAX_FILE_BYTES) throw new Error('La foto debe ocupar 5 MB como mucho.');
  if (file.size === 0) throw new Error(PHOTO_ERROR);
  checkDimensions(dimensions(new Uint8Array(await bytesOf(file)), file.type));
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(PHOTO_ERROR));
      image.src = source;
    });
    checkDimensions([image.naturalWidth, image.naturalHeight]);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(PHOTO_ERROR);
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    const result = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error(PHOTO_ERROR)), 'image/webp', 0.82,
    ));
    if (result.type !== 'image/webp' || result.size > MAX_AVATAR_BYTES) throw new Error('Este navegador no puede preparar la foto. Prueba con un navegador actualizado.');
    return result;
  } finally {
    URL.revokeObjectURL(source);
  }
}

export async function uploadAvatar(client: SupabaseClient, userId: string, file: File): Promise<number> {
  const path = pathFor(userId);
  const blob = await prepareAvatar(file);
  const { error } = await client.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'image/webp', cacheControl: '0' });
  if (error) throw new Error('No se pudo subir tu foto. Comprueba la conexión e inténtalo de nuevo.');
  invalidate(userId);
  const version = Date.now();
  const { data, error: profileError } = await client.from('profiles').update({ avatar_version: version }).eq('id', userId).select('id').single();
  if (profileError || !data) throw new Error('La foto se ha subido, pero no se pudo actualizar el perfil. Vuelve a intentarlo.');
  return version;
}

export async function removeAvatar(client: SupabaseClient, userId: string): Promise<void> {
  const { error } = await client.storage.from(BUCKET).remove([pathFor(userId)]);
  if (error) throw new Error('No se pudo quitar tu foto. Comprueba la conexión e inténtalo de nuevo.');
  invalidate(userId);
  const { data, error: profileError } = await client.from('profiles').update({ avatar_version: 0 }).eq('id', userId).select('id').single();
  if (profileError || !data) throw new Error('La foto se ha eliminado, pero no se pudo actualizar el perfil. Vuelve a intentarlo.');
}

/** Solo Blob autenticado: ningún enlace de almacenamiento público se guarda o se comparte. */
export async function avatarBlob(client: SupabaseClient, userId: string, version: number): Promise<Blob | null> {
  if (!Number.isSafeInteger(version) || version <= 0) return null;
  const key = `${userId}:${version}`;
  let pending = blobs.get(key);
  if (!pending) {
    if (blobs.size >= 40) blobs.delete(blobs.keys().next().value!);
    pending = Promise.resolve(client.storage.from(BUCKET).download(pathFor(userId), { cacheNonce: String(version) }, { cache: 'no-store' }))
      .then(({ data, error }) => {
        if (error || !data) { blobs.delete(key); return null; }
        return data;
      }, () => { blobs.delete(key); return null; });
    blobs.set(key, pending);
  }
  return pending;
}
