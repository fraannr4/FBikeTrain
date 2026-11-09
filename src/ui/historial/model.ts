import { TZDate } from '@date-fns/tz';
import { addMonths, differenceInCalendarDays, format, getDaysInMonth, startOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import type { StoredActivity } from '../../domain/types';
import { TZ } from '../../metrics/aggregate';
import { difficulty, type Difficulty, type UserReference } from '../../metrics/reference';

export type SortKey = 'fecha' | 'km' | 'm' | 'kmh';
export type DistKey = 'all' | 'lt50' | '50-90' | 'gt90';

export type Filters = {
  /** Búsqueda ya normalizada (sin tildes ni mayúsculas). */
  qn: string;
  sort: SortKey;
  year: number | null;
  dist: DistKey;
  dif: Difficulty[];
  rep: boolean;
};

/** Salida con lo que la lista necesita ya calculado: se hace una vez por carga, no por tecla. */
export type RideItem = {
  act: StoredActivity;
  name: string;
  norm: string;
  speedMs: number;
  level: Difficulty | null;
  year: number;
  /** Inicio del mes en Madrid (epoch ms): la clave del grupo. */
  month: number;
  /** Día del mes en Madrid. */
  day: number;
};

export type MonthGroup = { month: number; items: RideItem[] };

export const UNTITLED = 'Salida sin nombre';
/** Meses anteriores con los que se hace la media mensual, y mínimo para que haya comparación. */
export const AVG_MONTHS = 12;
export const AVG_MIN_MONTHS = 3;
/** Kilómetros de un día que llenan la barra de la tira de días. */
export const DAY_FULL_M = 110_000;

const DIACRITICS = /[̀-ͯ]/g;

/** Para buscar: sin tildes ni mayúsculas. */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(DIACRITICS, '').toLowerCase();
}

const speedOf = (a: StoredActivity) =>
  a.totals.avgSpeedMs || (a.totals.movingTimeS > 0 ? a.totals.distanceM / a.totals.movingTimeS : 0);

// Año, mes y día en Madrid con un solo formateador: crear un TZDate por salida costaba medio segundo
// con 5.000 salidas. El inicio de cada mes (epoch ms) se calcula una vez por mes.
const MADRID_YMD = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric' });
const monthStarts = new Map<number, number>();

function madridYmd(t: number): { year: number; month: number; day: number } {
  let year = 0;
  let month = 0;
  let day = 0;
  for (const p of MADRID_YMD.formatToParts(t)) {
    if (p.type === 'year') year = Number(p.value);
    else if (p.type === 'month') month = Number(p.value);
    else if (p.type === 'day') day = Number(p.value);
  }
  return { year, month, day };
}

function monthStart(year: number, month: number): number {
  const k = year * 12 + month;
  let start = monthStarts.get(k);
  if (start === undefined) {
    start = new TZDate(year, month - 1, 1, TZ).getTime();
    monthStarts.set(k, start);
  }
  return start;
}

export function toItems(acts: StoredActivity[], ref: UserReference | null): RideItem[] {
  return acts.map((act) => {
    const { year, month, day } = madridYmd(act.startTime);
    const name = act.name?.trim() || UNTITLED;
    return {
      act,
      name,
      norm: normalize(name),
      speedMs: speedOf(act),
      level: ref ? difficulty({ distanceM: act.totals.distanceM, elevGainM: act.totals.elevGainM }, ref) : null,
      year,
      month: monthStart(year, month),
      day,
    };
  });
}

export type MonthTotals = { start: number; distanceM: number; elevGainM: number; movingTimeS: number; rides: number };

/**
 * Totales de cada mes, seguidos y sin huecos (los meses vacíos, a 0), del mes de la salida más antigua
 * al de `now`. Es `aggregate(acts, 'month', …)` sobre las claves de mes que ya tienen las salidas.
 */
export function monthTotals(items: RideItem[], now: number): MonthTotals[] {
  if (items.length === 0) return [];
  const by = new Map<number, MonthTotals>();
  let first = Infinity;
  let last = -Infinity;
  for (const r of items) {
    let m = by.get(r.month);
    if (!m) {
      m = { start: r.month, distanceM: 0, elevGainM: 0, movingTimeS: 0, rides: 0 };
      by.set(r.month, m);
    }
    m.distanceM += r.act.totals.distanceM;
    m.elevGainM += r.act.totals.elevGainM;
    m.movingTimeS += r.act.totals.movingTimeS;
    m.rides += 1;
    first = Math.min(first, r.month);
    last = Math.max(last, r.month);
  }
  const end = Math.max(last, startOfMonth(new TZDate(now, TZ)).getTime());
  const out: MonthTotals[] = [];
  for (let d = new TZDate(first, TZ); d.getTime() <= end; d = addMonths(d, 1)) {
    const start = d.getTime();
    out.push(by.get(start) ?? { start, distanceM: 0, elevGainM: 0, movingTimeS: 0, rides: 0 });
  }
  return out;
}

function inDist(m: number, dist: DistKey): boolean {
  if (dist === 'lt50') return m < 50_000;
  if (dist === '50-90') return m >= 50_000 && m <= 90_000;
  if (dist === 'gt90') return m > 90_000;
  return true;
}

const SORT_VALUE: Record<SortKey, (r: RideItem) => number> = {
  fecha: (r) => r.act.startTime,
  km: (r) => r.act.totals.distanceM,
  m: (r) => r.act.totals.elevGainM,
  kmh: (r) => r.speedMs,
};

/** Filtra y ordena de mayor a menor (la fecha, de la más reciente a la más antigua). */
export function applyFilters(items: RideItem[], f: Filters, repeated: ReadonlySet<string>): RideItem[] {
  const out = items.filter(
    (r) =>
      (f.year === null || r.year === f.year) &&
      (!f.qn || r.norm.includes(f.qn)) &&
      inDist(r.act.totals.distanceM, f.dist) &&
      (f.dif.length === 0 || (r.level !== null && f.dif.includes(r.level))) &&
      (!f.rep || repeated.has(r.act.id)),
  );
  const v = SORT_VALUE[f.sort];
  return out.sort((a, b) => v(b) - v(a) || b.act.startTime - a.act.startTime);
}

/** Agrupa por mes conservando el orden (las salidas ya vienen por fecha descendente). */
export function groupByMonth(items: RideItem[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const r of items) {
    const last = groups[groups.length - 1];
    if (last && last.month === r.month) last.items.push(r);
    else groups.push({ month: r.month, items: [r] });
  }
  return groups;
}

/**
 * Media de km de los `AVG_MONTHS` meses anteriores a cada mes, contando los meses vacíos y solo desde
 * el primer mes con salidas. Con menos de `AVG_MIN_MONTHS` meses detrás, el mes no tiene media.
 * `months` son los totales mensuales seguidos (los de `monthTotals`), del más antiguo al más reciente.
 */
export function monthlyAverages(months: MonthTotals[]): Map<number, number> {
  const out = new Map<number, number>();
  for (let i = 0; i < months.length; i++) {
    const prev = months.slice(Math.max(0, i - AVG_MONTHS), i);
    if (prev.length < AVG_MIN_MONTHS) continue;
    out.set(months[i].start, prev.reduce((s, p) => s + p.distanceM, 0) / prev.length);
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «Noviembre», o «Diciembre de 2025» si no es de este año. */
export function monthName(month: number, now: number): string {
  const d = new TZDate(month, TZ);
  const name = cap(format(d, 'LLLL', { locale: es }));
  return d.getFullYear() === new TZDate(now, TZ).getFullYear() ? name : `${name} de ${d.getFullYear()}`;
}

export function isCurrentMonth(month: number, now: number): boolean {
  return startOfMonth(new TZDate(now, TZ)).getTime() === month;
}

export function daysInMonth(month: number): number {
  return getDaysInMonth(new TZDate(month, TZ));
}

export function dayOfMonth(now: number): number {
  return new TZDate(now, TZ).getDate();
}

/** «dom 4 ene 2026», en Madrid. */
export function fullDate(t: number): string {
  return format(new TZDate(t, TZ), 'EEE d MMM yyyy', { locale: es });
}

/** «jueves 5». */
export function weekdayDay(t: number): string {
  return format(new TZDate(t, TZ), 'EEEE d', { locale: es });
}

/**
 * Cuándo, en la fila: «Hoy», «Ayer» o «Martes 3» dentro de su mes; en la lista sin meses (ordenada
 * por otra cosa), «5 nov», con el año si no es este.
 */
export function whenLabel(t: number, now: number, flat: boolean): string {
  const d = new TZDate(t, TZ);
  const today = new TZDate(now, TZ);
  const diff = differenceInCalendarDays(today, d);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (flat) return format(d, d.getFullYear() === today.getFullYear() ? 'd MMM' : 'd MMM yyyy', { locale: es });
  return cap(format(d, 'EEEE d', { locale: es }));
}

/** «4 de enero de 2026». */
export function longDate(t: number): string {
  return format(new TZDate(t, TZ), "d 'de' MMMM 'de' yyyy", { locale: es });
}

/** Km de cada día del mes (índice 0 = día 1). */
export function kmByDay(items: RideItem[], days: number): number[] {
  const out = new Array<number>(days).fill(0);
  for (const r of items) out[r.day - 1] += r.act.totals.distanceM;
  return out;
}

export type Highlight = { lead: string; before: string; hit: string; after: string };

/**
 * Trozo encontrado de `name` para resaltarlo. Se compara sin tildes ni mayúsculas y el rango se lleva
 * al nombre original carácter a carácter. Si lo encontrado queda lejos del principio, el texto empieza
 * poco antes (`lead` = «…»): con el nombre cortado a dos líneas, si no, quedaría oculto.
 */
export function highlight(name: string, qn: string): Highlight | null {
  if (!qn) return null;
  let nn = '';
  const map: number[] = [];
  for (let i = 0; i < name.length; ) {
    const ch = String.fromCodePoint(name.codePointAt(i) ?? 0);
    const n = normalize(ch);
    for (let k = 0; k < n.length; k++) map.push(i);
    nn += n;
    i += ch.length;
  }
  map.push(name.length);
  const at = nn.indexOf(qn);
  if (at < 0) return null;
  const a = map[at];
  const b = map[at + qn.length];
  let from = 0;
  if (a > 40) {
    const sp = name.lastIndexOf(' ', a - 2);
    from = sp > 0 ? name.lastIndexOf(' ', sp - 1) + 1 : a;
    if (a - from > 24) from = sp + 1;
  }
  return { lead: from ? '…' : '', before: name.slice(from, a), hit: name.slice(a, b), after: name.slice(b) };
}
