/**
 * Lo que Inicio enseña del Plan y de la semana (prototipo móvil, inicio.html e inicio.js):
 * qué objetivos y entrenos tocan hoy, la ficha de fecha, la frase del saludo y las diferencias de
 * las cifras de la semana frente a tus semanas a estas alturas. Solo elige y redacta: el cálculo
 * vive en `metrics/calendar` y en `trend`.
 */
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { EventGoal, Goal, LocalDate, PlannedWorkout, VolumeGoal } from '../../domain/types';
import { TZ } from '../../metrics/aggregate';
import { daysUntil, localDay, periodStartOf, type VolumeKey, type VolumeProgress } from '../../metrics/calendar';
import type { Accent } from '../accent';
import { formatCount, formatDuration, formatNumber } from '../format';
import { NO_MEAN, type WeeklyTrend } from './trend';

/** Medianoche de Madrid del día `d`. */
function parseLocal(d: LocalDate): TZDate {
  const [y, m, day] = d.split('-').map(Number);
  return new TZDate(y, m - 1, day, TZ);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- Qué toca ---------- */

/**
 * El evento más cercano que no ha pasado y los objetivos de volumen cuyo periodo contiene hoy en
 * Madrid: uno mensual y uno semanal como mucho (de varios, el creado más tarde), el mes primero.
 */
export function pickGoals(goals: Goal[], now: number): { event: EventGoal | null; volume: VolumeGoal[] } {
  const today = localDay(now);
  let event: EventGoal | null = null;
  const byPeriod: Partial<Record<VolumeGoal['period'], VolumeGoal>> = {};
  for (const g of goals) {
    if (g.kind === 'event') {
      if (g.date >= today && (!event || g.date < event.date)) event = g;
    } else if (periodStartOf(g.period, today) === g.start) {
      const prev = byPeriod[g.period];
      if (!prev || g.createdAt > prev.createdAt) byPeriod[g.period] = g;
    }
  }
  return { event, volume: [byPeriod.month, byPeriod.week].filter((g): g is VolumeGoal => g !== undefined) };
}

/** Los `n` próximos entrenos pendientes, de hoy en adelante, por fecha. */
export function pickUpcoming(workouts: PlannedWorkout[], now: number, n = 2): PlannedWorkout[] {
  const today = localDay(now);
  return workouts
    .filter((w) => !w.done && w.date >= today)
    .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1))
    .slice(0, n);
}

/* ---------- Fechas ---------- */

export type DayMark = {
  /** Banda del hito: «sáb». */
  weekday: string;
  /** Número dorsal: «7». */
  day: string;
  /** Bajo el número: «hoy», «mañana» o el mes («nov»). */
  under: string;
  /** Lo que oye el lector de pantalla: «Mañana, sábado 7 de noviembre». */
  spoken: string;
  near: 'Hoy' | 'Mañana' | null;
};

/** Ficha de fecha del próximo entreno («sáb / 7 / mañana»): el mes sobra si es hoy o mañana. */
export function dayMark(date: LocalDate, now: number): DayMark {
  const d = parseLocal(date);
  const days = daysUntil(date, now);
  const near = days === 0 ? 'Hoy' : days === 1 ? 'Mañana' : null;
  const long = format(d, "EEEE d 'de' MMMM", { locale: es });
  return {
    weekday: format(d, 'EEE', { locale: es }).replace('.', ''),
    day: String(d.getDate()),
    under: near ? near.toLowerCase() : format(d, 'MMM', { locale: es }).replace('.', ''),
    spoken: near ? `${near}, ${long}` : cap(long),
    near,
  };
}

/**
 * El entreno siguiente, en una línea: «Y el domingo 8: Rodaje suave a Tona, 50 km.». En trozos, para
 * aislar el nombre (`<bdi>`): un nombre en árabe o hebreo no arrastra la distancia al otro lado.
 */
export function followUp(w: PlannedWorkout, now: number): { when: string; title: string; km: string } {
  const days = daysUntil(w.date, now);
  const when =
    days === 0 ? 'Y hoy' : days === 1 ? 'Y mañana' : `Y el ${format(parseLocal(w.date), 'EEEE d', { locale: es })}`;
  const km = w.distanceM ? `, ${formatNumber(w.distanceM / 1000)} km` : '';
  return { when, title: w.title, km };
}

/** «13 de diciembre, faltan 37 días», «Mañana, 7 de noviembre». */
export function eventWhen(goal: EventGoal, now: number): string {
  const date = format(parseLocal(goal.date), "d 'de' MMMM", { locale: es });
  const days = daysUntil(goal.date, now);
  if (days === 0) return `Hoy, ${date}`;
  if (days === 1) return `Mañana, ${date}`;
  return `${date}, faltan ${formatCount(days)} días`;
}

/* ---------- Objetivo de volumen ---------- */

export type VolumeGlance = {
  title: string;
  /** Mes en minúscula («noviembre») o `null` en un objetivo semanal: para el saludo. */
  month: string | null;
  done: string;
  of: string;
  value: number;
  pace: number;
  dir: 'up' | 'down' | 'flat';
  /** «41 km», vacío si vas al ritmo. */
  diff: string;
  word: string;
  left: string;
  label: string;
};

function amount(key: VolumeKey, v: number): string {
  if (key === 'distanceM') return formatNumber(v / 1000);
  if (key === 'elevGainM') return formatCount(v);
  return formatDuration(v, 'short');
}
const UNIT: Record<VolumeKey, string> = { distanceM: 'km', elevGainM: 'm', movingTimeS: '' };

function withUnit(key: VolumeKey, v: number): string {
  if (key === 'movingTimeS') return v % 3600 === 0 ? `${formatCount(v / 3600)} h` : formatDuration(v);
  return `${amount(key, v)} ${UNIT[key]}`;
}

/**
 * El medidor compacto de un objetivo de volumen, con su primera meta (distancia, desnivel o tiempo):
 * lo hecho, la muesca del ritmo esperado y la diferencia en unidades, no en puntos. A menos del 1 %
 * del objetivo, vas al ritmo.
 */
export function volumeGlance(goal: VolumeGoal, p: VolumeProgress): VolumeGlance {
  const t = p.targets[0];
  const month = goal.period === 'month' ? format(parseLocal(goal.start), 'MMMM', { locale: es }) : null;
  const raw = t ? t.value - t.expected : 0;
  const flat = !t || Math.abs(raw) < t.target * 0.01;
  const dir = flat ? 'flat' : raw > 0 ? 'up' : 'down';
  const diff = flat || !t ? '' : withUnit(t.key, Math.abs(raw));
  const word = flat ? 'Vas justo al ritmo' : dir === 'up' ? 'por delante del ritmo' : 'por detrás del ritmo';
  const left =
    p.daysLeft <= 1 ? 'Hoy es el último día' : `Quedan ${formatCount(p.daysLeft)} días`;
  const pctText = `${formatCount(t ? t.pct : 0)} %`;
  const paceText = `${formatCount(p.expectedPct)} %`;
  return {
    title: month ? `Objetivo de ${month}` : 'Objetivo de la semana',
    month,
    done: t ? amount(t.key, t.value) : '0',
    of: t ? `de ${withUnit(t.key, t.target)}` : '',
    value: t ? t.pct / 100 : 0,
    pace: p.expectedPct / 100,
    dir,
    diff,
    word,
    left,
    label: `El ${pctText} del objetivo. El ritmo esperado hoy es el ${paceText}: ${
      flat ? 'vas justo al ritmo' : `vas ${diff} ${word}`
    }.`,
  };
}

/* ---------- Saludo ---------- */

/** Nombre corto para el saludo: hasta « por » o la primera coma, 28 caracteres como mucho. */
export function shortName(s: string): string {
  const c = Array.from(s.split(/ por |,/)[0].trim());
  return c.length > 28 ? `${c.slice(0, 27).join('').trim()}…` : c.join('');
}

/**
 * La frase del saludo: lo que toca hoy o mañana y cómo vas en el mes, en palabras (las cifras están
 * justo debajo). `name` va enlazado al próximo entreno. `null` si no hay nada que decir.
 */
export function heroLead(
  next: PlannedWorkout | undefined,
  pace: { period: string; word: string } | null,
  now: number,
): { lead: string; name: string; tail: string } | null {
  const near = next ? dayMark(next.date, now).near : null;
  const paceText = pace ? `en ${pace.period} ${pace.word.startsWith('Vas') ? 'vas justo al ritmo' : `vas ${pace.word}`}` : '';
  if (next && near) {
    const name = shortName(next.title);
    const end = name.endsWith('…') ? '' : '.';
    return { lead: `${near} toca `, name, tail: paceText ? `, y ${paceText}.` : end };
  }
  if (paceText) return { lead: `${cap(paceText)}.`, name: '', tail: '' };
  return null;
}

/* ---------- Cifras de la semana ---------- */

/**
 * Diferencia de cada cifra de la semana en %: las sumas, frente a lo que sueles llevar a estas
 * alturas; la velocidad, que no depende del día, frente a tu media. Sin salidas esta semana o sin
 * referencia, `null` (nunca un «−100 %» del lunes por la mañana).
 */
export function weekDeltas(trend: WeeklyTrend, rides: number): Record<Accent, number | null> {
  const out: Record<Accent, number | null> = { dist: null, elev: null, time: null, speed: null };
  if (rides === 0) return out;
  for (const m of ['dist', 'elev', 'time', 'speed'] as const) {
    const s = trend.series[m];
    const v = s.values[s.values.length - 1];
    const ref = m === 'speed' ? s.mean : s.meanToDate;
    out[m] = v === null || !ref ? null : (v / ref - 1) * 100;
  }
  return out;
}

/** La línea bajo las cifras: cuántas salidas y frente a qué se comparan. */
export function weekCaption(rides: number, trend: WeeklyTrend): string {
  const dist = trend.series.dist;
  if (rides === 0) {
    const td = dist.meanToDate;
    return `Aún no has salido esta semana.${td && td > 0 ? ` A estas alturas sueles llevar ${formatNumber(td)} km.` : ''}`;
  }
  const count = `${formatCount(rides)} ${rides === 1 ? 'salida' : 'salidas'} esta semana`;
  return dist.mean === null ? `${count}. ${NO_MEAN}` : `${count}, frente a tus semanas a estas alturas`;
}
