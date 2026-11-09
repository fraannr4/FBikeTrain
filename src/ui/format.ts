// Formato es-ES del prototipo (FBT.fmt y FBT.dur): coma decimal, menos tipográfico (U+2212) y
// punto de miles solo a partir de 10.000, como pide la RAE: «1542 m», «13.120 km».
const grouped = new Map<number, Intl.NumberFormat>();
const plain = new Map<number, Intl.NumberFormat>();

function formatter(decimals: number, group: boolean): Intl.NumberFormat {
  const cache = group ? grouped : plain;
  let f = cache.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('es-ES', {
      useGrouping: group ? 'always' : false,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    cache.set(decimals, f);
  }
  return f;
}

/** Cifra que se escribe cuando el dato no es un número finito: nunca «NaN» ni «Infinity». */
export const NO_FIGURE = '–';

/** Número con `decimals` decimales: «1542», «13.120», «87,6», «−4». */
export function formatNumber(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return NO_FIGURE;
  const factor = 10 ** decimals;
  const rounded = Math.round(Math.abs(n) * factor) / factor;
  const text = formatter(decimals, rounded >= 10_000).format(rounded);
  return n < 0 && rounded > 0 ? `−${text}` : text;
}

/** Entero: «214», «1240», «13.120». */
export function formatCount(n: number): string {
  return formatNumber(Math.round(n));
}

/** Metros a km: «88 km», o con un decimal, «48,0 km». */
export function formatKm(m: number, decimals: 0 | 1 = 0): string {
  return `${formatNumber(m / 1000, decimals)} km`;
}

/** «1240 m», «11.443 m». */
export function formatMeters(m: number): string {
  return `${formatCount(m)} m`;
}

export type DurationStyle = 'short' | 'long';

/** Horas y minutos redondeados al minuto más cercano. */
function hoursMinutes(s: number): { h: number; min: number } {
  const total = Math.round(Math.max(0, s) / 60);
  return { h: Math.floor(total / 60), min: total % 60 };
}

/**
 * Segundos a horas y minutos, con los minutos en dos cifras.
 * - `short` (FBT.dur 'hm'): «3 h 12», «6 h 08», «3 h 00»; por debajo de la hora, «48 min».
 * - `long` (por defecto): «6 h 08 min», «3 h» en punto; por debajo de la hora, «48 min».
 */
export function formatDuration(s: number, style: DurationStyle = 'long'): string {
  if (!Number.isFinite(s)) return NO_FIGURE;
  const { h, min } = hoursMinutes(s);
  if (h === 0) return `${min} min`;
  const mm = String(min).padStart(2, '0');
  if (style === 'short') return `${formatCount(h)} h ${mm}`;
  return min === 0 ? `${formatCount(h)} h` : `${formatCount(h)} h ${mm} min`;
}

/** Tiempo de una subida o una pasada (FBT.dur 'clock'): «24:14», «1:02:15». */
export function formatClock(s: number): string {
  if (!Number.isFinite(s)) return NO_FIGURE;
  const total = Math.round(Math.max(0, s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** m/s a «24,6 km/h». */
export function formatSpeed(ms: number): string {
  return `${formatNumber(ms * 3.6, 1)} km/h`;
}

/** «−8 %», «+5 %» o «0 %», con el signo menos tipográfico. */
export function formatDeltaPct(pct: number): string {
  if (!Number.isFinite(pct)) return `${NO_FIGURE} %`;
  const r = Math.round(pct);
  return `${r > 0 ? '+' : ''}${formatNumber(r)} %`;
}

/** Días desde algo: «hoy», «ayer» o «hace 1000 días». */
export function daysAgoLabel(days: number): string {
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${formatCount(days)} días`;
}

/** VAM en m/h, con el punto de miles desde 10.000 como el resto: «712 m/h», «1240 m/h». */
export function formatVam(mh: number): string {
  return `${formatCount(mh)} m/h`;
}

/** Pendiente con un decimal: «5,1 %». */
export function formatGrade(pct: number): string {
  return `${formatNumber(pct, 1)} %`;
}

/** Longitud y pendiente media de una subida: «2,0 km al 5,0 %». */
export function formatClimb(lengthM: number, gradePct: number): string {
  return `${formatKm(lengthM, 1)} al ${formatGrade(gradePct)}`;
}
