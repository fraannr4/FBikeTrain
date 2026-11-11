import { sendGpx } from '../src/ui/routes/sendGpx';

const GPX = '<gpx version="1.1"/>';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';

function env(userAgent: string, share?: Partial<Pick<Navigator, 'canShare' | 'share'>>) {
  const download = vi.fn(() => true);
  return { download, env: { nav: { userAgent, ...share } as Navigator, download } };
}

it('en Android, comparte el fichero GPX con Web Share si el navegador lo admite', async () => {
  const share = vi.fn(async () => {});
  const { download, env: e } = env(ANDROID, { canShare: () => true, share });
  expect(await sendGpx(GPX, 'vuelta.gpx', 'Vuelta', e)).toBe('shared');
  const data = (share.mock.calls[0] as unknown as [ShareData])[0];
  expect(data.files?.[0]).toBeInstanceOf(File);
  expect(data.files?.[0].name).toBe('vuelta.gpx');
  expect(await data.files![0].text()).toBe(GPX);
  expect(download).not.toHaveBeenCalled();
});

it('si el usuario cierra la hoja de compartir, no descarga nada', async () => {
  const share = vi.fn(async () => { throw new DOMException('Cancelado', 'AbortError'); });
  const { download, env: e } = env(ANDROID, { canShare: () => true, share });
  expect(await sendGpx(GPX, 'vuelta.gpx', 'Vuelta', e)).toBe('cancelled');
  expect(download).not.toHaveBeenCalled();
});

it('en Android sin compartir ficheros, o si compartir falla, descarga el GPX', async () => {
  const a = env(ANDROID, { canShare: () => false, share: vi.fn() });
  expect(await sendGpx(GPX, 'vuelta.gpx', 'Vuelta', a.env)).toBe('downloaded');
  expect(a.download).toHaveBeenCalledWith(GPX, 'vuelta.gpx');
  const b = env(ANDROID, { canShare: () => true, share: vi.fn(async () => { throw new DOMException('No', 'NotAllowedError'); }) });
  expect(await sendGpx(GPX, 'vuelta.gpx', 'Vuelta', b.env)).toBe('downloaded');
});

it('en el ordenador, descarga aunque el navegador sepa compartir', async () => {
  const share = vi.fn();
  const { download, env: e } = env(DESKTOP, { canShare: () => true, share });
  expect(await sendGpx(GPX, 'vuelta.gpx', 'Vuelta', e)).toBe('downloaded');
  expect(share).not.toHaveBeenCalled();
  expect(download).toHaveBeenCalledTimes(1);
});

it('si el navegador no deja descargar, lo dice', async () => {
  const { env: e } = env(DESKTOP);
  e.download.mockReturnValue(false);
  expect(await sendGpx(GPX, 'vuelta.gpx', 'Vuelta', e)).toBe('failed');
});
