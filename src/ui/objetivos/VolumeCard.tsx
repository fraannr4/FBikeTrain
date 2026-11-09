import type { ReactNode } from 'react';
import type { LocalDate, VolumeGoal } from '../../domain/types';
import type { VolumeProgress, VolumeTarget } from '../../metrics/calendar';
import { diffDays } from '../calendarGrid';
import { Meter } from '../components/Meter';
import { Ring } from '../components/Ring';
import { ArrowDown, ArrowUp, Bike, Calendar, Check, CircleCheck, Clock, Mountain, Pencil, TrendingUp, type LucideIcon } from '../icons';
import { METRICS, figure, full, ofTarget, pctText, periodTitle, targetsText, unit, weekSpan, NNBSP } from './model';

const ICONS: Record<VolumeTarget['key'], LucideIcon> = { distanceM: Bike, elevGainM: Mountain, movingTimeS: Clock };
/** Las etiquetas accesibles van con espacios normales: el lector no necesita el fino. */
const plain = (s: string): string => s.replace(new RegExp(NNBSP, 'g'), ' ');

type Props = {
  goal: VolumeGoal;
  progress: VolumeProgress;
  today: LocalDate;
  /** Distancia o desnivel de los entrenos pendientes hasta el fin del periodo (de la métrica del anillo). */
  planned: number;
  onEdit: (g: VolumeGoal) => void;
};

function editLabel(title: string): string {
  if (title === 'Esta semana') return 'Editar el objetivo de la semana';
  return `Editar el objetivo de ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
}

/** Lectura del anillo, completa: «Distancia: 312 km de 400 km, el 78 %. El ritmo para llegar a tiempo es el 73 %.» */
function ringLabel(t: VolumeTarget, p: VolumeProgress, startsIn: number): string {
  const m = METRICS[t.key];
  let s = `${m.name}: ${full(t.key, t.value)} de ${full(t.key, t.target)}, el ${pctText(t.pct)} %.`;
  if (p.status === 'future') s = `${m.name}: ${full(t.key, t.target)}. ${startsText(startsIn)}.`;
  else if (t.pct >= 100) s += ' Objetivo conseguido.';
  else if (p.status === 'current') s += ` El ritmo para llegar a tiempo es el ${pctText(p.expectedPct)} %.`;
  return plain(s);
}

const startsText = (n: number): string => (n <= 1 ? 'Empieza mañana' : `Empieza en ${n} días`);

/**
 * Tarjeta de un objetivo de volumen (objetivos.html): la primera meta en el anillo, con la muesca del
 * ritmo esperado, y las demás en barras. Las líneas de la derecha dicen si vas por delante o por
 * detrás, cuánto queda y adónde llegas con lo planificado.
 */
export function VolumeCard({ goal, progress: p, today, planned, onEdit }: Props) {
  const [first, ...rest] = p.targets;
  if (!first) return null;
  const title = periodTitle(goal, today);
  const titleId = `vol-${goal.id}-t`;
  const m = METRICS[first.key];
  const reached = first.pct >= 100 && p.status !== 'future';
  const current = p.status === 'current';
  const startsIn = diffDays(goal.start, today);
  const sub =
    goal.period === 'week'
      ? `${weekSpan(goal.start)}. Objetivo: ${targetsText(goal)}.`
      : `Objetivo: ${targetsText(goal)} en el mes.`;
  const pace = current && first.pct < 100 ? p.expectedPct / 100 : undefined;

  const lines: { good?: boolean; icon: LucideIcon; body: ReactNode }[] = [];
  if (p.status === 'future') {
    lines.push({ icon: Clock, body: startsText(startsIn) });
  } else {
    if (reached) {
      lines.push({ good: true, icon: CircleCheck, body: <><b>{full(first.key, first.value - first.target)}</b> por encima del objetivo</> });
    } else if (current) {
      const diff = first.value - first.expected;
      const shown = full(first.key, Math.abs(diff));
      if (/^0\D/.test(shown)) lines.push({ good: true, icon: Check, body: 'Vas justo al ritmo' });
      else if (diff >= 0) lines.push({ good: true, icon: ArrowUp, body: <><b>{shown}</b> por delante del ritmo</> });
      else lines.push({ icon: ArrowDown, body: <><b>{shown}</b> por detrás del ritmo</> });
    }
    if (current) lines.push({ icon: Clock, body: p.daysLeft <= 1 ? 'Último día' : `Quedan ${p.daysLeft} días` });
    if (current && !reached && planned > 0 && first.key !== 'movingTimeS') {
      const reach = first.value + planned;
      lines.push({
        good: reach >= first.target,
        icon: reach >= first.target ? CircleCheck : TrendingUp,
        body: <>Con lo planificado llegas a <b>{full(first.key, reach)}</b></>,
      });
    } else if (current && !reached && goal.period === 'month' && p.daysLeft >= 7) {
      const perWeek = (first.target - first.value) / (p.daysLeft / 7);
      lines.push({ icon: TrendingUp, body: <>Unos <b>{full(first.key, perWeek)}</b> por semana hasta fin de mes</> });
    }
  }

  return (
    <article className="card vol" data-m={m.accent} aria-labelledby={titleId}>
      <div className="card-h">
        <span className="card-ic" aria-hidden="true">
          <Calendar className="ic" />
        </span>
        <h3 className="card-title" id={titleId}>
          {title}
        </h3>
        <button className="icon-btn" type="button" aria-label={editLabel(title)} onClick={() => onEdit(goal)}>
          <Pencil className="ic" aria-hidden="true" />
        </button>
      </div>
      <div className="vol-sub">
        {reached ? (
          <span className="chip chip--done">
            <Check className="ic" aria-hidden="true" />
            Conseguido
          </span>
        ) : null}
        <span>{sub}</span>
      </div>
      <div className="vol-body">
        <Ring value={first.pct / 100} pace={pace} label={ringLabel(first, p, startsIn)} accent={m.accent}>
          <span className="ring-v">
            {pctText(first.pct)}
            <span className="u">{NNBSP}%</span>
          </span>
          <span className="ring-s">
            <b>{figure(first.key, first.value)}</b> de {figure(first.key, first.target)}
            {unit(first.key) ? `${NNBSP}${unit(first.key)}` : ''}
          </span>
        </Ring>
        <ul className="vol-lines">
          {lines.map(({ good, icon: Icon, body }, i) => (
            <li key={i} className={good ? 'is-good' : undefined}>
              <Icon className="ic" aria-hidden="true" />
              <span>{body}</span>
            </li>
          ))}
        </ul>
      </div>
      {rest.length > 0 ? (
        <div className="vol-more">
          {rest.map((t) => {
            const tm = METRICS[t.key];
            const Icon = ICONS[t.key];
            const label =
              `${tm.name}: ${full(t.key, t.value)} de ${full(t.key, t.target)}, el ${pctText(t.pct)} %.` +
              (current && t.pct < 100 ? ` El ritmo para llegar a tiempo es el ${pctText(p.expectedPct)} %.` : '');
            const shown = ofTarget(t.key, t.value, t.target);
            const cut = shown.indexOf(' de ');
            return (
              <div className="bar-row" data-m={tm.accent} key={t.key}>
                <p className="bar-l">
                  <span>
                    <Icon className="ic" aria-hidden="true" />
                    {tm.name}
                  </span>
                  <span className="nw">
                    <b>{shown.slice(0, cut)}</b>
                    {shown.slice(cut)}
                    <span className="pct">
                      {pctText(t.pct)}
                      {NNBSP}%
                    </span>
                  </span>
                </p>
                <Meter
                  value={t.pct / 100}
                  pace={current && t.pct < 100 ? p.expectedPct / 100 : undefined}
                  label={plain(label)}
                  accent={tm.accent}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
