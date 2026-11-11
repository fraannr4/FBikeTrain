import type { WikilocCard, WikilocMessage } from '../routes/wikilocNearby';
import { isWikilocUrl } from '../routes/wikilocLimits';
import { FBT_READY, READY_TIMEOUT_MS, RECEIVE_HASH } from './protocol';
import { downloadTrackGpx } from './trackDownload';
import { WIKILOC_FORMAT, mapQueryUrl, readFindResponse, readListFromDocument, readTrackPage } from './wikilocReader';

/**
 * Marcador «→ FBikeTrain». Se ejecuta en la pestaña de Wikiloc del usuario, solo cuando lo pulsa:
 * lee la vista (o descarga el GPX de la ficha), abre la app y le entrega un único mensaje
 * cuando la app avisa de que está lista. Como mucho una petición a Wikiloc por toque.
 */

export type BookmarkletEnv = {
  win: Window;
  doc: Document;
  pageUrl: string;
  fetch: typeof fetch;
  /** Dirección de la app, con la barra final: `https://…/FBikeTrain/`. */
  appBase: string;
};
export type BookmarkletOutcome =
  | 'sent' | 'timeout' | 'blocked' | 'cancelled' | 'manual' | 'empty' | 'unreadable' | 'not-wikiloc' | 'error';

export type PageKind = 'map' | 'track' | 'list';

export function pageKind(pageUrl: string): PageKind {
  const { pathname } = new URL(pageUrl);
  if (WIKILOC_FORMAT.paths.map.test(pathname)) return 'map';
  if (WIKILOC_FORMAT.paths.track.test(pathname)) return 'track';
  return 'list';
}

export const appReceiveUrl = (appBase: string) => new URL(RECEIVE_HASH, appBase).href;

const NOTICE_ID = 'fbt-marcador-aviso';
/** Espera pendiente de un toque anterior, para que un segundo toque la sustituya. */
const PENDING_KEY = '__fbtMarcadorCancel';
type Tone = 'info' | 'ok' | 'error';
// El aviso vive en la página de Wikiloc, sin acceso a los tokens de la app: colores del tema oscuro.
const TONE_COLOR: Record<Tone, string> = { info: '#80B4F5', ok: '#9BD3AB', error: '#FFA7A5' };

/** Aviso visible en la página de Wikiloc. Solo textContent: nunca HTML con datos leídos. */
function notify(doc: Document, text: string, tone: Tone): void {
  let box = doc.getElementById(NOTICE_ID);
  if (!box) {
    box = doc.createElement('div');
    box.id = NOTICE_ID;
    box.setAttribute('role', 'status');
    box.style.cssText = 'position:fixed;top:12px;left:12px;right:12px;margin:0 auto;max-width:28rem;z-index:2147483647;'
      + 'display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:12px;border:2px solid;'
      + 'background:#14221F;color:#E5EDDF;font:500 15px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35)';
    const message = doc.createElement('p');
    message.style.cssText = 'margin:0;flex:1';
    const close = doc.createElement('button');
    close.type = 'button';
    close.textContent = 'Cerrar';
    close.setAttribute('aria-label', 'Cerrar el aviso de FBikeTrain');
    close.style.cssText = 'min-height:44px;padding:0 14px;border-radius:12px;border:1px solid #859B7F;background:transparent;color:inherit;font:inherit;cursor:pointer';
    close.addEventListener('click', () => box?.remove());
    box.append(message, close);
    doc.body.append(box);
  }
  box.style.borderColor = TONE_COLOR[tone];
  box.querySelector('p')!.textContent = text;
}

const count = (n: number) => new Intl.NumberFormat('es-ES').format(n);

function summary(message: WikilocMessage): string {
  if (message.kind === 'track') return `Enviado el GPX de «${message.nombre}» a FBikeTrain.`;
  const n = message.rutas.length;
  return n === 1 ? 'Enviada 1 ruta a FBikeTrain.' : `Enviadas ${count(n)} rutas a FBikeTrain.`;
}

type Pending = Record<string, (() => void) | undefined>;

/** Abre la app y le entrega el mensaje cuando envía FBT_READY desde su origen y su ventana. */
function deliver(env: BookmarkletEnv, message: WikilocMessage): Promise<BookmarkletOutcome> {
  const { win, doc } = env;
  const appUrl = appReceiveUrl(env.appBase);
  const appOrigin = new URL(appUrl).origin;
  // Sin `noopener`: la app necesita `window.opener` para avisar de que está lista.
  const appWin = win.open(appUrl, '_blank');
  if (!appWin) {
    notify(doc, 'El navegador ha bloqueado la ventana de FBikeTrain. Permite las ventanas emergentes en wikiloc.com y vuelve a pulsar el marcador.', 'error');
    return Promise.resolve('blocked');
  }
  notify(doc, 'Esperando a FBikeTrain...', 'info');
  const pending = win as unknown as Pending;
  return new Promise(resolve => {
    const finish = (outcome: BookmarkletOutcome) => {
      win.removeEventListener('message', onMessage);
      clearTimeout(timer);
      if (pending[PENDING_KEY] === cancel) delete pending[PENDING_KEY];
      resolve(outcome);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== appOrigin || event.source !== appWin || event.data !== FBT_READY) return;
      appWin.postMessage(message, appOrigin);
      notify(doc, summary(message), 'ok');
      finish('sent');
    };
    const timer = setTimeout(() => {
      notify(doc, `FBikeTrain no ha respondido en ${count(READY_TIMEOUT_MS / 1000)} segundos. Comprueba que se ha abierto y vuelve a pulsar el marcador.`, 'error');
      finish('timeout');
    }, READY_TIMEOUT_MS);
    const cancel = () => finish('cancelled');
    win.addEventListener('message', onMessage);
    pending[PENDING_KEY] = cancel;
  });
}

/** Consulta del mapa para la vista actual, cuando no hay tarjetas visibles. Devuelve las rutas o el motivo del fallo. */
async function readMap(env: BookmarkletEnv): Promise<WikilocCard[] | string> {
  let res: Response;
  try {
    res = await env.fetch(mapQueryUrl(env.pageUrl), { credentials: 'include', headers: { Accept: 'application/json' } });
  } catch {
    return 'No se pudo leer el mapa de Wikiloc. Vuelve a pulsar el marcador en un momento.';
  }
  if (!res.ok) return `No se pudo leer el mapa de Wikiloc: respondió con el código ${res.status}.`;
  let json: unknown;
  try { json = await res.json(); } catch { json = undefined; }
  return readFindResponse(json, env.pageUrl) ?? 'El formato de Wikiloc ha cambiado y el marcador no sabe leer este mapa.';
}

const EMPTY = 'No hay rutas legibles en esta vista. Mueve o amplía el mapa, o abre una lista de resultados, y vuelve a pulsar el marcador.';

async function run(env: BookmarkletEnv): Promise<BookmarkletOutcome> {
  const { doc, pageUrl } = env;
  if (!isWikilocUrl(pageUrl)) {
    notify(doc, 'Abre una página de wikiloc.com y pulsa ahí el marcador.', 'error');
    return 'not-wikiloc';
  }
  const kind = pageKind(pageUrl);
  let message: WikilocMessage;
  if (kind === 'track') {
    const page = readTrackPage(doc, pageUrl);
    if (!page) {
      notify(doc, 'No se reconoce la ficha de esta ruta. El formato de Wikiloc puede haber cambiado.', 'error');
      return 'unreadable';
    }
    notify(doc, 'Descargando el GPX con tu cuenta de Wikiloc...', 'info');
    const result = await downloadTrackGpx(doc, pageUrl, env.fetch);
    if (result.kind === 'manual') {
      notify(doc, result.motivo, 'error');
      return 'manual';
    }
    message = { v: 1, kind: 'track', ...page, gpx: result.gpx };
  } else {
    let rutas = readListFromDocument(doc, pageUrl);
    if (!rutas.length && kind === 'map') {
      notify(doc, 'Leyendo las rutas de esta vista del mapa...', 'info');
      const read = await readMap(env);
      if (typeof read === 'string') {
        notify(doc, read, 'error');
        return 'unreadable';
      }
      rutas = read;
    }
    if (!rutas.length) {
      notify(doc, EMPTY, 'error');
      return 'empty';
    }
    message = { v: 1, kind: 'list', rutas };
  }
  return deliver(env, message);
}

export async function runBookmarklet(env: BookmarkletEnv): Promise<BookmarkletOutcome> {
  (env.win as unknown as Pending)[PENDING_KEY]?.();
  try {
    return await run(env);
  } catch {
    notify(env.doc, 'El marcador ha fallado en esta página. Vuelve a intentarlo o usa la descarga de Wikiloc.', 'error');
    return 'error';
  }
}
