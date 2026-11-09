import { useId, type CSSProperties, type ReactNode } from 'react';
import { formatCount, formatDeltaPct, formatDuration, formatMeters, formatNumber } from '../format';
import { ArrowDown, ArrowUp } from '../icons';
import {
  DAY_FULL_M,
  dayOfMonth,
  daysInMonth,
  isCurrentMonth,
  kmByDay,
  monthName,
  weekdayDay,
  type MonthTotals,
  type RideItem,
} from './model';

const FIGURE = /\d[\d.,]*/g;

/** «7 h 40» con las cifras en dorsal y las unidades en pequeño; el texto no cambia. */
function Figs({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(FIGURE)) {
    const i = m.index ?? 0;
    if (i > at) out.push(<span key={`u${i}`} className="u">{text.slice(at, i)}</span>);
    out.push(<b key={`b${i}`}>{m[0]}</b>);
    at = i + m[0].length;
  }
  if (at < text.length) out.push(<span key="u-end" className="u">{text.slice(at)}</span>);
  return <>{out}</>;
}

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

type Props = {
  month: number;
  now: number;
  /** Salidas del mes que se ven (la página puede cortar el mes). */
  children: ReactNode;
  /** Todas las salidas del mes que pasan los filtros. */
  items: RideItem[];
  /** Sin búsqueda ni filtros: cifras del mes, tira de días y comparación. Si no, solo el recuento. */
  full: boolean;
  totals?: MonthTotals;
  /** Media mensual de km (m) con la que se compara, si la hay. */
  average?: number;
};

/** Mes del historial: barra pegajosa con el nombre y los km, cifras, tira de días y sus salidas. */
export function MonthSection({ month, now, children, items, full, totals, average }: Props) {
  const id = useId();
  const current = isCurrentMonth(month, now);
  return (
    <section className={current ? 'month' : 'month month--past'} aria-labelledby={id}>
      <div className="month-bar">
        <div className="month-bar-in">
          <h2 className="month-name" id={id}>
            {monthName(month, now)}
            {current && full ? <span className="month-note"> hasta hoy</span> : null}
          </h2>
          {full && totals ? (
            <p className="month-km">
              <span className="sr-only">Distancia: </span>
              {formatNumber(totals.distanceM / 1000, 1)}
              <span className="u"> km</span>
            </p>
          ) : (
            <p className="month-count">{plural(items.length, 'salida', 'salidas')}</p>
          )}
        </div>
      </div>
      {full && totals ? <MonthSummary month={month} now={now} items={items} totals={totals} average={average} /> : null}
      <ul className="list list--inset rides">{children}</ul>
    </section>
  );
}

function MonthSummary({
  month,
  now,
  items,
  totals,
  average,
}: {
  month: number;
  now: number;
  items: RideItem[];
  totals: MonthTotals;
  average?: number;
}) {
  const current = isCurrentMonth(month, now);
  const days = daysInMonth(month);
  const today = dayOfMonth(now);
  const ref = average === undefined ? undefined : current ? (average * today) / days : average;
  const delta = ref ? (totals.distanceM / ref - 1) * 100 : null;
  return (
    <div className="month-sum">
      <p className="month-figs">
        <span>
          <span className="sr-only">Desnivel: </span>
          <Figs text={formatMeters(totals.elevGainM)} />
        </span>
        <span>
          <span className="sr-only">Tiempo en movimiento: </span>
          <Figs text={formatDuration(totals.movingTimeS, 'short')} />
        </span>
        <span className="rides-n">
          <b>{formatCount(totals.rides)}</b>
          <span className="w">{totals.rides === 1 ? ' salida' : ' salidas'}</span>
        </span>
      </p>
      <DayStrip month={month} items={items} days={days} today={current ? today : null} />
      {delta !== null ? (
        <p className={delta >= 0 ? 'delta delta--up' : 'delta delta--down'}>
          {delta >= 0 ? <ArrowUp className="ic" aria-hidden="true" /> : <ArrowDown className="ic" aria-hidden="true" />}
          {delta > 200 ? 'Más del triple de km' : `${formatDeltaPct(delta)} de km`}
          <span className="vs">{current ? `frente a tu media a día ${today}` : 'frente a tu media mensual'}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Una barra por día con la altura de sus km; los días que faltan del mes en curso, en hueco. */
function DayStrip({ month, items, days, today }: { month: number; items: RideItem[]; days: number; today: number | null }) {
  const km = kmByDay(items, days);
  let longest: RideItem | undefined;
  for (const r of items) if (!longest || r.act.totals.distanceM > longest.act.totals.distanceM) longest = r;
  const label =
    `Salidas por día de ${monthName(month, month).toLowerCase()}: ${plural(items.length, 'salida', 'salidas')}` +
    (longest
      ? `; la más larga, el ${weekdayDay(longest.act.startTime)} con ${formatNumber(longest.act.totals.distanceM / 1000, 1)} km`
      : '') +
    '.';
  return (
    <>
      <div className="days" style={{ '--n': days } as CSSProperties} role="img" aria-label={label}>
        {km.map((m, i) =>
          m > 0 ? (
            <i key={i} className="on" style={{ '--h': Math.min(1, m / DAY_FULL_M).toFixed(2) } as CSSProperties} />
          ) : (
            <i key={i} className={today !== null && i + 1 > today ? 'fut' : undefined} />
          ),
        )}
      </div>
      {today !== null ? (
        <div className="days-axis" aria-hidden="true">
          <span>1</span>
          <span className="today" style={{ left: `${(((today - 0.5) / days) * 100).toFixed(2)}%` }}>
            hoy
          </span>
          <span className="end">{days}</span>
        </div>
      ) : null}
    </>
  );
}
