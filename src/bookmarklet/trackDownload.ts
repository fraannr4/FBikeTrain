import { MAX_WIKILOC_GPX_BYTES, fitsGpx } from '../routes/wikilocLimits';
import { WIKILOC_FORMAT } from './wikilocReader';

/**
 * Descarga del GPX desde la ficha de una ruta, igual que el botón «Descargar» de Wikiloc:
 * el enlace oficial de la página, del mismo origen y con la sesión del usuario.
 * Una sola petición por toque. Si Wikiloc pide Premium, iniciar sesión o una confirmación,
 * no se intenta nada más: se devuelve el motivo y el usuario usa el botón oficial.
 */

export type DownloadResult = { kind: 'gpx'; gpx: string } | { kind: 'manual'; motivo: string };

const OFFICIAL = 'Usa el botón «Descargar» de Wikiloc.';
const manual = (motivo: string): DownloadResult => ({ kind: 'manual', motivo });
const NEEDS_ACCOUNT = manual(`Wikiloc pide Premium o iniciar sesión para descargar esta ruta. ${OFFICIAL}`);
const MAX_MB = MAX_WIKILOC_GPX_BYTES / (1024 * 1024);

function isGpx(text: string): boolean {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  return xml.getElementsByTagName('parsererror').length === 0 && xml.documentElement?.localName === 'gpx';
}

export async function downloadTrackGpx(doc: Document, pageUrl: string, fetchFn: typeof fetch): Promise<DownloadResult> {
  const f = WIKILOC_FORMAT.track;
  if (doc.querySelector(f.premium)) return manual(`Wikiloc pide Premium para descargar esta ruta. ${OFFICIAL}`);
  if (doc.querySelector(f.login)) return manual('Inicia sesión en Wikiloc y vuelve a pulsar el marcador, o usa el botón «Descargar» de Wikiloc.');
  const href = doc.querySelector(f.download)?.getAttribute('href');
  if (!href) return manual(`No se encuentra la descarga oficial en esta página. ${OFFICIAL}`);
  const origin = new URL(pageUrl).origin;
  let url: URL;
  try { url = new URL(href, pageUrl); } catch { return manual(`El enlace de descarga no es válido. ${OFFICIAL}`); }
  if (url.origin !== origin) return manual(`El enlace de descarga lleva a otro sitio. ${OFFICIAL}`);
  if (WIKILOC_FORMAT.blockedPath.test(url.pathname)) return NEEDS_ACCOUNT;

  let res: Response;
  try {
    res = await fetchFn(url.href, { credentials: 'include', redirect: 'follow' });
  } catch {
    return manual(`No se pudo descargar el GPX. ${OFFICIAL}`);
  }
  if (res.redirected && res.url) {
    const final = new URL(res.url);
    if (final.origin !== origin) return manual(`La descarga ha llevado a otro sitio. ${OFFICIAL}`);
    if (WIKILOC_FORMAT.blockedPath.test(final.pathname)) return NEEDS_ACCOUNT;
  }
  if (res.status === 401 || res.status === 403) return NEEDS_ACCOUNT;
  if (!res.ok) return manual(`Wikiloc respondió con el código ${res.status}. ${OFFICIAL}`);
  const tooBig = manual(`El GPX supera ${MAX_MB} MB. ${OFFICIAL}`);
  if (Number(res.headers.get('content-length')) > MAX_WIKILOC_GPX_BYTES) return tooBig;
  const gpx = (await res.text()).replace(/^﻿/, '');
  if (!fitsGpx(gpx)) return tooBig;
  if (!isGpx(gpx)) return manual(`Wikiloc no ha entregado un GPX: puede pedir una confirmación. ${OFFICIAL}`);
  return { kind: 'gpx', gpx };
}
