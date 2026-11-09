import { abortError, isAbort } from '../ai/abort';
import type { LatLng } from '../domain/types';
import { haversineM } from '../import/summary';
import { difficulty, type Difficulty, type UserReference } from '../metrics/reference';
import { ROAD_FILTER, UNPAVED_SURFACES, usesMotorway } from './analyze';
import { analyzeReferenceRoutePoints, MAX_REFERENCE_POINTS, RouteLibraryError, routePointsToGpx, type RoutePoint } from './library';
import { fetchRoadFeatures, OrsError, type OrsAccess, type OrsExtra, type OrsFeature } from './ors';
import { buildOrsBody, type SharedOrsRequest } from './shared/orsService';

/**
 * Empalme de dos rutas guardadas en una sola, para bici de carretera. El código elige el orden, el
 * sentido y los puntos de unión; las carreteras de los conectores las pone ORS y las cifras las
 * calcula el código. Nada de esto pasa por la IA.
 */

export const SPLICE = {
  /** Una ruta cuyo final queda a esta distancia de su inicio es circular y se puede invertir. */
  loopCloseM: 50,
  /** Si las rutas pasan a menos de esto, se unen por su punto más cercano y no por los extremos. */
  nearM: 300,
  /** Por debajo, se une directamente, sin pedir conector. */
  directJoinM: 30,
  /** Salto máximo admitido en una unión. */
  maxGapM: 50,
  /** Mismo tramo en sentido contrario durante más de esto: retroceso. */
  backtrackMinM: 500,
  /** Dos conectores son alternativas si su distancia difiere como mucho esto... */
  altMaxDistDiff: 0.15,
  /** ...y comparten menos de esta fracción del trazado. */
  altMaxShare: 0.7,
  /** Combinaciones que se enseñan (cada una con su alternativa, si la hay). */
  maxGroups: 6,
} as const;

/** Alternativas que se piden a ORS en cada conector; cuesta una consulta igual que una sola ruta. */
const ORS_ALTERNATIVES = 3;
/** Separación máxima de los puntos del conector: ORS da vértices lejanos en las rectas. */
const DENSIFY_M = 40;
/** Rejilla para solapes y trazado compartido. */
const SAMPLE_M = 20;
/** Separación de los puntos de unión candidatos en una circular. */
const JOIN_STEP_M = 10;
const MATCH_M = 20;
/** Un punto no se compara con los inmediatamente anteriores, que siempre están cerca. */
const MIN_LOOKBACK_M = 3 * SAMPLE_M;
const OPPOSITE_DEG = 120;
const MAX_UNKNOWN_SURFACE_PCT = 20;
const WAYTYPE_STATE_ROAD = 1;
const WAYTYPE_TRACK = 5;
const M_PER_DEG_LAT = 111_320;

export type SpliceInput = { id: string; name: string; points: RoutePoint[] };
export type ConnectorFetch = (from: LatLng, to: LatLng, signal?: AbortSignal) => Promise<OrsFeature[]>;
export type PieceSource = 'A' | 'B' | 'conector' | 'regreso';
/** Tramo de `points` (índices incluidos) y de dónde sale. */
export type SplicePiece = { source: PieceSource; from: number; to: number };
export type DiscardReason = 'autopista' | 'carretera principal' | 'sin asfaltar' | 'pistas' | 'firme desconocido' | 'salto' | 'sin datos' | 'sin carretera' | 'demasiados puntos';

export type SpliceOption = {
  id: string;
  /** AB: primero la ruta A y luego la B. */
  order: 'AB' | 'BA';
  /** Ruta recorrida al revés (solo las circulares). */
  reversed: { A: boolean; B: boolean };
  points: RoutePoint[];
  pieces: SplicePiece[];
  distanceM: number;
  /** Distancia sin contar dos veces los tramos repetidos. */
  distinctM: number;
  /** `null` si falta la altitud en algún punto: no se inventa. */
  elevGainM: number | null;
  estTimeS: number | null;
  difficulty: Difficulty | null;
  /** Conectores de unión y de regreso calculados por ORS. */
  connectorM: number;
  /** Vías principales de los conectores, en % de la distancia total (de las rutas originales no hay datos). */
  mainRoadPct: number;
  overlapM: number;
  backtrackM: number;
  /** Alternativa parecida de la opción con este `id`. */
  alternativeOf?: string;
};

export type SpliceResult = {
  options: SpliceOption[];
  discarded: { order: 'AB' | 'BA'; reason: DiscardReason }[];
  requestsUsed: number;
  /** Error de ORS que cortó la búsqueda a medias; las opciones ya calculadas se conservan. */
  stoppedBy: OrsError | null;
};

export type SpliceDeps = { connectors: ConnectorFetch; reference?: UserReference | null; signal?: AbortSignal };

type Connector = { points: RoutePoint[]; distanceM: number; mainRoadM: number };
type Connectors = { valid: Connector[]; reasons: DiscardReason[] };

const gap = (a: LatLng, b: LatLng) => haversineM(a.lat, a.lng, b.lat, b.lng);

function lengthM(points: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += gap(points[i - 1], points[i]);
  return d;
}

const isLoop = (points: RoutePoint[]) => points.length > 2 && gap(points[0], points[points.length - 1]) <= SPLICE.loopCloseM;
/** Puntos de la circular sin repetir el de cierre. */
const ringOf = (points: RoutePoint[]) => (gap(points[0], points[points.length - 1]) === 0 ? points.slice(0, -1) : points);
/** Posición del punto en el anillo; el de cierre que no está en él equivale al inicio. */
const ringIndex = (points: RoutePoint[], p: RoutePoint) => Math.max(0, ringOf(points).indexOf(p));
/** La circular empezando y acabando en el punto `i` de su anillo. */
function rotate(points: RoutePoint[], i: number): RoutePoint[] {
  const ring = ringOf(points);
  return [...ring.slice(i), ...ring.slice(0, i), ring[i]];
}

/** Índice de rejilla de lado `cellM` alrededor de una latitud de referencia. */
function grid(lat0: number, cellM: number) {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const cell = (p: LatLng) => [Math.floor((p.lat * M_PER_DEG_LAT) / cellM), Math.floor((p.lng * mPerDegLng) / cellM)];
  const cells = new Map<string, number[]>();
  return {
    add(p: LatLng, value: number) {
      const [r, c] = cell(p);
      const key = `${r}:${c}`;
      const list = cells.get(key);
      if (list) list.push(value); else cells.set(key, [value]);
    },
    near(p: LatLng): number[] {
      const [r, c] = cell(p);
      const out: number[] = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) out.push(...(cells.get(`${r + dr}:${c + dc}`) ?? []));
      return out;
    },
  };
}

/** Índices del anillo separados al menos `JOIN_STEP_M`: acota la búsqueda con tracks de miles de puntos. */
function spacedRing(points: RoutePoint[]): number[] {
  const ring = ringOf(points);
  const out = [0];
  let walked = 0;
  for (let i = 1; i < ring.length; i++) {
    walked += gap(ring[i - 1], ring[i]);
    if (walked >= JOIN_STEP_M) { out.push(i); walked = 0; }
  }
  return out;
}

/**
 * Punto de salida de `x` y de entrada a `y`. Un tramo abierto solo se deja por su final y se toma
 * por su inicio; una circular, por cualquier punto. Si pasan a menos de 300 m, el par más cercano;
 * si no, los extremos.
 */
function joinPair(x: RoutePoint[], xLoop: boolean, y: RoutePoint[], yLoop: boolean): { i: number; j: number } {
  const xs = xLoop ? spacedRing(x) : [x.length - 1];
  const ys = yLoop ? spacedRing(y) : [0];
  const index = grid(y[0].lat, SPLICE.nearM);
  for (const j of ys) index.add(y[j], j);
  let best: { i: number; j: number; d: number } | null = null;
  for (const i of xs) {
    for (const j of index.near(x[i])) {
      const d = gap(x[i], y[j]);
      if (d < SPLICE.nearM && (!best || d < best.d)) best = { i, j, d };
    }
  }
  return best ?? { i: xLoop ? 0 : x.length - 1, j: 0 };
}

/** Puntos intermedios en línea recta, sobre la misma recta que ORS ya ha devuelto. */
function densify(points: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = [points[0]];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1]; const b = points[k];
    const n = Math.ceil(gap(a, b) / DENSIFY_M);
    for (let s = 1; s < n; s++) {
      const t = s / n;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, ...(a.ele !== undefined && b.ele !== undefined ? { ele: a.ele + (b.ele - a.ele) * t } : {}) });
    }
    out.push(b);
  }
  return out;
}

const validExtra = (e: OrsExtra | undefined): e is OrsExtra =>
  !!e && Array.isArray(e.values) && Array.isArray(e.summary) && e.summary.length > 0 && e.summary.every(s => Number.isFinite(s.distance) && Number.isFinite(s.amount));
const sum = (e: OrsExtra, field: 'distance' | 'amount', match: (v: number) => boolean) => e.summary.reduce((n, s) => (match(s.value) ? n + s[field] : n), 0);

/** Conector de carretera válido, o el motivo por el que no lo es. Autopistas: `usesMotorway`. */
function assess(f: OrsFeature, from: LatLng, to: LatLng): Connector | DiscardReason {
  const coords: unknown = f?.geometry?.coordinates;
  const extras = f?.properties?.extras;
  if (!Array.isArray(coords) || coords.length < 2 || !validExtra(extras?.surface) || !validExtra(extras?.waytypes) || !validExtra(extras?.waycategory)) return 'sin datos';
  if (usesMotorway(extras.waycategory)) return 'autopista';
  if (sum(extras.surface, 'distance', v => UNPAVED_SURFACES.has(v)) > ROAD_FILTER.maxUnpavedM) return 'sin asfaltar';
  if (sum(extras.waytypes, 'distance', v => v === WAYTYPE_TRACK) > ROAD_FILTER.maxTrackM) return 'pistas';
  if (sum(extras.waytypes, 'amount', v => v === WAYTYPE_STATE_ROAD) > ROAD_FILTER.maxMainRoadPct) return 'carretera principal';
  if (sum(extras.surface, 'amount', v => v === 0) > MAX_UNKNOWN_SURFACE_PCT) return 'firme desconocido';
  const points: RoutePoint[] = [];
  for (const c of coords as unknown[]) {
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) return 'sin datos';
    points.push({ lat: c[1], lng: c[0], ...(Number.isFinite(c[2]) ? { ele: c[2] } : {}) });
  }
  if (gap(points[0], from) > SPLICE.maxGapM || gap(points[points.length - 1], to) > SPLICE.maxGapM) return 'salto';
  return { points: densify(points), distanceM: lengthM(points), mainRoadM: sum(extras.waytypes, 'distance', v => v === WAYTYPE_STATE_ROAD) };
}

type Sample = LatLng & { d: number; bearing: number };

/** Un punto cada 20 m a lo largo del trazado, con su rumbo. */
function samples(points: LatLng[]): Sample[] {
  const out: Sample[] = [];
  let walked = 0; let next = 0;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1]; const b = points[k];
    const seg = gap(a, b);
    if (seg === 0) continue;
    const kx = Math.cos((a.lat * Math.PI) / 180);
    const bearing = (Math.atan2((b.lng - a.lng) * kx, b.lat - a.lat) * 180) / Math.PI;
    while (next <= walked + seg) {
      const t = (next - walked) / seg;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, d: next, bearing });
      next += SAMPLE_M;
    }
    walked += seg;
  }
  return out;
}

const angle = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Metros que repiten un tramo ya recorrido y, de ellos, los recorridos al revés en tramos de más de 500 m. */
function repeats(points: LatLng[]): { overlapM: number; backtrackM: number } {
  const s = samples(points);
  if (s.length === 0) return { overlapM: 0, backtrackM: 0 };
  const index = grid(s[0].lat, MATCH_M);
  let overlapM = 0; let backtrackM = 0; let run = 0;
  const flush = () => { if (run > SPLICE.backtrackMinM) backtrackM += run; run = 0; };
  for (let k = 0; k < s.length; k++) {
    let match: Sample | null = null; let best = Infinity;
    for (const m of index.near(s[k])) {
      const d = gap(s[k], s[m]);
      if (s[k].d - s[m].d > MIN_LOOKBACK_M && d <= MATCH_M && d < best) { best = d; match = s[m]; }
    }
    if (match) {
      overlapM += SAMPLE_M;
      if (angle(match.bearing, s[k].bearing) > OPPOSITE_DEG) run += SAMPLE_M; else flush();
    } else flush();
    index.add(s[k], k);
  }
  flush();
  return { overlapM, backtrackM };
}

/** Fracción del trazado de `a` que pasa a menos de 20 m de `b`. */
function sharedFraction(a: LatLng[], b: LatLng[]): number {
  const sa = samples(a); const sb = samples(b);
  if (sa.length === 0 || sb.length === 0) return 0;
  const index = grid(sb[0].lat, MATCH_M);
  sb.forEach((p, i) => index.add(p, i));
  const shared = sa.filter(p => index.near(p).some(i => gap(p, sb[i]) <= MATCH_M)).length;
  return shared / sa.length;
}

function similar(a: Connector, b: Connector): boolean {
  const diff = Math.abs(a.distanceM - b.distanceM) / Math.min(a.distanceM, b.distanceM);
  return diff <= SPLICE.altMaxDistDiff && Math.max(sharedFraction(a.points, b.points), sharedFraction(b.points, a.points)) < SPLICE.altMaxShare;
}

/** Une `next` al final del recorrido; el punto repetido de la unión se quita. */
function append(points: RoutePoint[], pieces: SplicePiece[], next: RoutePoint[], source: PieceSource) {
  const from = Math.max(0, points.length - 1);
  const rest = points.length > 0 && gap(points[points.length - 1], next[0]) <= 1 ? next.slice(1) : next;
  points.push(...rest);
  pieces.push({ source, from, to: points.length - 1 });
}

/**
 * Dos salidas largas pueden pasar juntas del límite de puntos de la biblioteca (50.000), aunque cada
 * una quepa. Se aclara el track uniformemente, conservando los extremos de cada tramo, para que el
 * empalme se pueda medir y exportar.
 */
function thin(points: RoutePoint[], pieces: SplicePiece[]): { points: RoutePoint[]; pieces: SplicePiece[] } {
  const limit = MAX_REFERENCE_POINTS - 2 * pieces.length - 2;
  if (points.length <= MAX_REFERENCE_POINTS) return { points, pieces };
  const step = Math.ceil(points.length / limit);
  const keep = new Set<number>([0, points.length - 1]);
  for (const piece of pieces) { keep.add(piece.from); keep.add(piece.to); }
  const index = new Map<number, number>();
  const out: RoutePoint[] = [];
  points.forEach((p, i) => {
    if (i % step === 0 || keep.has(i)) { index.set(i, out.length); out.push(p); }
  });
  return { points: out, pieces: pieces.map(piece => ({ ...piece, from: index.get(piece.from)!, to: index.get(piece.to)! })) };
}

function measure(
  base: { id: string; order: 'AB' | 'BA'; reversed: { A: boolean; B: boolean } },
  points: RoutePoint[],
  pieces: SplicePiece[],
  used: Connector[],
  reference: UserReference | null,
): SpliceOption {
  const summary = analyzeReferenceRoutePoints(points);
  const { overlapM, backtrackM } = repeats(points);
  const distanceM = summary.distanceM;
  return {
    ...base, points, pieces, distanceM,
    distinctM: Math.max(0, distanceM - overlapM),
    elevGainM: summary.elevGainM,
    estTimeS: reference && reference.avgSpeedMs > 0 ? distanceM / reference.avgSpeedMs : null,
    difficulty: reference && summary.elevGainM !== null ? difficulty({ distanceM, elevGainM: summary.elevGainM }, reference) : null,
    connectorM: used.reduce((n, c) => n + c.distanceM, 0),
    mainRoadPct: (used.reduce((n, c) => n + c.mainRoadM, 0) / distanceM) * 100,
    overlapM, backtrackM,
  };
}

/** Sin IA gana la combinación más corta sin vías principales; si todas tienen, la que menos y luego la más corta. */
export function defaultChoice(options: SpliceOption[]): string | null {
  const clean = options.filter(o => o.mainRoadPct === 0);
  const pool = clean.length > 0 ? clean : options;
  return [...pool].sort((a, b) => a.mainRoadPct - b.mainRoadPct || a.distanceM - b.distanceM)[0]?.id ?? null;
}

const pointKey = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/**
 * Prueba las combinaciones de orden y sentido permitidas (una circular se puede invertir; un tramo
 * abierto, no), pide a ORS los conectores sin repetir consulta y devuelve las opciones válidas.
 * Un trayecto sin carretera descarta la combinación; cualquier otro error de ORS lanza si aún no
 * hay ninguna opción, o corta la búsqueda y se devuelve en `stoppedBy`.
 */
export async function spliceRoutes(a: SpliceInput, b: SpliceInput, opts: { returnToStart: boolean }, deps: SpliceDeps): Promise<SpliceResult> {
  const { signal } = deps;
  const reference = deps.reference ?? null;
  const checkAbort = () => { if (signal?.aborted) throw abortError(); };
  const cache = new Map<string, Connectors>();
  let requestsUsed = 0;
  const discarded: SpliceResult['discarded'] = [];

  /** Cada consulta a ORS se hace una vez; sus descartes se anotan al recibirla. */
  async function connectorsFor(from: LatLng, to: LatLng, order: 'AB' | 'BA'): Promise<Connectors> {
    const key = `${pointKey(from)}>${pointKey(to)}`;
    const known = cache.get(key);
    if (known) return known;
    checkAbort();
    requestsUsed++;
    let result: Connectors;
    try {
      const features = await deps.connectors(from, to, signal);
      checkAbort();
      const assessed = features.map(f => assess(f, from, to));
      result = { valid: assessed.filter((c): c is Connector => typeof c !== 'string'), reasons: assessed.filter((c): c is DiscardReason => typeof c === 'string') };
    } catch (e) {
      if (isAbort(e) || signal?.aborted) throw abortError();
      if (!(e instanceof OrsError) || e.kind !== 'no_route') throw e;
      result = { valid: [], reasons: ['sin carretera'] };
    }
    discarded.push(...result.reasons.map(reason => ({ order, reason })));
    cache.set(key, result);
    return result;
  }

  const routes = { A: a, B: b };
  const groups: SpliceOption[][] = [];
  let stoppedBy: OrsError | null = null;

  try {
    for (const order of ['AB', 'BA'] as const) {
      const [firstKey, secondKey] = order === 'AB' ? (['A', 'B'] as const) : (['B', 'A'] as const);
      const first = routes[firstKey].points; const second = routes[secondKey].points;
      const firstLoop = isLoop(first); const secondLoop = isLoop(second);
      // Los puntos de unión se eligen una vez por orden: invertir una circular no cambia dónde se une
      // ni gasta más consultas.
      const pair = joinPair(first, firstLoop, second, secondLoop);
      const exit = first[pair.i]; const entry = second[pair.j];
      for (const revFirst of firstLoop ? [false, true] : [false]) {
        for (const revSecond of secondLoop ? [false, true] : [false]) {
          checkAbort();
          const x = revFirst ? [...first].reverse() : first;
          const y = revSecond ? [...second].reverse() : second;
          const xr = firstLoop ? rotate(x, ringIndex(x, exit)) : x;
          const yr = secondLoop ? rotate(y, ringIndex(y, entry)) : y;
          const p = xr[xr.length - 1]; const q = yr[0];
          let variants: (Connector | null)[] = [null];
          if (gap(p, q) > SPLICE.directJoinM) {
            const found = await connectorsFor(p, q, order);
            if (found.valid.length === 0) continue;
            const [main, alt] = found.valid;
            variants = alt && similar(main, alt) ? [main, alt] : [main];
          }
          const reversed = { [firstKey]: revFirst, [secondKey]: revSecond } as { A: boolean; B: boolean };
          const id = `${order}-${Number(reversed.A)}${Number(reversed.B)}`;
          const group: SpliceOption[] = [];
          for (const [k, conn] of variants.entries()) {
            const points: RoutePoint[] = []; const pieces: SplicePiece[] = []; const used: Connector[] = [];
            append(points, pieces, xr, firstKey);
            if (conn) { append(points, pieces, conn.points, 'conector'); used.push(conn); }
            append(points, pieces, yr, secondKey);
            const start = points[0]; const end = points[points.length - 1];
            if (opts.returnToStart && gap(end, start) > SPLICE.directJoinM) {
              const back = await connectorsFor(end, start, order);
              if (back.valid.length === 0) continue;
              append(points, pieces, back.valid[0].points, 'regreso'); used.push(back.valid[0]);
            }
            let option: SpliceOption;
            try {
              const thinned = thin(points, pieces);
              option = measure({ id: k === 0 ? id : `${id}-alt`, order, reversed }, thinned.points, thinned.pieces, used, reference);
            } catch (err) {
              // Una combinación que no cabe no tumba las demás: se descarta con su motivo.
              if (!(err instanceof RouteLibraryError)) throw err;
              discarded.push({ order, reason: 'demasiados puntos' });
              continue;
            }
            group.push(k > 0 && group[0] ? { ...option, alternativeOf: group[0].id } : option);
          }
          if (group.length > 0) groups.push(group);
        }
      }
    }
  } catch (e) {
    if (!(e instanceof OrsError) || groups.length === 0) throw e;
    stoppedBy = e;
  }

  const rank = (o: SpliceOption) => [o.mainRoadPct > 0 ? 1 : 0, Math.round(o.distanceM / 100), Number(o.reversed.A) + Number(o.reversed.B)];
  const compare = (x: SpliceOption, y: SpliceOption) => {
    const rx = rank(x); const ry = rank(y);
    return rx[0] - ry[0] || rx[1] - ry[1] || rx[2] - ry[2] || x.order.localeCompare(y.order);
  };
  const options = groups.sort((x, y) => compare(x[0], y[0])).slice(0, SPLICE.maxGroups).flat();
  return { options, discarded, requestsUsed, stoppedBy };
}

/** GPX 1.1 con `trk`, `trkseg` y `ele` (cuando las rutas la traen), para la app de iGPSPORT. */
export function spliceGpx(name: string, option: SpliceOption): string {
  return routePointsToGpx(name, option.points);
}

/** Conectores por ORS con la clave personal o por el servicio común. */
export function orsConnectors(access: OrsAccess, fetchImpl: typeof fetch = fetch): ConnectorFetch {
  return (from, to, signal) => {
    const request: SharedOrsRequest = { operation: 'path', waypoints: [{ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }], alternatives: ORS_ALTERNATIVES };
    return typeof access === 'string' ? fetchRoadFeatures(access, buildOrsBody(request), signal, fetchImpl) : access.fetchAll(request, signal);
  };
}
