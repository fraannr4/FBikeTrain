import { TZDate } from '@date-fns/tz';
import type { RouteGroup, RouteSig, StoredActivity } from '../../domain/types';
import { TZ } from '../../metrics/aggregate';
import { routeSimilarity } from '../../metrics/routes';
import { daysAgo, longDay } from '../climbView';

/** «Ayer, jueves 5 de noviembre, a las 9:12»; «Hoy, a las 9:12»; «Martes 27 de octubre, a las 17:40». */
export function whenLabel(t: number, now: number): string {
  const d = new TZDate(t, TZ);
  const at = `a las ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const days = daysAgo(t, now);
  if (days === 0) return `Hoy, ${at}`;
  const day = longDay(t, now);
  if (days === 1) return `Ayer, ${day.charAt(0).toLowerCase()}${day.slice(1)}, ${at}`;
  return `${day}, ${at}`;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «12 oct», o «12 oct 2025» si no es de este año. */
export function shortDate(t: number, now: number): string {
  const d = new TZDate(t, TZ);
  const year = d.getFullYear() !== new TZDate(now, TZ).getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MESES[d.getMonth()]}${year}`;
}

/** «2.ª», «12.ª»: ordinal femenino (la salida). */
export const ordinal = (n: number) => `${n}.ª`;

/* ---------- Frente a tu media ---------- */

const YEAR_MS = 365 * 86_400_000;
/** Con menos salidas que estas en 12 meses, la comparación no dice nada. */
export const MIN_COMPARE_RIDES = 4;

export type MetricKey = 'dist' | 'elev' | 'time' | 'speed';

export type CompareRow = {
  key: MetricKey;
  /** Esta salida y la media de las demás, en la unidad de la métrica (m, m, s, m/s). */
  me: number;
  mean: number;
  /** Diferencia con la media, en %. */
  deltaPct: number;
  /** «3.ª más corta», «más rápida» (sin el artículo). */
  rank: string;
  /** Cuántas salidas entran en la comparación, esta incluida. */
  total: number;
  /** Las demás salidas. */
  others: number[];
};

const RANK_WORDS: Record<MetricKey, [high: string, low: string]> = {
  dist: ['más larga', 'más corta'],
  elev: ['con más desnivel', 'con menos desnivel'],
  time: ['más larga en tiempo', 'más corta en tiempo'],
  speed: ['más rápida', 'más lenta'],
};

const VALUE: Record<MetricKey, (a: StoredActivity) => number> = {
  dist: (a) => a.totals.distanceM,
  elev: (a) => a.totals.elevGainM,
  time: (a) => a.totals.movingTimeS,
  speed: (a) => a.totals.avgSpeedMs,
};

/**
 * Esta salida frente a las demás de los últimos 12 meses (hasta `now`), métrica a métrica. En la mitad
 * baja el puesto se cuenta desde abajo: «la 3.ª más corta», no «la 4.ª más larga». Una métrica sin dato
 * (velocidad 0) se queda fuera. `null` si no hay al menos MIN_COMPARE_RIDES salidas más.
 */
export function compareRide(ride: StoredActivity, acts: StoredActivity[], now: number): CompareRow[] | null {
  const pool = acts.filter((a) => a.id !== ride.id && a.startTime > now - YEAR_MS && a.startTime <= now);
  if (pool.length < MIN_COMPARE_RIDES) return null;
  const rows: CompareRow[] = [];
  for (const key of Object.keys(VALUE) as MetricKey[]) {
    const me = VALUE[key](ride);
    const others = pool.map(VALUE[key]).filter((v) => Number.isFinite(v) && v > 0);
    if (!(me > 0) || others.length < MIN_COMPARE_RIDES) continue;
    const mean = others.reduce((s, v) => s + v, 0) / others.length;
    const total = others.length + 1;
    const above = others.filter((v) => v > me).length;
    const low = above + 1 > total / 2;
    const n = low ? others.filter((v) => v < me).length + 1 : above + 1;
    const word = RANK_WORDS[key][low ? 1 : 0];
    rows.push({
      key,
      me,
      mean,
      deltaPct: (me / mean - 1) * 100,
      rank: n === 1 ? word : `${ordinal(n)} ${word}`,
      total,
      others,
    });
  }
  return rows.length > 0 ? rows : null;
}

/** Huecos para que los puntos de la tira no se tapen: 5 carriles, el central primero. */
const LANES = [2, 1, 3, 0, 4];
const LANE_GAP_PCT = 3.2;

/** Posición (0-100) y carril (0-4) de cada valor en una tira de `lo` a `hi`, como en el prototipo. */
export function swarm(values: number[], lo: number, hi: number): { x: number; lane: number }[] {
  const span = hi - lo || 1;
  const last: (number | null)[] = [null, null, null, null, null];
  return [...values]
    .sort((a, b) => a - b)
    .map((v) => {
      const x = ((v - lo) / span) * 100;
      const lane = LANES.find((l) => last[l] === null || x - (last[l] as number) > LANE_GAP_PCT) ?? 2;
      last[lane] = x;
      return { x, lane };
    });
}

/* ---------- Rutas parecidas ---------- */

/** A partir de esta similitud (Jaccard de celdas) una ruta es parecida (D9: de 0,3 a 0,6). */
export const SIMILAR_MIN = 0.3;

export type Similar = { activityId: string; share: number };

/**
 * Salidas parecidas a esta: similitud de al menos SIMILAR_MIN, fuera de su propio grupo de ruta y una
 * por grupo, la más parecida. Como mucho `max`, de más a menos parecida.
 */
export function similarRides(sig: RouteSig, sigs: RouteSig[], groups: RouteGroup[], max = 3): Similar[] {
  if (sig.cells.length === 0) return [];
  const groupOf = new Map<string, string>();
  for (const g of groups) for (const id of g.activityIds) groupOf.set(id, g.id);
  const own = groupOf.get(sig.activityId);
  const best = new Map<string, Similar>();
  for (const s of sigs) {
    if (s.activityId === sig.activityId) continue;
    const key = groupOf.get(s.activityId) ?? s.activityId;
    if (own !== undefined && key === own) continue;
    const share = routeSimilarity(sig.cells, s.cells);
    if (share < SIMILAR_MIN) continue;
    const prev = best.get(key);
    if (!prev || share > prev.share) best.set(key, { activityId: s.activityId, share });
  }
  return [...best.values()].sort((a, b) => b.share - a.share).slice(0, max);
}
