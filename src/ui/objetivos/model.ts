import type { EventGoal, Goal, LocalDate, PlannedWorkout, StoredActivity, VolumeGoal } from '../../domain/types';
import { aggregate } from '../../metrics/aggregate';
import { goalProgress, periodRange, periodStartOf, volumeProgress, type VolumeKey } from '../../metrics/calendar';
import { addDays, addMonths, longDate } from '../calendarGrid';
import { formatCount, formatDuration } from '../format';

// Modelo de la vista Objetivos (docs/design/prototipo-movil/objetivos.html): qué objetivo va en
// cada hueco y cómo se escriben sus cifras. Funciones puras; el progreso lo calcula metrics/calendar.

export type Slot = 'week' | 'month';
/** Espacio fino que no parte: entre la cifra y su unidad («140 km»). */
export const NNBSP = ' ';

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const monthName = (d: LocalDate): string => MONTHS[Number(d.slice(5, 7)) - 1];
const dayOf = (d: LocalDate): number => Number(d.slice(8, 10));
const yearSfx = (d: LocalDate, today: LocalDate): string => (d.slice(0, 4) !== today.slice(0, 4) ? ` de ${d.slice(0, 4)}` : '');

/** Último día del periodo que empieza en `start`. */
export function periodEnd(g: Pick<VolumeGoal, 'period' | 'start'>): LocalDate {
  return g.period === 'week' ? addDays(g.start, 6) : addDays(`${addMonths(g.start.slice(0, 7), 1)}-01`, -1);
}

/** Último día de un objetivo: la fecha del evento o el fin del periodo. */
export const goalEnd = (g: Goal): LocalDate => (g.kind === 'event' ? g.date : periodEnd(g));

/** «Esta semana», «Semana del 30 de noviembre», «Noviembre» o «Enero de 2027». */
export function periodTitle(g: Pick<VolumeGoal, 'period' | 'start'>, today: LocalDate): string {
  if (g.period === 'week') {
    if (g.start === periodStartOf('week', today)) return 'Esta semana';
    return `Semana del ${dayOf(g.start)} de ${monthName(g.start)}${yearSfx(g.start, today)}`;
  }
  return cap(monthName(g.start)) + yearSfx(g.start, today);
}

/** Título que se guarda con un objetivo de volumen: «Noviembre de 2026», «Semana del 30 de noviembre de 2026». */
export function volumeTitle(period: Slot, start: LocalDate): string {
  return period === 'week'
    ? `Semana del ${dayOf(start)} de ${monthName(start)} de ${start.slice(0, 4)}`
    : `${cap(monthName(start))} de ${start.slice(0, 4)}`;
}

/** «Del 2 al 8 de noviembre» o «Del 30 de noviembre al 6 de diciembre». */
export function weekSpan(start: LocalDate): string {
  const end = addDays(start, 6);
  const sameMonth = start.slice(5, 7) === end.slice(5, 7);
  return sameMonth
    ? `Del ${dayOf(start)} al ${dayOf(end)} de ${monthName(end)}`
    : `Del ${dayOf(start)} de ${monthName(start)} al ${dayOf(end)} de ${monthName(end)}`;
}

/** «Domingo 13 de diciembre», con «de 2027» si no es este año. */
export const eventDate = (d: LocalDate, today: LocalDate): string => longDate(d) + yearSfx(d, today);

/* ---------------------------------------------------------------- Cifras */

export type Metric = { key: VolumeKey; name: string; accent: 'dist' | 'elev' | 'time' };
export const METRICS: Record<VolumeKey, Metric> = {
  distanceM: { key: 'distanceM', name: 'Distancia', accent: 'dist' },
  elevGainM: { key: 'elevGainM', name: 'Desnivel', accent: 'elev' },
  movingTimeS: { key: 'movingTimeS', name: 'Tiempo', accent: 'time' },
};

/** Solo la cifra: «312» km, «2722» m, «6 h 08» de tiempo. */
export function figure(key: VolumeKey, v: number): string {
  if (key === 'distanceM') return formatCount(v / 1000);
  if (key === 'elevGainM') return formatCount(v);
  return formatDuration(v, 'short');
}

/** Unidad que acompaña a `figure` («km», «m»); el tiempo ya la lleva. */
export const unit = (key: VolumeKey): string => (key === 'distanceM' ? 'km' : key === 'elevGainM' ? 'm' : '');

/** Cifra con unidad: «312 km», «2722 m», «6 h 08 min». */
export function full(key: VolumeKey, v: number): string {
  if (key === 'movingTimeS') return formatDuration(v).replace(/ /g, NNBSP);
  return `${figure(key, v)}${NNBSP}${unit(key)}`;
}

/** «312 de 400 km», «6 h 08 min de 7 h». */
export function ofTarget(key: VolumeKey, v: number, target: number): string {
  return key === 'movingTimeS' ? `${full(key, v)} de ${full(key, target)}` : `${figure(key, v)} de ${full(key, target)}`;
}

/** «250 km, 3500 m y 7 h». */
export function listAnd(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

export function targetsText(g: VolumeGoal): string {
  const keys: VolumeKey[] = ['distanceM', 'elevGainM', 'movingTimeS'];
  return listAnd(keys.flatMap((k) => (g[k] ? [full(k, g[k] as number)] : [])));
}

export const pctText = (p: number): string => formatCount(Number.isFinite(p) ? p : 0);

export function plural(n: number, one: string, other: string): string {
  return n === 1 ? one : other;
}

/* ---------------------------------------------------------------- Huecos */

export type Arrangement = {
  /** Objetivos de la semana y del mes en curso. */
  week?: VolumeGoal;
  month?: VolumeGoal;
  /** Volúmenes de periodos que aún no han empezado, por fecha. */
  future: VolumeGoal[];
  /** El evento más cercano que no ha pasado o, si no hay, el último que pasó. */
  event?: EventGoal;
  /** Lo terminado (salvo `event`), del más reciente al más antiguo. */
  past: Goal[];
};

const newest = <T extends Goal>(a: T | undefined, b: T): T => (!a || b.createdAt > a.createdAt ? b : a);

/** Reparte los objetivos en sus huecos según `today`. */
export function arrange(goals: Goal[], today: LocalDate): Arrangement {
  const out: Arrangement = { future: [], past: [] };
  let nextEvent: EventGoal | undefined;
  let lastEvent: EventGoal | undefined;
  for (const g of goals) {
    if (g.kind === 'event') {
      if (g.date >= today) {
        if (!nextEvent || g.date < nextEvent.date || (g.date === nextEvent.date && g.createdAt > nextEvent.createdAt)) nextEvent = g;
      } else {
        if (!lastEvent || g.date > lastEvent.date) lastEvent = g;
        out.past.push(g);
      }
      continue;
    }
    if (g.start > today) out.future.push(g);
    else if (periodEnd(g) < today) out.past.push(g);
    else out[g.period] = newest(out[g.period], g);
  }
  out.event = nextEvent ?? lastEvent;
  out.past = out.past.filter((g) => g !== out.event).sort((a, b) => goalEnd(b).localeCompare(goalEnd(a)));
  out.future.sort((a, b) => a.start.localeCompare(b.start) || a.period.localeCompare(b.period));
  return out;
}

/** Objetivo que ya ocupa el hueco al que iría uno nuevo (y que este sustituye), salvo `editing`. */
export function takenBy(
  goals: Goal[],
  slot: { kind: 'event' } | { kind: 'volume'; period: Slot; start: LocalDate },
  today: LocalDate,
  editingId?: string,
): Goal | undefined {
  return goals.find((g) => {
    if (g.id === editingId || g.kind !== slot.kind) return false;
    if (g.kind === 'event') return g.date >= today;
    return slot.kind === 'volume' && g.period === slot.period && g.start === slot.start;
  });
}

/** Distancia o desnivel de los entrenos pendientes entre `from` y `to`, ambos incluidos. */
export function plannedSum(workouts: PlannedWorkout[], key: 'distanceM' | 'elevGainM', from: LocalDate, to: LocalDate): number {
  let sum = 0;
  for (const w of workouts) if (!w.done && w.date >= from && w.date <= to) sum += w[key] ?? 0;
  return sum;
}

/** Entrenos pendientes desde hoy hasta el día del evento, sin contarlo. */
export function plannedUntil(workouts: PlannedWorkout[], today: LocalDate, date: LocalDate): number {
  return workouts.filter((w) => !w.done && w.date >= today && w.date < date).length;
}

export type Average = { distanceM: number; elevGainM: number; movingTimeS: number };

/**
 * Tu semana media (12 semanas completas) y tu mes medio (6 meses completos), con los periodos sin
 * salidas incluidos. `undefined` si no hubo salidas en ese tramo.
 */
export function averages(acts: StoredActivity[], today: LocalDate): { week?: Average; month?: Average } {
  const mean = (period: Slot, n: number): Average | undefined => {
    const current = periodStartOf(period, today);
    const first = period === 'week' ? addDays(current, -7 * n) : `${addMonths(current.slice(0, 7), -n)}-01`;
    const { from } = periodRange(period, first);
    const to = periodRange(period, current).from - 1;
    const rows = aggregate(acts, period, from, to);
    const sum = rows.reduce(
      (s, r) => ({ distanceM: s.distanceM + r.distanceM, elevGainM: s.elevGainM + r.elevGainM, movingTimeS: s.movingTimeS + r.movingTimeS }),
      { distanceM: 0, elevGainM: 0, movingTimeS: 0 },
    );
    if (sum.distanceM <= 0) return undefined;
    return { distanceM: sum.distanceM / n, elevGainM: sum.elevGainM / n, movingTimeS: sum.movingTimeS / n };
  };
  return { week: mean('week', 12), month: mean('month', 6) };
}

export type PastRow = { id: string; kind: Slot | 'event'; title: string; meta: string; pct: number; ok: boolean };

/** Fila de «Anteriores»: la primera meta frente a lo hecho («812 de 800 km, conseguido»). */
export function pastRow(g: Goal, acts: StoredActivity[], now: number, today: LocalDate): PastRow {
  if (g.kind === 'event') {
    const p = goalProgress(g, acts, now);
    const when = `${dayOf(g.date)} de ${monthName(g.date)}${yearSfx(g.date, today)}`;
    const best = g.distanceM
      ? p.longest && { pct: p.longest.pct, text: ofTarget('distanceM', p.longest.distanceM, g.distanceM) }
      : p.mostClimb && g.elevGainM && { pct: p.mostClimb.pct, text: ofTarget('elevGainM', p.mostClimb.elevGainM, g.elevGainM) };
    const pct = best ? best.pct : 0;
    const ok = pct >= 100;
    return {
      id: g.id,
      kind: 'event',
      title: g.title,
      meta: `${when} · ${best ? best.text : 'sin salidas antes'}${ok ? ', conseguido' : ''}`,
      pct,
      ok,
    };
  }
  const t = volumeProgress(g, acts, now).targets[0];
  const ok = !!t && t.pct >= 100;
  return {
    id: g.id,
    kind: g.period,
    title: periodTitle(g, today),
    meta: t ? `${ofTarget(t.key, t.value, t.target)}${ok ? ', conseguido' : ''}` : '',
    pct: t ? t.pct : 0,
    ok,
  };
}
