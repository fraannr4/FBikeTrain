import type { SupabaseClient } from '@supabase/supabase-js';
import { avatarBlob, prepareAvatar, removeAvatar, uploadAvatar } from '../src/social/avatar';

const USER = '00000000-0000-0000-0000-000000000071';
const originalUrl = URL;
const drawImage = vi.fn();

function png(width = 1200, height = 800) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return new File([bytes], 'photo.png', { type: 'image/png' });
}

function client() {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const download = vi.fn().mockResolvedValue({ data: new Blob(['photo'], { type: 'image/webp' }), error: null });
  const bucket = vi.fn(() => ({ upload, remove, download }));
  const single = vi.fn().mockResolvedValue({ data: { id: USER }, error: null });
  const eq = vi.fn(() => ({ select: vi.fn(() => ({ single })) }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { client: { storage: { from: bucket }, from } as unknown as SupabaseClient, upload, remove, download, bucket, single, eq, update };
}

beforeEach(() => {
  drawImage.mockClear();
  vi.stubGlobal('URL', class extends originalUrl {
    static createObjectURL = vi.fn(() => 'blob:synthetic-avatar');
    static revokeObjectURL = vi.fn();
  });
  vi.stubGlobal('Image', class {
    naturalWidth = 1200;
    naturalHeight = 800;
    decoding = '';
    onload?: () => void;
    onerror?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['pixels'], { type: 'image/webp' })));
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('foto de perfil', () => {
  it('recorta el centro, reencodifica a WebP y no conserva el archivo original', async () => {
    const original = png();
    const result = await prepareAvatar(original);
    expect(result.type).toBe('image/webp');
    expect(result).not.toBe(original);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 200, 0, 800, 800, 0, 0, 256, 256);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.82);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-avatar');
  });

  it('rechaza formatos, archivos y dimensiones excesivos antes de decodificar', async () => {
    await expect(prepareAvatar(new File(['svg'], 'photo.svg', { type: 'image/svg+xml' }))).rejects.toThrow('JPEG, PNG o WebP');
    await expect(prepareAvatar(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))).rejects.toThrow('5 MB');
    await expect(prepareAvatar(png(50_000, 50_000))).rejects.toThrow('demasiado grande');
    await expect(prepareAvatar(new File(['invalid'], 'fake.jpg', { type: 'image/jpeg' }))).rejects.toThrow('No se puede leer');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('admite las cabeceras JPEG de cámara y WebP además de PNG', async () => {
    const jpeg = new File([new Uint8Array([255, 216, 255, 192, 0, 8, 8, 3, 32, 4, 176, 3])], 'camera.jpg', { type: 'image/jpeg' });
    const webp = new Uint8Array(30);
    webp.set([82, 73, 70, 70]); webp.set([87, 69, 66, 80, 86, 80, 56, 88], 8);
    webp[24] = 175; webp[25] = 4; webp[27] = 31; webp[28] = 3;
    expect((await prepareAvatar(jpeg)).type).toBe('image/webp');
    expect((await prepareAvatar(new File([webp], 'image.webp', { type: 'image/webp' }))).type).toBe('image/webp');
  });

  it('solo sube los píxeles procesados a la ruta fija propia y guarda su versión', async () => {
    const f = client();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1234567);
    const version = await uploadAvatar(f.client, USER, png());
    expect(version).toBe(1234567);
    expect(f.bucket).toHaveBeenCalledWith('fbiketrain-avatars');
    expect(f.upload).toHaveBeenCalledWith(`${USER}/avatar.webp`, expect.any(Blob), { upsert: true, contentType: 'image/webp', cacheControl: '0' });
    expect(f.upload.mock.calls[0][1].type).toBe('image/webp');
    expect(f.update).toHaveBeenCalledWith({ avatar_version: 1234567 });
    expect(f.eq).toHaveBeenCalledWith('id', USER);
    now.mockRestore();
  });

  it('no actualiza el perfil si falla Storage y no confirma si falla la actualización', async () => {
    const f = client();
    f.upload.mockResolvedValueOnce({ error: { message: 'offline' } });
    await expect(uploadAvatar(f.client, USER, png())).rejects.toThrow('No se pudo subir');
    expect(f.update).not.toHaveBeenCalled();
    f.single.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await expect(uploadAvatar(f.client, USER, png())).rejects.toThrow('no se pudo actualizar');
  });

  it('elimina únicamente la foto propia y distingue un fallo al actualizar el perfil', async () => {
    const f = client();
    await removeAvatar(f.client, USER);
    expect(f.remove).toHaveBeenCalledWith([`${USER}/avatar.webp`]);
    expect(f.update).toHaveBeenCalledWith({ avatar_version: 0 });
    f.remove.mockResolvedValueOnce({ error: { message: 'offline' } });
    await expect(removeAvatar(f.client, USER)).rejects.toThrow('No se pudo quitar');
    f.single.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await expect(removeAvatar(f.client, USER)).rejects.toThrow('no se pudo actualizar');
  });

  it('descarga autenticada con versión, agrupa lecturas y no pide nada si no hay foto', async () => {
    const f = client();
    expect(await avatarBlob(f.client, USER, 0)).toBeNull();
    expect(f.download).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([avatarBlob(f.client, USER, 501), avatarBlob(f.client, USER, 501)]);
    expect(first).toBe(second);
    expect(f.download).toHaveBeenCalledTimes(1);
    expect(f.download).toHaveBeenCalledWith(`${USER}/avatar.webp`, { cacheNonce: '501' }, { cache: 'no-store' });
    await avatarBlob(f.client, USER, 502);
    expect(f.download).toHaveBeenCalledTimes(2);
  });

  it('permite reintentar una descarga que falla y rechaza rutas con otra forma', async () => {
    const f = client();
    f.download.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    expect(await avatarBlob(f.client, USER, 503)).toBeNull();
    expect(await avatarBlob(f.client, USER, 503)).toBeInstanceOf(Blob);
    await expect(removeAvatar(f.client, '../other')).rejects.toThrow('iniciar sesión');
  });
});
