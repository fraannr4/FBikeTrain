import { downloadTrackGpx } from '../src/bookmarklet/trackDownload';
import { MAX_WIKILOC_GPX_BYTES } from '../src/routes/wikilocLimits';

// Ficha y GPX sintéticos: ni HTML ni tracks reales de Wikiloc.
const PAGE = 'https://es.wikiloc.com/rutas-ciclismo-de-carretera/vuelta-sintetica-2001';
const GPX = '<?xml version="1.0"?><gpx version="1.1" creator="prueba" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="41" lon="2.5"/></trkseg></trk></gpx>';
const page = (body: string) => new DOMParser().parseFromString(`<!doctype html><html><body><h1>Vuelta</h1>${body}</body></html>`, 'text/html');
const LINK = '<a class="btn" href="/wikiloc/download.do?id=2001">Descargar</a>';

function respond(body: string, init: ResponseInit & { url?: string; redirected?: boolean } = {}) {
  const res = new Response(body, { status: 200, headers: { 'content-type': 'application/gpx+xml' }, ...init });
  if (init.url) Object.defineProperty(res, 'url', { value: init.url });
  if (init.redirected) Object.defineProperty(res, 'redirected', { value: true });
  return res;
}

describe('downloadTrackGpx', () => {
  it('pide el GPX una sola vez, del mismo origen y con la sesión del usuario', async () => {
    const fetchFn = vi.fn(async () => respond(`﻿${GPX}`));
    expect(await downloadTrackGpx(page(LINK), PAGE, fetchFn)).toEqual({ kind: 'gpx', gpx: GPX });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('https://es.wikiloc.com/wikiloc/download.do?id=2001', expect.objectContaining({ credentials: 'include' }));
  });

  it.each([
    ['sin enlace de descarga', '<button>Descargar</button>', /no se encuentra la descarga oficial/i],
    ['con aviso de Premium', `<div class="premium-required"></div>${LINK}`, /premium/i],
    ['con aviso de iniciar sesión', `<div data-login-required></div>${LINK}`, /inicia sesión/i],
    ['con un enlace a otro origen', '<a href="https://descargas.example/download.do?id=2001">Descargar</a>', /otro sitio/i],
    ['con un enlace a otro subdominio', '<a href="https://www.wikiloc.com/wikiloc/download.do?id=2001">Descargar</a>', /otro sitio/i],
    ['con un enlace a la página de Premium', '<a href="/wikiloc/premium/download.do?id=2001">Descargar</a>', /premium o iniciar sesión/i],
  ])('no pide nada %s', async (_, body, motivo) => {
    const fetchFn = vi.fn();
    const result = await downloadTrackGpx(page(body), PAGE, fetchFn);
    expect(result).toEqual({ kind: 'manual', motivo: expect.stringMatching(motivo) });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ['la red falla', () => { throw new TypeError('red'); }, /no se pudo descargar/i],
    ['Wikiloc responde con error', () => respond('', { status: 500 }), /respondió con el código 500/i],
    ['Wikiloc pide permiso', () => respond('', { status: 403 }), /premium o iniciar sesión/i],
    ['redirige al inicio de sesión', () => respond('<html></html>', { url: 'https://es.wikiloc.com/wikiloc/login.do', redirected: true, headers: { 'content-type': 'text/html' } }), /premium o iniciar sesión/i],
    ['entrega una página en lugar de un GPX', () => respond('<!doctype html><html><body>Confirma</body></html>', { headers: { 'content-type': 'text/html' } }), /no ha entregado un gpx/i],
    ['entrega un XML que no es GPX', () => respond('<?xml version="1.0"?><kml></kml>'), /no ha entregado un gpx/i],
    ['entrega un GPX de más de 5 MB', () => respond(GPX.replace('</gpx>', `<!--${'x'.repeat(MAX_WIKILOC_GPX_BYTES)}--></gpx>`)), /5 MB/],
  ])('pasa a la descarga manual si %s, sin reintentar', async (_, reply, motivo) => {
    const fetchFn = vi.fn(async () => reply());
    const result = await downloadTrackGpx(page(LINK), PAGE, fetchFn);
    expect(result).toEqual({ kind: 'manual', motivo: expect.stringMatching(motivo) });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
