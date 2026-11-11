import { isAbort } from '../../ai/abort';

const GPX_TYPE = 'application/gpx+xml';

/** Descarga un texto con un enlace temporal. `false` si el navegador no deja. */
export function downloadText(text: string, file: string, type = GPX_TYPE): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
}

export type SendOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed';
type SendEnv = { nav: Navigator; download: (text: string, file: string) => boolean };

/**
 * «Enviar al iGPSPORT»: en Android, la hoja de compartir con el fichero, para abrirlo con la app de
 * iGPSPORT; si el navegador no comparte ficheros GPX, o en el ordenador, una descarga.
 */
export async function sendGpx(gpx: string, file: string, title: string, env: SendEnv = { nav: navigator, download: downloadText }): Promise<SendOutcome> {
  const { nav } = env;
  if (/Android/i.test(nav.userAgent) && typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    const data: ShareData = { files: [new File([gpx], file, { type: GPX_TYPE })], title };
    let shareable = false;
    try { shareable = nav.canShare(data); } catch { shareable = false; }
    if (shareable) {
      try {
        await nav.share(data);
        return 'shared';
      } catch (e) {
        if (isAbort(e)) return 'cancelled';
        // Sin permiso o sin destino: se descarga.
      }
    }
  }
  return env.download(gpx, file) ? 'downloaded' : 'failed';
}
