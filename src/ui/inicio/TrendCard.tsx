import { useId, useRef, useState, type PointerEvent } from 'react';
import type { Accent } from '../accent';
import { SegmentedControl } from '../components/SegmentedControl';
import { useElementWidth } from '../hooks/useElementWidth';
import { ChevronLeft, ChevronRight, Table, TrendingUp } from '../icons';
import {
  COLUMN,
  isEmptyWeek,
  isLine,
  TREND_WEEKS,
  trendAriaLabel,
  trendCaption,
  trendFigure,
  trendReadout,
  trendScale,
  trendTable,
  trendTick,
  type TrendSeries,
  type WeeklyTrend,
} from './trend';

const METRICS: { value: Accent; label: string }[] = [
  { value: 'dist', label: 'Distancia' },
  { value: 'elev', label: 'Desnivel' },
  { value: 'time', label: 'Tiempo' },
  { value: 'speed', label: 'Velocidad' },
];

const LAST = TREND_WEEKS - 1;
const H = 188;
/** Ancho mientras no se ha medido la caja (primer pintado y jsdom). */
const FALLBACK_W = 340;
/** Semanas rotuladas en el eje X, además de «En curso». */
const X_LABELS = [0, 4, 8];

const f1 = (n: number) => n.toFixed(1);

type Geo = { padL: number; slot: number };

/**
 * Geometría de la gráfica al ancho `W`, como drawTrend del prototipo: la media se rotula en el eje
 * (fuera de los datos), la cifra de la semana elegida va pegada encima de su barra y, en la semana en
 * curso, una marca corta dice lo que sueles llevar a estas alturas.
 */
function chart(s: TrendSeries, sel: number, labels: string[], W: number) {
  const sc = trendScale(s.values, s.mean, s.metric);
  const line = isLine(s.metric);
  const meanTxt = s.mean === null ? '' : trendFigure(s.metric, s.mean);
  const pillW = Math.round(meanTxt.length * 6.9 + 12);
  const padL = Math.max(38, pillW + 6);
  const padR = 2;
  const padT = 22;
  const padB = 26;
  const ph = H - padT - padB;
  const slot = (W - padL - padR) / TREND_WEEKS;
  const bw = Math.max(6, Math.min(24, slot * 0.62));
  const Y = (v: number) => padT + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;
  const X = (i: number) => padL + slot * (i + 0.5);
  const ym = s.mean === null ? null : Y(s.mean);

  const ticks = sc.ticks.map((t, i) => ({
    y: Y(t),
    base: i === 0 && !line,
    // La etiqueta de la media sustituye a la marca con la que choca.
    label: ym !== null && Math.abs(Y(t) - ym) < 15 ? null : trendTick(s.metric, t, sc.step),
  }));

  const bars = line
    ? []
    : s.values.flatMap((v, i) => {
        if (isEmptyWeek(v)) return []; // semana sin salidas: sin barra
        const x = X(i) - bw / 2;
        const y = Y(v);
        const b = Y(0);
        const r = Math.min(4, bw / 2, b - y);
        const d = `M${f1(x)} ${f1(b)}V${f1(y + r)}Q${f1(x)} ${f1(y)} ${f1(x + r)} ${f1(y)}H${f1(x + bw - r)}Q${f1(x + bw)} ${f1(y)} ${f1(x + bw)} ${f1(y + r)}V${f1(b)}Z`;
        return [{ i, d }];
      });

  // La línea se parte donde no hay dato (semana sin salidas).
  const paths: string[] = [];
  const dots: { i: number; x: number; y: number }[] = [];
  if (line) {
    let run: string[] = [];
    const flush = () => {
      if (run.length > 1) paths.push(run.join(''));
      run = [];
    };
    s.values.forEach((v, i) => {
      if (v === null) return flush();
      run.push(`${run.length ? 'L' : 'M'}${f1(X(i))} ${f1(Y(v))}`);
      dots.push({ i, x: X(i), y: Y(v) });
    });
    flush();
  }

  const toDate =
    !line && s.meanToDate !== null && sel === LAST
      ? { x0: X(LAST) - bw / 2 - 3, x1: X(LAST) + bw / 2 + 3, y: Y(s.meanToDate) }
      : null;

  // Cifra de la semana elegida: encima de su barra (y de la marca «a estas alturas»); en la línea, al
  // lado contrario de la media. Sin salidas no hay cifra.
  const v = s.values[sel];
  let value: { x: number; y: number; text: string } | null = null;
  if (line ? v !== null : !isEmptyWeek(v)) {
    const n = v as number;
    const text = trendFigure(s.metric, n);
    const half = text.length * 4.4 + 2;
    const x = Math.max(padL + half, Math.min(X(sel), W - padR - half));
    let y: number;
    if (!line) {
      y = Y(n) - 7;
      if (toDate && s.meanToDate !== null && n < s.meanToDate && y > toDate.y - 8) y = toDate.y - 8;
    } else y = s.mean === null || n >= s.mean ? Y(n) - 12 : Y(n) + 22;
    value = { x, y, text };
  }

  return {
    geo: { padL, slot } satisfies Geo,
    W,
    padL,
    padR,
    ticks,
    bars,
    paths,
    dots,
    bw,
    mean: ym === null ? null : { y: ym, pillX: padL - 4 - pillW, pillW, text: meanTxt },
    toDate,
    value,
    xLabels: X_LABELS.map((i) => ({ x: X(i), text: labels[i] })),
  };
}

type Props = {
  trend: WeeklyTrend;
  metric: Accent;
  onMetricChange: (m: Accent) => void;
  id?: string;
};

/**
 * «Tus últimas 12 semanas» (prototipo móvil, Inicio): la métrica, una frase que lee la semana
 * elegida, la gráfica (tocar o arrastrar elige la semana más cercana), flechas de 44 px para ir de
 * una en una y la misma información en una tabla. Los colores salen de los tokens: el tema cambia
 * solo por CSS.
 */
export function TrendCard({ trend, metric, onMetricChange, id }: Props) {
  const uid = useId();
  const ids = { title: `${uid}-t`, read: `${uid}-r`, table: `${uid}-tb` };
  const [sel, setSel] = useState(LAST);
  const [tableOpen, setTableOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const width = useElementWidth(box) || FALLBACK_W;

  const s = trend.series[metric];
  const c = chart(s, sel, trend.labels, width);

  const go = (i: number) => {
    if (Number.isFinite(i)) setSel(Math.max(0, Math.min(LAST, i)));
  };
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    go(Math.round((e.clientX - r.left - c.geo.padL) / c.geo.slot - 0.5));
  };
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    // Con el dedo dentro, arrastrar en horizontal recorre las semanas; el desplazamiento vertical
    // sigue siendo del navegador (touch-action: pan-y).
    if (e.currentTarget.setPointerCapture && e.pointerId !== undefined) e.currentTarget.setPointerCapture(e.pointerId);
    pick(e);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' || e.currentTarget.hasPointerCapture?.(e.pointerId)) pick(e);
  };

  return (
    <section id={id} className="card trend" data-m={metric} aria-labelledby={ids.title}>
      <div className="card-h">
        <span className="card-ic">
          <TrendingUp className="ic" aria-hidden="true" />
        </span>
        <h2 className="card-title" id={ids.title}>
          Tus últimas {TREND_WEEKS} semanas
        </h2>
      </div>
      <SegmentedControl quiet label="Métrica de la gráfica" options={METRICS} value={metric} onChange={onMetricChange} />

      <p className="trend-read" id={ids.read} aria-live="polite">
        {trendReadout(s, sel, trend.labels).map((p, i) =>
          'key' in p ? (
            <span key={i} className="td-key" aria-hidden="true" />
          ) : p.b ? (
            <b key={i}>{p.t}</b>
          ) : (
            <span key={i}>{p.t}</span>
          ),
        )}
      </p>

      <div ref={box} className="trend-box">
        <svg
          className="trend-chart"
          role="img"
          aria-label={trendAriaLabel(s)}
          viewBox={`0 0 ${c.W} ${H}`}
          height={H}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
        >
          {c.ticks.map((t, i) => (
            <g key={`t${i}`}>
              <line className={t.base ? 'base' : 'grid'} x1={c.padL} x2={c.W - c.padR} y1={f1(t.y)} y2={f1(t.y)} />
              {t.label !== null ? (
                <text x={c.padL - 8} y={f1(t.y + 4)} textAnchor="end">
                  {t.label}
                </text>
              ) : null}
            </g>
          ))}
          {c.mean ? (
            <g>
              <rect className="mean-pill" x={f1(c.mean.pillX)} y={f1(c.mean.y - 10)} width={c.mean.pillW} height={20} rx={6} />
              <text className="mean-t" x={f1(c.mean.pillX + c.mean.pillW / 2)} y={f1(c.mean.y + 4)} textAnchor="middle">
                {c.mean.text}
              </text>
            </g>
          ) : null}
          {c.xLabels.map((l) => (
            <text key={l.text} x={f1(l.x)} y={H - 6} textAnchor="middle">
              {l.text}
            </text>
          ))}
          <text className="xl-now" x={c.W - c.padR} y={H - 6} textAnchor="end">
            En curso
          </text>

          {/* Al cambiar de métrica, el trazado entra con un fundido corto. */}
          <g className="trend-plot" key={metric}>
            {c.bars.map((b) => (
              <path key={b.i} className={b.i === sel ? 'bar is-on' : 'bar'} d={b.d} />
            ))}
            {c.paths.map((d, i) => (
              <path key={`l${i}`} className="line" d={d} />
            ))}
            {c.dots.map((d) => (
              <circle
                key={d.i}
                className={d.i === sel ? 'dot is-on' : 'dot'}
                cx={f1(d.x)}
                cy={f1(d.y)}
                r={d.i === sel ? 6 : 4}
              />
            ))}
            {c.mean ? <line className="mean" x1={c.padL} x2={c.W - c.padR} y1={f1(c.mean.y)} y2={f1(c.mean.y)} /> : null}
            {c.toDate ? (
              <g>
                <line className="td-halo" x1={f1(c.toDate.x0)} x2={f1(c.toDate.x1)} y1={f1(c.toDate.y)} y2={f1(c.toDate.y)} />
                <line className="td" x1={f1(c.toDate.x0)} x2={f1(c.toDate.x1)} y1={f1(c.toDate.y)} y2={f1(c.toDate.y)} />
              </g>
            ) : null}
            {c.value ? (
              <text className="val" x={f1(c.value.x)} y={f1(c.value.y)} textAnchor="middle">
                {c.value.text}
              </text>
            ) : null}
          </g>
        </svg>
      </div>

      <div className="trend-foot">
        {/* aria-disabled y no disabled: al llegar al final el foco se queda en la flecha, no cae al body */}
        <div className="trend-nav">
          <button
            type="button"
            className="icon-btn icon-btn--filled"
            aria-label="Semana anterior"
            aria-controls={ids.read}
            aria-disabled={sel === 0}
            onClick={() => go(sel - 1)}
          >
            <ChevronLeft className="ic" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--filled"
            aria-label="Semana siguiente"
            aria-controls={ids.read}
            aria-disabled={sel === LAST}
            onClick={() => go(sel + 1)}
          >
            <ChevronRight className="ic" aria-hidden="true" />
          </button>
        </div>
        <p className="meta trend-key" aria-hidden="true">
          {s.mean !== null ? (
            <>
              <span className="mean-key" />
              tu media
            </>
          ) : null}
        </p>
        <button
          type="button"
          className="btn btn--ghost trend-tbl"
          aria-expanded={tableOpen}
          aria-controls={ids.table}
          onClick={() => setTableOpen((o) => !o)}
        >
          <Table className="ic" aria-hidden="true" />
          <span className="trend-tbl-txt">{tableOpen ? 'Ocultar tabla' : 'Ver tabla'}</span>
        </button>
      </div>

      <div id={ids.table} className="trend-table-wrap" hidden={!tableOpen}>
        {tableOpen ? (
          <table className="trend-table">
            <caption>{trendCaption(s)}</caption>
            <thead>
              <tr>
                <th scope="col">Semana del</th>
                <th scope="col">{COLUMN[metric]}</th>
                <th scope="col">Frente a tu media</th>
              </tr>
            </thead>
            <tbody>
              {trendTable(s, trend.labels).map((r) => (
                <tr key={r.week} className={r.now ? 'is-now' : undefined}>
                  <th scope="row">{r.week}</th>
                  <td>{r.value}</td>
                  <td>
                    {r.diff}
                    {r.note ? (
                      <>
                        <br />
                        <span className="td-note">{r.note}</span>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}
