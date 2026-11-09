import { TZDate } from '@date-fns/tz';
import { differenceInCalendarDays } from 'date-fns';
import type { ClimbEffort, ClimbGroup, StoredActivity, TrackPoint } from '../domain/types';
import { TZ } from '../metrics/aggregate';
import { buildProfile } from '../metrics/climbs';
import { formatClock } from './format';

/** Una subida tal como la enseñan Subidas y su hoja. */
export type ClimbItem = {
  id: string;
  /** Sin nombre propio en los datos: «Subida del km 34 de «Salida por la mañana»» (ver `climbName`). */
  name: string;
  lengthM: number;
  gradePct: number;
  gainM: number;
  /** Por fecha ascendente; la primera es la representante. */
  passes: ClimbEffort[];
  best: ClimbEffort;
  last: ClimbEffort;
};

/**
 * Nombre de la subida: los datos no traen el del puerto, así que se nombra por la salida y el km.
 * El nombre de la salida va aislado (FSI…PDI): si está en árabe o hebreo, las comillas no se mueven.
 */
export function climbName(rep: ClimbEffort, ride: StoredActivity | undefined): string {
  return `Subida del km ${Math.round(rep.startDistM / 1000)} de «⁨${ride?.name?.trim() || 'Salida sin nombre'}⁩»`;
}

export function toClimbItems(groups: ClimbGroup[], rides: StoredActivity[]): ClimbItem[] {
  const byId = new Map(rides.map((r) => [r.id, r]));
  return groups.map((g) => {
    const rep = g.efforts.find((e) => e.id === g.id) ?? g.efforts[0];
    return {
      id: g.id,
      name: climbName(rep, byId.get(rep.activityId)),
      lengthM: g.lengthM,
      gradePct: g.avgGradePct,
      gainM: rep.gainM,
      passes: g.efforts,
      best: g.best,
      last: g.efforts[g.efforts.length - 1],
    };
  });
}

export type ClimbSort = 'veces' | 'recientes' | 'duras' | 'largas';

export const CLIMB_SORTS: Record<ClimbSort, (a: ClimbItem, b: ClimbItem) => number> = {
  veces: (a, b) => b.passes.length - a.passes.length || b.last.activityStart - a.last.activityStart,
  recientes: (a, b) => b.last.activityStart - a.last.activityStart,
  duras: (a, b) => b.gradePct - a.gradePct,
  largas: (a, b) => b.lengthM - a.lengthM,
};

/** Puesto de la pasada entre todas: 1 es la más rápida. */
export function rankOf(item: ClimbItem, p: ClimbEffort): number {
  return item.passes.filter((q) => q.timeS < p.timeS).length + 1;
}

/** En una rampa de menos de 3 min la VAM no dice nada («5311 m/h» en 61 s). */
export function vamOk(item: ClimbItem): boolean {
  return item.best.timeS >= 180;
}

/** Tiempo de subida: por debajo de 2 min, «61 s» («1:01» se confunde con 1 h 01); si no, «24:14». */
export function climbTime(s: number): string {
  return Math.round(s) < 120 ? `${Math.round(s)} s` : formatClock(s);
}

/** Diferencia con la mejor: «34 s» o «2:00». */
export function gapTime(s: number): string {
  return Math.round(s) < 60 ? `${Math.round(s)} s` : formatClock(s);
}

/* ---------- Fechas en Madrid ---------- */

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const inTz = (t: number) => new TZDate(t, TZ);
const yearSuffix = (d: TZDate, now: number, sep: string) => (d.getFullYear() !== inTz(now).getFullYear() ? `${sep}${d.getFullYear()}` : '');

export function daysAgo(t: number, now: number): number {
  return differenceInCalendarDays(inTz(now), inTz(t));
}

/** «hoy», «ayer», «el jueves» o «el 4 de octubre» (con el año si no es este). */
export function relDay(t: number, now: number): string {
  const d = daysAgo(t, now);
  const x = inTz(t);
  if (d === 0) return 'hoy';
  if (d === 1) return 'ayer';
  if (d > 1 && d < 7) return `el ${DIAS[x.getDay()]}`;
  return `el ${x.getDate()} de ${MESES[x.getMonth()]}${yearSuffix(x, now, ' de ')}`;
}

/** Cabecera de tarjeta, corta: «Ayer», «El jueves» o «4 oct.» (con el año si no es este). */
export function shortDay(t: number, now: number): string {
  const d = daysAgo(t, now);
  const x = inTz(t);
  if (d >= 0 && d < 7) return cap(relDay(t, now));
  return `${x.getDate()} ${MESES[x.getMonth()].slice(0, 3)}.${yearSuffix(x, now, ' ')}`;
}

/** «Domingo 25 de octubre» (con el año si no es este). */
export function longDay(t: number, now: number): string {
  const x = inTz(t);
  return `${cap(DIAS[x.getDay()])} ${x.getDate()} de ${MESES[x.getMonth()]}${yearSuffix(x, now, ' de ')}`;
}

/** Fecha de una salida: «Hoy, viernes 6 de noviembre», «Ayer, jueves 5 de noviembre» o «Jueves 29 de octubre» (con el año si no es este). */
export function rideDayLabel(t: number, now: number): string {
  const day = longDay(t, now);
  const d = daysAgo(t, now);
  if (d !== 0 && d !== 1) return day;
  return `${d === 0 ? 'Hoy' : 'Ayer'}, ${day.charAt(0).toLowerCase()}${day.slice(1)}`;
}

/** «25 de octubre de 2026». */
export function fullDay(t: number): string {
  const x = inTz(t);
  return `${x.getDate()} de ${MESES[x.getMonth()]} de ${x.getFullYear()}`;
}

/** Mes de Madrid como número: año · 12 + mes. */
export function monthKey(t: number): number {
  const x = inTz(t);
  return x.getFullYear() * 12 + x.getMonth();
}

export function monthName(k: number): string {
  return `${cap(MESES[k % 12])} de ${Math.floor(k / 12)}`;
}

/* ---------- Perfil por kilómetro ---------- */

export type KmProfile = {
  /** Distancia de cada corte desde el inicio (km): 0, 1, 2… y el final. */
  marks: number[];
  /** Altitud suavizada en cada corte (m). */
  eles: number[];
  /** Pendiente de cada tramo (%), con un decimal. */
  grades: number[];
  lengthKm: number;
};

/**
 * Perfil del puerto como en el libro de ruta: un tramo por kilómetro, sobre el perfil suavizado de
 * `buildProfile` entre `startIdx` y `endIdx` del track. Un último tramo de menos de 50 m se suma al
 * anterior. `null` si el track no tiene altitud en ese tramo.
 */
export function kmProfile(track: TrackPoint[], e: Pick<ClimbEffort, 'startIdx' | 'endIdx'>): KmProfile | null {
  const p = buildProfile(track).filter((q) => q.i >= e.startIdx && q.i <= e.endIdx);
  if (p.length < 2) return null;
  const d0 = p[0].distM;
  const lengthM = p[p.length - 1].distM - d0;
  if (!(lengthM > 0)) return null;

  const n = Math.max(1, Math.ceil(lengthM / 1000 - 0.05));
  const marksM = Array.from({ length: n }, (_, i) => i * 1000).concat(lengthM);
  const eles: number[] = [];
  let j = 0;
  for (const m of marksM) {
    while (j < p.length - 2 && p[j + 1].distM - d0 < m) j++;
    const a = p[j];
    const b = p[j + 1];
    const span = b.distM - a.distM;
    const f = span > 0 ? Math.min(1, Math.max(0, (m - (a.distM - d0)) / span)) : 0;
    eles.push(a.ele + (b.ele - a.ele) * f);
  }
  const grades = eles.slice(1).map((v, i) => Math.round(((v - eles[i]) / (marksM[i + 1] - marksM[i])) * 1000) / 10);
  return { marks: marksM.map((m) => m / 1000), eles, grades, lengthKm: lengthM / 1000 };
}
