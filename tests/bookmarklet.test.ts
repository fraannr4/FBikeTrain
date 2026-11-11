import { screen, waitFor } from '@testing-library/react';
import type { MockInstance } from 'vitest';
import { appReceiveUrl, pageKind, runBookmarklet, type BookmarkletEnv } from '../src/bookmarklet/bookmarklet';
import { FBT_READY } from '../src/bookmarklet/protocol';
import { WikilocMessageSchema } from '../src/routes/wikilocNearby';

// Páginas, respuestas y GPX sintéticos: el marcador nunca se prueba contra wikiloc.com.
const APP_BASE = 'https://fraannr4.github.io/FBikeTrain/';
const APP_ORIGIN = 'https://fraannr4.github.io';
const APP_URL = 'https://fraannr4.github.io/FBikeTrain/#/rutas/wikiloc/recibir';
const MAP = 'https://es.wikiloc.com/wikiloc/map.do?sw=40.9,2.4&ne=41.1,2.6&act=29&page=1';
const TRACK = 'https://es.wikiloc.com/rutas-ciclismo-de-carretera/vuelta-sintetica-2001';
const CARD = `<div class="trail-card"><h3 class="trail-title"><a href="/rutas-ciclismo-de-carretera/vuelta-sintetica-2001">Vuelta sintética</a></h3>
  <span data-stat="distance">75 km</span><span data-stat="elevation-gain">900 m</span></div>`;
const GPX = '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="41" lon="2.5"/></trkseg></trk></gpx>';

let appWin: Window;
let open: MockInstance<Window['open']>;
let post: MockInstance<(message: unknown, targetOrigin: string) => void>;

beforeEach(() => {
  document.body.innerHTML = '<iframe title="app"></iframe>';
  appWin = document.querySelector('iframe')!.contentWindow!;
  open = vi.spyOn(window, 'open').mockReturnValue(appWin);
  post = vi.spyOn(appWin, 'postMessage').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const env = (pageUrl: string, body: string, fetchFn: typeof fetch = vi.fn()): BookmarkletEnv => {
  document.body.insertAdjacentHTML('beforeend', body);
  return { win: window, doc: document, pageUrl, fetch: fetchFn, appBase: APP_BASE };
};
const ready = (over: Partial<MessageEventInit> = {}) =>
  window.dispatchEvent(new MessageEvent('message', { data: FBT_READY, origin: APP_ORIGIN, source: appWin, ...over }));
const sentMessage = () => post.mock.calls[0][0];

describe('pageKind y appReceiveUrl', () => {
  it('distingue el mapa, la ficha de una ruta y una lista', () => {
    expect(pageKind(MAP)).toBe('map');
    expect(pageKind(TRACK)).toBe('track');
    expect(pageKind('https://es.wikiloc.com/rutas/ciclismo-de-carretera/espana/barcelona')).toBe('list');
  });
  it('abre la pantalla de recepción de la app', () => {
    expect(appReceiveUrl(APP_BASE)).toBe(APP_URL);
    expect(appReceiveUrl('http://localhost:5173/')).toBe('http://localhost:5173/#/rutas/wikiloc/recibir');
  });
});

describe('runBookmarklet', () => {
  it('entrega la lista a la app cuando responde, con su origen exacto', async () => {
    const done = runBookmarklet(env(MAP, CARD));
    await waitFor(() => expect(open).toHaveBeenCalledWith(APP_URL, '_blank'));
    expect(screen.getByRole('status')).toHaveTextContent(/esperando a fbiketrain/i);
    expect(post).not.toHaveBeenCalled();

    ready({ origin: 'https://evil.example' });
    ready({ source: window });
    ready({ data: 'otra cosa' });
    expect(post).not.toHaveBeenCalled();

    ready();
    expect(await done).toBe('sent');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(expect.anything(), APP_ORIGIN);
    const message = WikilocMessageSchema.parse(sentMessage());
    expect(message).toMatchObject({ v: 1, kind: 'list', rutas: [{ id: '2001', nombre: 'Vuelta sintética', km: 75, desnivelM: 900 }] });
    expect(screen.getByRole('status')).toHaveTextContent('Enviada 1 ruta a FBikeTrain.');

    ready();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('avisa en la página si la app no responde en 15 segundos', async () => {
    vi.useFakeTimers();
    const done = runBookmarklet(env(MAP, CARD));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(screen.getByRole('status')).toHaveTextContent(/esperando/i);
    await vi.advanceTimersByTimeAsync(1);
    expect(await done).toBe('timeout');
    expect(screen.getByRole('status')).toHaveTextContent(/no ha respondido en 15 segundos/i);
    ready();
    expect(post).not.toHaveBeenCalled();
  });

  it('avisa si el navegador bloquea la ventana de la app', async () => {
    open.mockReturnValue(null);
    expect(await runBookmarklet(env(MAP, CARD))).toBe('blocked');
    expect(screen.getByRole('status')).toHaveTextContent(/ha bloqueado la ventana de fbiketrain/i);
  });

  it('no hace nada fuera de wikiloc.com', async () => {
    const fetchFn = vi.fn();
    expect(await runBookmarklet(env('https://wikiloc.com.evil.io/wikiloc/map.do', CARD, fetchFn))).toBe('not-wikiloc');
    expect(open).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/abre una página de wikiloc.com/i);
  });

  it('en una lista sin rutas legibles avisa y no abre la app ni pide nada', async () => {
    const fetchFn = vi.fn();
    expect(await runBookmarklet(env('https://es.wikiloc.com/rutas/ciclismo-de-carretera', '<p>Nada</p>', fetchFn))).toBe('empty');
    expect(open).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/no hay rutas legibles/i);
  });

  it('en el mapa sin tarjetas hace una sola consulta del mismo origen para esa vista', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ spas: [
      { id: 5001, name: 'Circuito sintético', distance: 75_000, elevationGain: 900, prettyURL: '/rutas-ciclismo-de-carretera/circuito-sintetico-5001' },
    ] }), { headers: { 'content-type': 'application/json' } }));
    const done = runBookmarklet(env(MAP, '<p>Mapa</p>', fetchFn));
    await waitFor(() => expect(open).toHaveBeenCalled());
    ready();
    expect(await done).toBe('sent');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).origin).toBe('https://es.wikiloc.com');
    expect(new URL(url).searchParams.get('sw')).toBe('40.9,2.4');
    expect(init).toMatchObject({ credentials: 'include' });
    expect(sentMessage()).toMatchObject({ kind: 'list', rutas: [{ id: '5001', km: 75 }] });
  });

  it.each([
    ['la consulta del mapa falla', async () => { throw new TypeError('red'); }, /no se pudo leer el mapa/i],
    ['la consulta del mapa cambia de formato', async () => new Response('{"otra":1}'), /formato de wikiloc ha cambiado/i],
  ])('avisa y no abre la app si %s', async (_, reply, motivo) => {
    const fetchFn = vi.fn(reply);
    expect(await runBookmarklet(env(MAP, '<p>Mapa</p>', fetchFn))).not.toBe('sent');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(motivo);
  });

  it('en una ficha entrega el GPX descargado con nombre, autor y enlace', async () => {
    const fetchFn = vi.fn(async () => new Response(GPX));
    const done = runBookmarklet(env(TRACK, '<h1>Vuelta sintética</h1><span class="author-name">Autora Prueba</span><a href="/wikiloc/download.do?id=2001">Descargar</a>', fetchFn));
    await waitFor(() => expect(open).toHaveBeenCalled());
    ready();
    expect(await done).toBe('sent');
    expect(WikilocMessageSchema.parse(sentMessage())).toEqual({
      v: 1, kind: 'track', id: '2001', url: TRACK, nombre: 'Vuelta sintética', autor: 'Autora Prueba', gpx: GPX,
    });
    expect(screen.getByRole('status')).toHaveTextContent('Enviado el GPX de «Vuelta sintética» a FBikeTrain.');
  });

  it('si la ficha pide Premium o iniciar sesión, lo dice y no abre la app', async () => {
    const fetchFn = vi.fn();
    expect(await runBookmarklet(env(TRACK, '<h1>Vuelta</h1><div class="premium-required"></div><a href="/wikiloc/download.do?id=2001">Descargar</a>', fetchFn))).toBe('manual');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/premium/i);
  });

  it('un segundo toque sustituye la espera del primero y entrega una sola vez', async () => {
    const first = runBookmarklet(env(MAP, CARD));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const second = runBookmarklet(env(MAP, ''));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(await first).toBe('cancelled');
    ready();
    expect(await second).toBe('sent');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('el aviso se puede cerrar con un botón etiquetado', async () => {
    await runBookmarklet(env('https://otra.example/', ''));
    screen.getByRole('button', { name: 'Cerrar el aviso de FBikeTrain' }).click();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
