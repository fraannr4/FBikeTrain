import { DOMParser, onErrorStopParsing, type Document, type Element } from '@xmldom/xmldom';
import { ParseError } from '../domain/types';

// Se usa @xmldom/xmldom en todas partes: el Worker de importación no tiene DOMParser nativo.

/** Lee el XML; un documento vacío o mal formado lanza ParseError. */
export function parseXml(xml: string): Document {
  if (!xml.trim()) throw new ParseError('empty', 'El fichero está vacío');
  try {
    return new DOMParser({ onError: onErrorStopParsing }).parseFromString(xml, 'text/xml');
  } catch (e) {
    throw new ParseError('malformed', `XML no válido: ${(e as Error).message}`);
  }
}

/** Descendientes por nombre local, con cualquier prefijo de espacio de nombres (gpxtpx:, ns3:...). */
export function descendants(el: Document | Element, localName: string): Element[] {
  return Array.from(el.getElementsByTagNameNS('*', localName));
}

/** Primer hijo directo con ese nombre local. */
export function child(el: Element, localName: string): Element | undefined {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === n.ELEMENT_NODE && (n as Element).localName === localName) return n as Element;
  }
  return undefined;
}

/** Número de un texto; undefined si falta o no es un número. */
export function toNumber(text: string | null | undefined): number | undefined {
  if (text == null || text.trim() === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/** Fecha ISO a epoch ms; undefined si falta o no es válida. */
export function toTime(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const t = Date.parse(text.trim());
  return Number.isNaN(t) ? undefined : t;
}

export function text(el: Element | undefined): string | undefined {
  return el?.textContent ?? undefined;
}
