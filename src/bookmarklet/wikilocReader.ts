import type { WikilocCard } from '../routes/wikilocNearby';
import { MAX_NEARBY_CARDS, WIKILOC_AUTHOR_MAX, WIKILOC_NAME_MAX, isWikilocUrl } from '../routes/wikilocLimits';

/**
 * Lectura de lo que el usuario ya ve en su pestaña de Wikiloc: nombre, km, desnivel,
 * dificultad, autor y enlace. Funciones puras: no hacen peticiones ni tocan la página.
 *
 * Todo lo que depende del HTML o del JSON de Wikiloc vive en WIKILOC_FORMAT. Los valores
 * actuales son un supuesto razonable sin validar contra la página real: cuando cambie el
 * formato se ajusta este objeto, no la lógica.
 */

type Difficulty = NonNullable<WikilocCard['dificultad']>;

export const WIKILOC_FORMAT = {
  /** Rutas de las páginas, sobre `location.pathname`. */
  paths: {
    map: /^\/wikiloc\/map\.do$/i,
    /** Ficha de una ruta: `/<actividad>/<nombre>-<id>`. El grupo 1 es el id. */
    track: /^\/(?!wikiloc\/)[a-z0-9-]+\/[^/]*-(\d{1,20})\/?$/i,
  },
  /** Tarjetas de una lista de resultados (la del mapa o la de una búsqueda). */
  list: {
    card: '[data-trail-id], .trail-card',
    idAttribute: 'data-trail-id',
    name: '.trail-title, h2, h3',
    author: '.trail-author, [itemprop="author"]',
    /** Cada cifra se busca primero por su selector y, si no está, por la etiqueta que la precede. */
    fields: {
      distance: { selector: '[data-stat="distance"]', labels: ['distancia', 'distance'] },
      elevation: { selector: '[data-stat="elevation-gain"]', labels: ['desnivel positivo', 'desnivel +', 'elevation gain'] },
      difficulty: { selector: '[data-stat="difficulty"]', labels: ['dificultad tecnica', 'dificultad', 'technical difficulty', 'difficulty'] },
    },
    /** Elementos que hacen de etiqueta; el valor es el elemento hermano siguiente. */
    label: 'dt, .label, [class*="label"]',
  },
  /** Consulta que hace el propio mapa para la vista actual. Formato por confirmar. */
  find: {
    path: '/wikiloc/find.do',
    params: { event: 'map' } as Record<string, string>,
    /** Parámetros de la vista que se copian de la URL del mapa. */
    copyParams: ['sw', 'ne', 'act', 'page'],
    /** Claves donde puede venir la lista; también se acepta una lista en la raíz. */
    lists: ['spas', 'trails', 'results'],
    /** Caminos con puntos dentro de cada ruta. */
    fields: { id: 'id', name: 'name', distance: 'distance', elevation: 'elevationGain', difficulty: 'difficulty', author: 'author.name', url: 'prettyURL' },
    /** Unidad de `distance` cuando llega como número. */
    distanceUnit: 'm' as 'm' | 'km',
  },
  /** Ficha de una ruta. */
  track: {
    name: 'h1',
    author: '[itemprop="author"] [itemprop="name"], .author-name, a[href*="/wikiloc/user.do"]',
    /** Enlace de la descarga oficial de GPX que ofrece la página. */
    download: 'a[href*="download.do"], a[href$=".gpx"], a[data-download="gpx"]',
    /** Señales de que la descarga necesita Premium o iniciar sesión. */
    premium: '[data-premium-required], .premium-required',
    login: '[data-login-required], .login-required',
  },
  /** Una URL de descarga o de redirección con esto en la ruta no lleva a un GPX. */
  blockedPath: /login|signin|signup|register|premium|checkout|subscribe/i,
  /** Etiquetas de dificultad normalizadas (minúsculas y sin tildes). */
  difficulties: {
    'facil': 'facil', 'easy': 'facil',
    'moderado': 'moderado', 'moderate': 'moderado',
    'dificil': 'dificil', 'difficult': 'dificil',
    'muy dificil': 'muy-dificil', 'very difficult': 'muy-dificil',
    'solo expertos': 'experto', 'experto': 'experto', 'expertos': 'experto', 'experts only': 'experto',
  } as Record<string, Difficulty>,
  /** Dificultad numérica de la consulta del mapa: 1 es fácil y 5, solo expertos. */
  difficultyScale: ['facil', 'moderado', 'dificil', 'muy-dificil', 'experto'] as Difficulty[],
  maxCards: MAX_NEARBY_CARDS,
};

const URL_MAX = 2048;
const KM_MAX = 1000;
const ELEV_MAX_M = 20_000;

/** Minúsculas, sin tildes, espacios simples y sin los dos puntos finales. */
const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\s+/g, ' ').replace(/[\s:]+$/, '').trim();
const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

/** Corta a `max` unidades UTF-16 sin partir un par sustituto. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** Número en castellano (punto de miles y coma decimal); también acepta «106.44». */
function parseNumber(raw: string): number | null {
  const s = raw.replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d+(,\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  return null;
}

const QUANTITY = /(\d[\d.,\s]*\d|\d)\s*(km|m)(?![a-z])/i;

/** Lee «106,44 km» o «2.405 m» y lo devuelve en la unidad pedida. Otra unidad o sin cifra: null. */
export function parseQuantity(text: string, unit: 'km' | 'm'): number | null {
  const match = QUANTITY.exec(text);
  if (!match) return null;
  const value = parseNumber(match[1]);
  if (value === null) return null;
  const inKm = match[2].toLowerCase() === 'km';
  if (unit === 'km') return inKm ? value : value / 1000;
  return inKm ? value * 1000 : value;
}

function parseDifficulty(value: unknown): Difficulty | null {
  if (typeof value === 'number') return WIKILOC_FORMAT.difficultyScale[value - 1] ?? null;
  if (typeof value !== 'string') return null;
  return WIKILOC_FORMAT.difficulties[normalize(value)] ?? null;
}

type RawCard = { id?: string | null; nombre: string; km: number | null; desnivelM: number | null; dificultad: Difficulty | null; autor: string | null; href: string | null };

/** Enlace limpio de una ficha de wikiloc.com (sin consulta ni fragmento) y su id. */
function trackLink(href: string | null, base: string): { url: string; id: string } | null {
  if (!href) return null;
  let url: URL;
  try { url = new URL(href, base); } catch { return null; }
  const clean = `${url.origin}${url.pathname}`;
  const id = WIKILOC_FORMAT.paths.track.exec(url.pathname)?.[1];
  if (!id || clean.length > URL_MAX || !isWikilocUrl(clean)) return null;
  return { url: clean, id };
}

/** Deja la tarjeta dentro de los límites del mensaje, o la descarta si falta lo esencial. */
function toCard(raw: RawCard, base: string): WikilocCard | null {
  const link = trackLink(raw.href, base);
  const nombre = clip(clean(raw.nombre), WIKILOC_NAME_MAX);
  if (!link || !nombre || raw.km === null || !Number.isFinite(raw.km) || raw.km < 0 || raw.km > KM_MAX) return null;
  const elev = raw.desnivelM;
  const autor = clip(clean(raw.autor), WIKILOC_AUTHOR_MAX);
  return {
    id: raw.id && /^\d{1,20}$/.test(raw.id) ? raw.id : link.id,
    nombre,
    km: Math.round(raw.km * 100) / 100,
    desnivelM: elev !== null && Number.isFinite(elev) && elev >= 0 && elev <= ELEV_MAX_M ? Math.round(elev) : null,
    dificultad: raw.dificultad,
    autor: autor || null,
    url: link.url,
  };
}

/** Sin duplicados por id y como mucho `maxCards`. */
function collect(raws: RawCard[], base: string): WikilocCard[] {
  const seen = new Set<string>();
  const cards: WikilocCard[] = [];
  for (const raw of raws) {
    const card = toCard(raw, base);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    cards.push(card);
    if (cards.length === WIKILOC_FORMAT.maxCards) break;
  }
  return cards;
}

type FieldFormat = { selector: string; labels: string[] };

function fieldText(card: Element, field: FieldFormat): string {
  const direct = card.querySelector(field.selector);
  if (direct) return clean(direct.textContent);
  for (const label of card.querySelectorAll(WIKILOC_FORMAT.list.label)) {
    if (field.labels.includes(normalize(label.textContent ?? ''))) return clean(label.nextElementSibling?.textContent);
  }
  return '';
}

/** Lee las tarjetas de la lista que el usuario tiene a la vista. */
export function readListFromDocument(doc: Document, pageUrl: string): WikilocCard[] {
  const f = WIKILOC_FORMAT.list;
  const raws: RawCard[] = [];
  for (const card of doc.querySelectorAll(f.card)) {
    // El primer enlace que lleva a una ficha; el del autor o los de etiquetas no cuentan.
    const anchor = [...card.querySelectorAll('a[href]')].find(a => trackLink(a.getAttribute('href'), pageUrl));
    raws.push({
      id: card.getAttribute(f.idAttribute),
      nombre: clean(card.querySelector(f.name)?.textContent) || clean(anchor?.textContent),
      km: parseQuantity(fieldText(card, f.fields.distance), 'km'),
      desnivelM: parseQuantity(fieldText(card, f.fields.elevation), 'm'),
      dificultad: parseDifficulty(fieldText(card, f.fields.difficulty)),
      autor: clean(card.querySelector(f.author)?.textContent) || null,
      href: anchor?.getAttribute('href') ?? null,
    });
  }
  return collect(raws, pageUrl);
}

/** URL de la consulta del mapa para la misma vista, en el mismo origen que la página. */
export function mapQueryUrl(pageUrl: string): string {
  const page = new URL(pageUrl);
  const url = new URL(WIKILOC_FORMAT.find.path, page.origin);
  for (const [key, value] of Object.entries(WIKILOC_FORMAT.find.params)) url.searchParams.set(key, value);
  for (const key of WIKILOC_FORMAT.find.copyParams) {
    const value = page.searchParams.get(key);
    if (value !== null) url.searchParams.set(key, value);
  }
  return url.href;
}

function pick(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

const text = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value) : null);

function quantity(value: unknown, unit: 'km' | 'm', numberUnit: 'km' | 'm'): number | null {
  if (typeof value === 'string') return parseQuantity(value, unit);
  if (typeof value !== 'number') return null;
  if (unit === numberUnit) return value;
  return unit === 'km' ? value / 1000 : value * 1000;
}

/** Lee la respuesta de la consulta del mapa. Devuelve null si no tiene el formato esperado. */
export function readFindResponse(json: unknown, pageUrl: string): WikilocCard[] | null {
  const f = WIKILOC_FORMAT.find;
  const list = Array.isArray(json) ? json : f.lists.map(key => pick(json, key)).find(Array.isArray);
  if (!list) return null;
  const raws = list.map((item): RawCard => ({
    id: text(pick(item, f.fields.id)),
    nombre: text(pick(item, f.fields.name)) ?? '',
    km: quantity(pick(item, f.fields.distance), 'km', f.distanceUnit),
    desnivelM: quantity(pick(item, f.fields.elevation), 'm', 'm'),
    dificultad: parseDifficulty(pick(item, f.fields.difficulty)),
    autor: text(pick(item, f.fields.author)),
    href: text(pick(item, f.fields.url)),
  }));
  return collect(raws, pageUrl);
}

export type TrackPage = { id: string; url: string; nombre: string; autor: string | null };

/** Datos de la ficha abierta. Fuera de una ficha, o sin nombre, devuelve null. */
export function readTrackPage(doc: Document, pageUrl: string): TrackPage | null {
  const link = trackLink(pageUrl, pageUrl);
  const nombre = clip(clean(doc.querySelector(WIKILOC_FORMAT.track.name)?.textContent), WIKILOC_NAME_MAX);
  if (!link || !nombre) return null;
  const autor = clip(clean(doc.querySelector(WIKILOC_FORMAT.track.author)?.textContent), WIKILOC_AUTHOR_MAX);
  return { id: link.id, url: link.url, nombre, autor: autor || null };
}
