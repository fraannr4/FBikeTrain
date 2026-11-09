import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { monthKey, monthName } from '../climbView';
import { FilterChip } from '../components/Chip';
import { formatClock } from '../format';
import { useElementSize } from '../hooks/useElementWidth';

export type PassItem = {
  /** Fecha (epoch ms). */
  t: number;
  /** Tiempo (s). */
  s: number;
  /** Fecha escrita: «25 de octubre de 2026». */
  when: string;
  /** Línea bajo el tiempo: «VAM 835 m/h». */
  sub: ReactNode;
};

type Props = {
  /** Por fecha ascendente. */
  items: PassItem[];
  /** Texto alternativo completo de la gráfica. */
  label: string;
  /** Cómo se escribe un tiempo; por defecto, «24:14». */
  format?: (s: number) => string;
  /** «pasada» o «vuelta». */
  noun?: string;
};

type Mark = { t: number; s: number; when: string; sub: ReactNode; k: number; count: number };

/** Con más de 30 pasadas se ven las últimas 30, o todas con una marca por mes (la mejor del mes). */
const MAX = 30;
const STEPS = [10, 15, 30, 60, 120, 180, 300, 600, 900, 1200, 1800, 3600];
const YEAR_STEPS = [1, 2, 5, 10];
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

function byMonth(items: PassItem[]): Mark[] {
  const out: Mark[] = [];
  for (const p of items) {
    const k = monthKey(p.t);
    let m = out[out.length - 1];
    if (!m || m.k !== k) out.push((m = { ...p, k, count: 0 }));
    m.count++;
    if (p.s < m.s) {
      m.s = p.s;
      m.sub = p.sub;
    }
  }
  return out;
}

/**
 * Evolución de tus tiempos (FBT.passes): una pasada por punto, en orden, con el eje invertido
 * (arriba, más rápido). La mejor en `--good`, la discontinua es la media. Deslizar el dedo o las
 * flechas cambian la lectura de arriba; con teclado se anuncia, con el dedo no.
 */
export function PassesChart({ items, label, format = formatClock, noun = 'pasada' }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const size = useElementSize(ref);
  const [view, setView] = useState<'last' | 'all'>('last');
  const [picked, setPicked] = useState<number | null>(null);
  const [live, setLive] = useState<'off' | 'polite'>('off');
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  const total = items.length;

  const { it, monthly, offset, best, mean, allBest } = useMemo(() => {
    const monthly = view === 'all' && total > MAX;
    const it: Mark[] = monthly ? byMonth(items) : items.slice(-MAX).map((p) => ({ ...p, k: 0, count: 1 }));
    let best = 0;
    it.forEach((p, j) => {
      if (p.s < it[best].s) best = j;
    });
    return {
      it,
      monthly,
      offset: monthly ? 0 : total - it.length,
      best,
      mean: it.reduce((a, p) => a + p.s, 0) / it.length,
      allBest: items.reduce((a, p) => Math.min(a, p.s), Infinity),
    };
  }, [items, view, total]);

  const n = it.length;
  const sel = picked !== null && picked < n ? picked : n - 1;
  const part = !monthly && offset > 0; // solo una parte: la leyenda no puede decir «Tu mejor» ni «Tu media»

  // Geometría
  const W = size.width || 320;
  const H = size.height || 176;
  const padL = 10;
  const padR = 50;
  const padB = 30;
  const plotW = W - padL - padR - 16;
  const ss = it.map((p) => p.s);
  const mn = Math.min(...ss);
  const mx = Math.max(...ss);
  const range = Math.max(mx - mn, 30);
  const step = STEPS.find((c) => range / c <= 2.2) ?? 3600;
  const lo = Math.floor((mn - range * 0.12) / step) * step;
  const hi = Math.ceil((mx + range * 0.12) / step) * step;
  const hasRef = part && allBest < it[best].s;
  const refOut = hasRef && allBest < lo;
  const padT = refOut ? 32 : 14;
  const k0 = monthly ? it[0].k : 0;
  const kspan = monthly ? Math.max(1, it[n - 1].k - k0) : 1;
  const Xk = (k: number) => padL + 8 + ((k - k0) / kspan) * plotW;
  const X = (i: number) =>
    monthly ? Xk(it[i].k) : n === 1 ? (padL + (W - padR)) / 2 : padL + 8 + (i * plotW) / (n - 1);
  const Y = (s: number) => padT + ((s - lo) / (hi - lo)) * (H - padT - padB);
  const gridValues: number[] = [];
  for (let v = lo; v <= hi + 0.1; v += step) gridValues.push(v);

  // Una marca cada enero, a pasos regulares de 1, 2 o 5 años según quepan; sin ningún enero, el año del principio.
  const years: { x: number; y: number }[] = [];
  if (monthly) {
    const every = YEAR_STEPS.find((s) => ((s * 12) / kspan) * plotW >= 44) ?? 10;
    for (let yr = Math.ceil(k0 / 12); yr * 12 <= it[n - 1].k; yr++) {
      const x = Xk(yr * 12);
      if (yr % every === 0 && x <= W - padR - 10) years.push({ x, y: yr });
    }
    if (!years.length) years.push({ x: Xk(k0), y: Math.floor(k0 / 12) });
  }
  const d = it.map((p, j) => `${j ? 'L' : 'M'}${f1(X(j))} ${f1(Y(p.s))}`).join('');
  const r = n > 16 ? 2.6 : 4;
  const many = n > 60; // con más de 60 marcas los puntos se solapan: solo la línea, el mejor y el último

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let k = 0;
    let dmin = Infinity;
    for (let j = 0; j < n; j++) {
      const dx = Math.abs(X(j) - x);
      if (dx < dmin) {
        dmin = dx;
        k = j;
      }
    }
    if (k !== sel) setPicked(k);
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const k = ({ ArrowLeft: sel - 1, ArrowRight: sel + 1, Home: 0, End: n - 1 } as Record<string, number>)[e.key];
    if (k === undefined) return;
    e.preventDefault();
    setLive('polite');
    setPicked(Math.max(0, Math.min(n - 1, k)));
  };

  const p = it[sel];
  const head = monthly ? monthName(p.k) : p.when;
  const cap = monthly
    ? `${sel === best ? 'Tu mejor mes. ' : ''}${p.count === 1 ? `Una ${noun} en el mes` : `La mejor de ${p.count} ${noun}s del mes`}`
    : sel === best && n === total
      ? `Tu mejor ${noun}`
      : sel === best
        ? `Tu mejor de estas ${n}`
        : sel === n - 1
          ? `Tu última ${noun}`
          : `${Noun} ${offset + sel + 1} de ${total}`;

  return (
    <div className="passes">
      {total > MAX ? (
        <div className="passes-mode cluster" role="group" aria-label={`Qué ${noun}s ver`}>
          {(
            [
              ['last', `Últimas ${MAX}`],
              ['all', 'Todas, por meses'],
            ] as const
          ).map(([v, text]) => (
            <FilterChip
              key={v}
              pressed={view === v}
              onClick={() => {
                setView(v);
                setPicked(null);
              }}
            >
              {text}
            </FilterChip>
          ))}
        </div>
      ) : null}
      <div className="passes-read" aria-live={live}>
        <span className="pr-when">
          <b>{head}</b>
          <span>{cap}</span>
        </span>
        <span className="pr-val">
          <span className={sel === best ? 'fig is-best' : 'fig'}>{format(p.s)}</span>
          <span>{p.sub}</span>
        </span>
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          setLive('off');
          pick(e);
        }}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse' || e.pressure > 0) pick(e);
        }}
      >
        <g className="grid" aria-hidden="true">
          {gridValues.map((v) => (
            <g key={v}>
              <line x1={padL} x2={W - padR + 6} y1={f1(Y(v))} y2={f1(Y(v))} />
              <text x={W} y={f1(Y(v) + 4)} textAnchor="end">
                {format(v)}
              </text>
            </g>
          ))}
        </g>
        <line className="mean" x1={padL} x2={W - padR + 6} y1={f1(Y(mean))} y2={f1(Y(mean))} />
        {hasRef ? (
          <>
            <line
              className="ref"
              x1={padL}
              x2={W - padR + 6}
              y1={f1(refOut ? padT - 12 : Y(allBest))}
              y2={f1(refOut ? padT - 12 : Y(allBest))}
            />
            <text className="ref-t" x={padL} y={f1((refOut ? padT - 12 : Y(allBest)) - 5)}>
              {`${refOut ? '↑ ' : ''}Tu mejor, ${format(allBest)}`}
            </text>
          </>
        ) : null}
        <line className="guide" x1={f1(X(sel))} x2={f1(X(sel))} y1={padT} y2={H - padB + 4} />
        {n > 1 ? (
          <>
            <path className="halo" d={d} />
            <path className="line" d={d} />
          </>
        ) : null}
        {it.map((q, j) => {
          const key = j === best || j === n - 1;
          if (many && !key) return null;
          const cls = j === best ? 'dot dot--best' : j === n - 1 ? 'dot dot--last' : 'dot';
          return <circle key={j} className={cls} r={key ? 5.5 : r} cx={f1(X(j))} cy={f1(Y(q.s))} />;
        })}
        <circle className="sel" r={9} cx={f1(X(sel))} cy={f1(Y(p.s))} />
        <g className="xl" aria-hidden="true">
          {monthly
            ? years.map((yy) => (
                <text key={yy.y} x={f1(yy.x)} y={H - 8} textAnchor="start">
                  {yy.y}
                </text>
              ))
            : n > 1 ? (
                <>
                  <text x={f1(X(0) - 4)} y={H - 8} textAnchor="start">{`${offset + 1}.ª`}</text>
                  <text x={f1(X(n - 1) + 4)} y={H - 8} textAnchor="end">{`${offset + n}.ª ${noun}`}</text>
                </>
              ) : null}
        </g>
      </svg>
      <p className="passes-key">
        <span>
          <i className="k-best" aria-hidden="true" />
          {part ? `Mejor de estas ${n}` : monthly ? 'Tu mejor mes' : 'Tu mejor'}
        </span>
        <span>
          <i className="k-mean" aria-hidden="true" />
          <span data-mean="">{`${monthly ? 'Media de los meses' : part ? `Media de estas ${n}` : 'Tu media'}, ${format(mean)}`}</span>
        </span>
        <span className="k-up">Arriba, más rápido</span>
      </p>
    </div>
  );
}
