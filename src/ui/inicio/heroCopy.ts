import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { TZ, type PeriodTotals } from '../../metrics/aggregate';
import { formatCount, formatKm } from '../format';

/** «Viernes 6 de noviembre», como el prototipo. */
export function heroDate(now: number): string {
  const s = format(new TZDate(now, TZ), "EEEE d 'de' MMMM", { locale: es });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * La frase del hero, en tres trozos para poner la cifra en negrita:
 * «Llevas **88 km** esta semana, un 8 % menos que tu media.».
 */
export function heroSentence(
  current: PeriodTotals,
  deltaDistance: number | null,
): { lead: string; figure: string; tail: string } {
  if (current.rides === 0) return { lead: 'Esta semana aún no has salido.', figure: '', tail: '' };
  const figure = formatKm(current.distanceM);
  if (deltaDistance === null) return { lead: 'Llevas ', figure, tail: ' esta semana.' };
  const r = Math.round(deltaDistance);
  if (r === 0) return { lead: 'Llevas ', figure, tail: ' esta semana, lo mismo que tu media.' };
  const word = r > 0 ? 'más' : 'menos';
  return { lead: 'Llevas ', figure, tail: ` esta semana, un ${formatCount(Math.abs(r))} % ${word} que tu media.` };
}
