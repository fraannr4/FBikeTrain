import type { LocalDate } from '../domain/types';

// Aritmética de días de calendario (`yyyy-MM-dd`) en UTC: no depende del huso del navegador ni
// del cambio de hora. Qué día es «hoy» en Madrid lo dice `localDay` de `metrics/calendar`.

const DAY_MS = 86_400_000;
const DOW = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const DOW_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const DOW_INITIAL = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const MONTHS_SHORT = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.'];

const toUtc = (d: LocalDate): number => Date.parse(`${d}T00:00:00Z`);
const fromUtc = (t: number): LocalDate => new Date(t).toISOString().slice(0, 10);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function addDays(d: LocalDate, n: number): LocalDate {
  return fromUtc(toUtc(d) + n * DAY_MS);
}

/** `a − b` en días. */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return Math.round((toUtc(a) - toUtc(b)) / DAY_MS);
}

/** Día de la semana: 0 lunes … 6 domingo. */
export function weekdayOf(d: LocalDate): number {
  return (new Date(toUtc(d)).getUTCDay() + 6) % 7;
}

export function mondayOf(d: LocalDate): LocalDate {
  return addDays(d, -weekdayOf(d));
}

const dayOfMonth = (d: LocalDate): number => Number(d.slice(8, 10));
const monthIndex = (d: LocalDate): number => Number(d.slice(5, 7)) - 1;

/** Las semanas, de lunes a domingo, que cubren el mes `yyyy-MM`. */
export function monthGrid(month: string): LocalDate[][] {
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const last = fromUtc(Date.UTC(y, m, 0));
  const weeks: LocalDate[][] = [];
  for (let monday = mondayOf(first); monday <= last; monday = addDays(monday, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(monday, i)));
  }
  return weeks;
}

/** «Domingo 15 de noviembre». */
export function longDate(d: LocalDate): string {
  return `${cap(DOW[weekdayOf(d)])} ${dayOfMonth(d)} de ${MONTHS[monthIndex(d)]}`;
}

/** «Hoy, viernes 6», «Mañana, sábado 7», «Ayer, jueves 5» o la fecha larga. */
export function relativeDayName(d: LocalDate, today: LocalDate): string {
  const n = diffDays(d, today);
  const short = `${DOW[weekdayOf(d)]} ${dayOfMonth(d)}`;
  if (n === 0) return `Hoy, ${short}`;
  if (n === 1) return `Mañana, ${short}`;
  if (n === -1) return `Ayer, ${short}`;
  return longDate(d);
}

/** «hoy», «mañana» o «el domingo 8». */
export function whenLabel(d: LocalDate, today: LocalDate): string {
  const n = diffDays(d, today);
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  return `el ${DOW[weekdayOf(d)]} ${dayOfMonth(d)}`;
}

/** Semana que empieza el lunes `monday`: «2–8 de noviembre» o «26 oct. – 1 nov.». */
export function weekRangeLabel(monday: LocalDate): string {
  const sunday = addDays(monday, 6);
  if (monthIndex(monday) === monthIndex(sunday)) {
    return `${dayOfMonth(monday)}–${dayOfMonth(sunday)} de ${MONTHS[monthIndex(sunday)]}`;
  }
  return `${dayOfMonth(monday)} ${MONTHS_SHORT[monthIndex(monday)]} – ${dayOfMonth(sunday)} ${MONTHS_SHORT[monthIndex(sunday)]}`;
}

/** «Noviembre de 2026» para `2026-11`. */
export function monthLabel(month: string): string {
  return `${cap(MONTHS[Number(month.slice(5, 7)) - 1])} de ${month.slice(0, 4)}`;
}

/** Mes `yyyy-MM` desplazado `n` meses. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return fromUtc(Date.UTC(y, m - 1 + n, 1)).slice(0, 7);
}

export const dayNumber = dayOfMonth;
export const weekdayInitial = (d: LocalDate): string => DOW_INITIAL[weekdayOf(d)];
export const weekdayShort = (d: LocalDate): string => DOW_SHORT[weekdayOf(d)];
export const WEEKDAY_INITIALS = DOW_INITIAL;
