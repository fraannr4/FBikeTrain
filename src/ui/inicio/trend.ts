/**
 * Tendencia de 12 semanas de Inicio (prototipo móvil, inicio.js «drawTrend»): las 11 semanas ISO
 * completas y la semana en curso. Barras para las sumas y línea para la velocidad, que no empieza en 0.
 * - La media es la de las 11 semanas completas, y solo existe con 3 semanas o más con salidas.
 * - La semana en curso se compara con lo que sueles llevar «a estas alturas»: lo que llevabas en cada
 *   semana completa a la misma hora del mismo día, dividido entre 11. Comparar una semana a medias con
 *   semanas completas daría −85 % cada lunes.
 * Aquí solo hay cálculo y texto; TrendCard lo pinta.
 */
import { TZDate } from '@date-fns/tz';
import { startOfISOWeek, subWeeks } from 'date-fns';
import type { StoredActivity } from '../../domain/types';
import { aggregate, TZ, type PeriodTotals } from '../../metrics/aggregate';
import type { Accent } from '../accent';
import { formatCount, formatDeltaPct, formatDuration, formatNumber } from '../format';

export const TREND_WEEKS = 12;
const DONE = TREND_WEEKS - 1;
const MIN_WEEKS_WITH_RIDES = 3;
export const NO_MEAN = 'Aún no hay media: necesitas 3 semanas con salidas.';

export type TrendSeries = {
  metric: Accent;
  /** Una cifra por semana, la última en curso: km, m, segundos o km/h. `null`, velocidad sin salidas. */
  values: (number | null)[];
  /** Media de las 11 semanas completas, o `null` si aún no la hay. */
  mean: number | null;
  /** Lo que sueles llevar a estas alturas de la semana (solo sumas). */
  meanToDate: number | null;
};

export type WeeklyTrend = { labels: string[]; series: Record<Accent, TrendSeries> };

const NAME: Record<Accent, string> = {
  dist: 'Distancia',
  elev: 'Desnivel',
  time: 'Tiempo en movimiento',
  speed: 'Velocidad media',
};
/** Cabecera de la columna de la tabla. */
export const COLUMN: Record<Accent, string> = { dist: 'Distancia', elev: 'Desnivel', time: 'Tiempo', speed: 'Velocidad' };

export const isLine = (m: Accent) => m === 'speed';

type Sums = Pick<PeriodTotals, 'distanceM' | 'elevGainM' | 'movingTimeS'>;
const SUM_OF: Record<Exclude<Accent, 'speed'>, (w: Sums) => number> = {
  dist: (w) => w.distanceM / 1000,
  elev: (w) => w.elevGainM,
  time: (w) => w.movingTimeS,
};
const kmh = (w: Sums): number | null => (w.movingTimeS > 0 ? (w.distanceM / w.movingTimeS) * 3.6 : null);
const total = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

export function weeklyTrend(acts: StoredActivity[], now: number): WeeklyTrend {
  const from = subWeeks(startOfISOWeek(new TZDate(now, TZ)), DONE).getTime();
  // Con miles de salidas, solo las de estas 12 semanas pasan por la conversión de zona horaria.
  const recent = acts.filter((a) => a.startTime >= from && a.startTime <= now);
  const weeks = aggregate(recent, 'week', from, now);
  const done = weeks.slice(0, DONE);

  // A estas alturas: cada salida de una semana completa cuenta si empezó antes del mismo momento de
  // su semana. El corte se mide en ms desde el lunes, así que un cambio de hora lo mueve una hora.
  const elapsed = now - weeks[DONE].start;
  const toDate: Sums[] = done.map(() => ({ distanceM: 0, elevGainM: 0, movingTimeS: 0 }));
  for (const a of recent) {
    let k = DONE - 1;
    while (k >= 0 && weeks[k].start > a.startTime) k--;
    if (k < 0 || a.startTime - weeks[k].start > elapsed) continue;
    toDate[k].distanceM += a.totals.distanceM;
    toDate[k].elevGainM += a.totals.elevGainM;
    toDate[k].movingTimeS += a.totals.movingTimeS;
  }

  const hasMean = done.filter((w) => w.rides > 0).length >= MIN_WEEKS_WITH_RIDES;
  const sumSeries = (metric: Exclude<Accent, 'speed'>): TrendSeries => {
    const of = SUM_OF[metric];
    return {
      metric,
      values: weeks.map(of),
      mean: hasMean ? total(done.map(of)) / DONE || null : null,
      meanToDate: hasMean ? total(toDate.map(of)) / DONE || null : null,
    };
  };
  const doneTotals: Sums = {
    distanceM: total(done.map((w) => w.distanceM)),
    elevGainM: 0,
    movingTimeS: total(done.map((w) => w.movingTimeS)),
  };

  return {
    labels: weeks.map((w) => w.label),
    series: {
      dist: sumSeries('dist'),
      elev: sumSeries('elev'),
      time: sumSeries('time'),
      speed: { metric: 'speed', values: weeks.map(kmh), mean: hasMean ? kmh(doneTotals) : null, meanToDate: null },
    },
  };
}

/* ---------- Cifras ---------- */

/** Cifra completa: «104 km», «1542 m», «6 h 08 min», «27,1 km/h». */
export function trendValue(metric: Accent, v: number): string {
  if (metric === 'dist') return `${formatNumber(v)} km`;
  if (metric === 'elev') return `${formatCount(v)} m`;
  if (metric === 'time') return formatDuration(v);
  return `${formatNumber(v, 1)} km/h`;
}

/** Cifra corta, sin unidad, para la gráfica: «104», «6 h 08», «27,1». */
export function trendFigure(metric: Accent, v: number): string {
  if (metric === 'time') return formatDuration(v, 'short');
  return formatNumber(v, isLine(metric) ? 1 : 0);
}

/** La semana no tiene cifra: sin salidas (suma 0) o sin velocidad. */
export const isEmptyWeek = (v: number | null): v is null | 0 => v === null || !(v > 0);

const pct = (v: number, ref: number) => Math.round((v / ref - 1) * 100);

/** Referencia de la semana en curso: a estas alturas para las sumas; la media para la velocidad. */
const refNow = (s: TrendSeries) => (isLine(s.metric) ? s.mean : s.meanToDate);

/* ---------- Lectura de la semana elegida ---------- */

/** Trozo de la frase: texto (en negrita si `b`) o la marca «a estas alturas» de la gráfica. */
export type ReadPart = { t: string; b?: boolean } | { key: true };

export function trendReadout(s: TrendSeries, sel: number, labels: string[]): ReadPart[] {
  const v = s.values[sel];
  const now = sel === DONE;
  const parts: ReadPart[] = now
    ? [{ t: 'Esta semana', b: true }, { t: ', en curso: ' }]
    : [{ t: `Semana del ${labels[sel]}`, b: true }, { t: ': ' }];
  const toDate = now && !isLine(s.metric) ? s.meanToDate : null;

  if (isEmptyWeek(v)) {
    if (toDate !== null)
      return [...parts, { t: 'aún sin salidas. ' }, { key: true }, { t: `A estas alturas sueles llevar ${trendValue(s.metric, toDate)}.` }];
    return [...parts, { t: 'sin salidas.' }];
  }
  parts.push({ t: trendValue(s.metric, v), b: true });
  if (s.mean === null) return [...parts, { t: `. ${NO_MEAN}` }];
  if (toDate !== null)
    return [
      ...parts,
      { t: '. ' },
      { key: true },
      { t: `A estas alturas sueles llevar ${trendValue(s.metric, toDate)}; la semana completa, ${trendValue(s.metric, s.mean)}.` },
    ];
  const p = pct(v, s.mean);
  const vs = p === 0 ? 'igual que tu media' : `un ${formatNumber(Math.abs(p))} % ${p > 0 ? 'más' : 'menos'} que tu media`;
  return [...parts, { t: `, ${vs}${now ? ` de ${trendValue(s.metric, s.mean)}` : ''}.` }];
}

/* ---------- Texto alternativo, título de la tabla y filas ---------- */

export function trendAriaLabel(s: TrendSeries): string {
  const head = `${NAME[s.metric]} por semana en las últimas ${TREND_WEEKS} semanas: `;
  const vs = s.values.filter((v): v is number => !isEmptyWeek(v));
  const mean = s.mean === null ? NO_MEAN : `Tu media, ${trendValue(s.metric, s.mean)}.`;
  if (vs.length === 0) return `${head}sin salidas. ${mean}`;
  const all = isLine(s.metric) ? vs : s.values.map((v) => v ?? 0);
  const range = `entre ${trendValue(s.metric, Math.min(...all))} y ${trendValue(s.metric, Math.max(...all))}`;
  const v = s.values[DONE];
  const week = isEmptyWeek(v) ? 'Esta semana, aún sin salidas' : `Esta semana, aún en curso, ${trendValue(s.metric, v)}`;
  const toDate = !isLine(s.metric) && s.meanToDate !== null ? `; a estas alturas sueles llevar ${trendValue(s.metric, s.meanToDate)}` : '';
  return `${head}${range}. ${mean} ${week}${toDate}. Los datos están en la tabla.`;
}

export function trendCaption(s: TrendSeries): string {
  const head = `${NAME[s.metric]} por semana, de lunes a domingo. `;
  if (s.mean === null) return head + NO_MEAN;
  const toDate =
    !isLine(s.metric) && s.meanToDate !== null
      ? ` La semana en curso se compara con tus semanas a estas alturas: ${trendValue(s.metric, s.meanToDate)}.`
      : '';
  return `${head}La media es la de las 11 semanas completas: ${trendValue(s.metric, s.mean)}.${toDate}`;
}

export type TrendRow = { week: string; value: string; diff: string; note: string | null; now: boolean };

/** Filas de la tabla, de la semana en curso a la más antigua. */
export function trendTable(s: TrendSeries, labels: string[]): TrendRow[] {
  const ref = refNow(s);
  return s.values
    .map((v, i) => {
      const now = i === DONE;
      const base = now ? ref : s.mean;
      const skip = v === null || (now && isEmptyWeek(v)) || base === null;
      return {
        week: now ? `${labels[i]} (en curso)` : labels[i],
        value: v === null ? '—' : trendValue(s.metric, v),
        diff: skip ? '—' : formatDeltaPct(pct(v, base)),
        note: now && !isLine(s.metric) && ref !== null ? `a estas alturas: ${trendValue(s.metric, ref)}` : null,
        now,
      };
    })
    .reverse();
}

/* ---------- Escala: paso «agradable» 1-2-2,5-5 × 10^n, 4 intervalos como mucho ---------- */

export type TrendScale = { lo: number; hi: number; step: number; ticks: number[] };

function niceSteps(from: number): number[] {
  const out: number[] = [];
  let e = Math.floor(Math.log10(from)) - 1;
  for (let k = 0; k < 6; k++, e++) for (const c of [1, 2, 2.5, 5]) out.push(c * 10 ** e);
  return out;
}

const HOUR = 3600;
/** Valores vacíos por defecto: el eje sale igual, sin datos encima. */
const EMPTY_MAX: Record<Accent, number> = { dist: 50, elev: 500, time: HOUR, speed: 25 };

export function trendScale(values: (number | null)[], mean: number | null, metric: Accent): TrendScale {
  const vs = values.filter((v): v is number => v !== null);
  if (mean !== null) vs.push(mean);
  let lo = 0;
  let hi = 1;
  let step = 1;
  if (!isLine(metric)) {
    let max = Math.max(0, ...vs);
    if (max <= 0) max = EMPTY_MAX[metric];
    // El tiempo se rotula en horas enteras.
    const cands = metric === 'time' ? [1, 2, 3, 4, 5, 10, 20, 25, 50, 100].map((h) => h * HOUR) : niceSteps(max / 4);
    for (const c of cands) {
      step = c;
      hi = Math.ceil(max / step) * step;
      if (hi - max < step * 0.18) hi += step; // aire para la cifra encima de la barra
      if (hi / step <= 4) break;
    }
  } else {
    if (vs.length === 0) vs.push(EMPTY_MAX[metric]);
    const mid = (Math.max(...vs) + Math.min(...vs)) / 2;
    const max = Math.max(...vs, mid + 1); // nunca menos de 2 km/h de rango
    const min = Math.min(...vs, mid - 1);
    for (const c of niceSteps((max - min) / 4)) {
      step = c;
      lo = Math.floor(min / step) * step;
      hi = Math.ceil(max / step) * step;
      if (hi - max < step * 0.3) hi += step;
      if ((hi - lo) / step <= 4) break;
    }
  }
  const ticks: number[] = [];
  for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(Number(t.toFixed(4)));
  return { lo, hi, step, ticks };
}

/** Rótulo del eje Y: «200», «9 h», «27,5». */
export function trendTick(metric: Accent, v: number, step: number): string {
  if (metric === 'time') return `${formatNumber(v / HOUR)} h`;
  return formatNumber(v, isLine(metric) && step < 1 ? 1 : 0);
}
