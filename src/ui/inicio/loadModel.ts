/**
 * «Carga y forma» de Inicio: qué mostrar según los datos y los textos. Aquí solo hay cálculo y frases;
 * `LoadCard` lo pinta. Nada se compara con valores fijos: la semana, con la habitual del propio ciclista,
 * y la forma, con su signo.
 */
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { LocalDate, RiderThresholds, StoredActivity } from '../../domain/types';
import { TZ } from '../../metrics/aggregate';
import { CTL_DAYS, MIN_WEEKS_WITH_LOAD, type LoadDay, type LoadSource, type WeekLoad } from '../../metrics/load';
import { formatCount, formatNumber } from '../format';

/** Días que muestra la gráfica: 12 semanas, como «Tus últimas 12 semanas». */
export const LOAD_CHART_DAYS = 84;
/** Salidas de los últimos días que se leen para calcular la carga. */
export const LOAD_WINDOW_DAYS = 140;
export const LOAD_NO_DATA = 'Tus salidas no traen pulso ni potencia.';

export type SensorPresence = { power: boolean; hr: boolean };

/** Si alguna salida trae potencia o pulso (por sus totales). */
export function sensorPresence(acts: StoredActivity[]): SensorPresence {
  return {
    power: acts.some((a) => (a.totals.avgPower ?? 0) > 0),
    hr: acts.some((a) => (a.totals.avgHr ?? 0) > 0),
  };
}

export type LoadGate =
  | { state: 'empty' }
  | { state: 'needs-thresholds'; missing: 'ftp' | 'hr' | 'both' }
  | { state: 'ready' };

const hasHrBasis = (t: RiderThresholds) => (t.maxHr ?? 0) > 0 || (t.thresholdHr ?? 0) > 0;
const hasFtp = (t: RiderThresholds) => (t.ftpW ?? 0) > 0;

/**
 * Sin pulso ni potencia: vacío. Con sensor pero sin el umbral que lo hace útil (FTP para la potencia,
 * pulso máximo o de umbral para el pulso): pide el dato en lugar de pintar solo estimaciones.
 */
export function loadGate(p: SensorPresence, t: RiderThresholds): LoadGate {
  if (!p.power && !p.hr) return { state: 'empty' };
  const usable = (p.power && hasFtp(t)) || (p.hr && hasHrBasis(t));
  if (usable) return { state: 'ready' };
  const needFtp = p.power && !hasFtp(t);
  const needHr = p.hr && !hasHrBasis(t);
  return { state: 'needs-thresholds', missing: needFtp && needHr ? 'both' : needFtp ? 'ftp' : 'hr' };
}

export const THRESHOLDS_PROMPT: Record<'ftp' | 'hr' | 'both', string> = {
  ftp: 'Tus salidas traen potencia. Indica tu FTP en Ajustes, o estímalo con tus salidas, para medir su carga.',
  hr: 'Tus salidas traen pulso. Indica tu pulso máximo en Ajustes, o estímalo con tus salidas, para medir su carga.',
  both: 'Tus salidas traen pulso y potencia. Indica tu FTP y tu pulso máximo en Ajustes, o estímalos con tus salidas, para medir su carga.',
};

export type LoadItem = { startTime: number; tss: number; source: LoadSource };

/** Frase de la semana: lo llevado frente a la carga semanal habitual del propio ciclista. */
export function weekSentence(w: WeekLoad): string {
  if (w.usual === null || w.pctOfUsual === null) {
    return `Aún no hay carga habitual: necesitas ${MIN_WEEKS_WITH_LOAD} semanas con salidas.`;
  }
  return `Llevas el ${formatCount(w.pctOfUsual)} % de tu carga semanal habitual (${formatCount(w.usual)}).`;
}

/** La forma por su signo: sin umbrales fijos. */
export function formSentence(form: number): string {
  const n = Math.round(form);
  if (n === 0) return 'Forma 0: tu cansancio y tu forma están igualados.';
  const f = formatNumber(n);
  return n > 0
    ? `Forma +${f}: llegas más descansado que cansado.`
    : `Forma ${f}: acumulas más cansancio que forma.`;
}

/** Cuántas salidas de la ventana tienen una carga que es solo una estimación por duración y desnivel. */
export function estimateNote(items: LoadItem[]): string | null {
  const est = items.filter((i) => i.source === 'estimate').length;
  if (est === 0 || items.length === 0) return null;
  const avg = items.filter((i) => i.source === 'power-avg' || i.source === 'hr-avg').length;
  const base = `${formatCount(est)} de ${formatCount(items.length)} salidas no tienen datos de potencia ni pulso utilizables: su carga es una estimación por duración y desnivel.`;
  return avg > 0 ? `${base} Otras ${formatCount(avg)} usan la media de la salida, que se queda corta si fue irregular.` : base;
}

/** La fitness aún sube con menos de `CTL_DAYS` días de historial: se avisa. */
export function warmupNote(firstRideStart: number | undefined, now: number): string | null {
  if (firstRideStart === undefined) return null;
  const days = (now - firstRideStart) / 86_400_000;
  return days < CTL_DAYS ? `Con menos de ${CTL_DAYS / 7} semanas de salidas, la fitness aún está subiendo y se queda corta.` : null;
}

const DAY_FORMAT = "EEE d MMM";
export const dayLabel = (d: LocalDate) => format(new TZDate(`${d}T12:00:00`, TZ), DAY_FORMAT, { locale: es });

/** Frase de un día de la gráfica. */
export function dayReadout(d: LoadDay): string {
  const r = (n: number) => formatNumber(Math.round(n));
  return `${dayLabel(d.day)}: fitness ${r(d.fitness)}, fatiga ${r(d.fatigue)}, forma ${r(d.form)}.`;
}

/** Resumen para el lector de pantalla. */
export function chartAriaLabel(days: LoadDay[]): string {
  const last = days.at(-1);
  if (!last || days.length === 0) return 'Sin datos';
  const first = days[0];
  const r = (n: number) => formatNumber(Math.round(n));
  return `Fitness y fatiga de los últimos ${days.length} días. Fitness de ${r(first.fitness)} a ${r(last.fitness)}, fatiga de ${r(first.fatigue)} a ${r(last.fatigue)}, forma de hoy ${r(last.form)}.`;
}

/** Un día por cada 7, del último hacia atrás, para la tabla. */
export function weeklyRows(days: LoadDay[]): { label: string; load: number; fitness: number; fatigue: number; form: number }[] {
  const rows: ReturnType<typeof weeklyRows> = [];
  for (let end = days.length - 1; end >= 0; end -= 7) {
    const block = days.slice(Math.max(0, end - 6), end + 1);
    rows.push({
      label: dayLabel(days[end].day),
      load: block.reduce((s, d) => s + d.load, 0),
      fitness: days[end].fitness,
      fatigue: days[end].fatigue,
      form: days[end].form,
    });
  }
  return rows;
}

/** Marcas «redondas» de 0 a un máximo, con 3 o 4 divisiones. */
export function niceAxis(max: number): { hi: number; ticks: number[] } {
  const raw = Math.max(max, 1) / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const n = Math.ceil(Math.max(max, 1) / step);
  return { hi: n * step, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
}
