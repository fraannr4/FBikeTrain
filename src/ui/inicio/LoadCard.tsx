import { useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import type { RiderThresholds, StoredActivity } from '../../domain/types';
import { loadSeries, weekLoadVsUsual } from '../../metrics/load';
import { Activity, ChevronLeft, ChevronRight, Table } from '../icons';
import { Meter } from '../components/Meter';
import { Skeleton } from '../components/Skeleton';
import { useElementSize } from '../hooks/useElementWidth';
import { formatCount, formatNumber } from '../format';
import {
  chartAriaLabel,
  dayLabel,
  estimateNote,
  formSentence,
  LOAD_CHART_DAYS,
  LOAD_NO_DATA,
  loadGate,
  niceAxis,
  sensorPresence,
  THRESHOLDS_PROMPT,
  warmupNote,
  weekSentence,
  weeklyRows,
} from './loadModel';
import { useTrainingLoad } from './useTrainingLoad';
import '../styles/carga.css';

const FALLBACK_W = 340;
const H_LINES = 148;
const H_FORM = 56;
const GAP = 12;
const H_AXIS = 22;
const PAD_L = 34;
const PAD_R = 58;
const PAD_T = 8;
const f1 = (n: number) => n.toFixed(1);

type Props = { acts: StoredActivity[]; thresholds: RiderThresholds; now: number };

/**
 * «Carga y forma»: la carga de esta semana frente a la habitual del ciclista y la evolución de su
 * fitness (media de 42 días), su fatiga (7 días) y su forma (fitness menos fatiga). Sin pulso ni
 * potencia lo dice; con sensor pero sin FTP o pulso máximo, pide el dato. Colores de tokens.
 */
export function LoadCard({ acts, thresholds, now }: Props) {
  const uid = useId();
  const titleId = `${uid}-t`;
  const gate = useMemo(() => loadGate(sensorPresence(acts), thresholds), [acts, thresholds]);

  return (
    <section className="card load" aria-labelledby={titleId} data-testid="load-card">
      <div className="card-h">
        <span className="card-ic">
          <Activity className="ic" aria-hidden="true" />
        </span>
        <h2 className="card-title" id={titleId}>
          Carga y forma
        </h2>
      </div>
      {gate.state === 'empty' ? (
        <p className="load-empty" data-state="empty">
          {LOAD_NO_DATA}
        </p>
      ) : gate.state === 'needs-thresholds' ? (
        <div className="load-empty" data-state="needs-thresholds">
          <p>{THRESHOLDS_PROMPT[gate.missing]}</p>
          <Link className="btn btn--secondary" to="/ajustes?abrir=umbrales">
            Indicar mis umbrales
          </Link>
        </div>
      ) : (
        <LoadBody acts={acts} thresholds={thresholds} now={now} />
      )}
    </section>
  );
}

function LoadBody({ acts, thresholds, now }: Props) {
  const uid = useId();
  const load = useTrainingLoad(acts, thresholds, now);
  const [selected, setSelected] = useState<number | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const size = useElementSize(box);
  const width = size.width || FALLBACK_W;

  const model = useMemo(() => {
    if (load.status !== 'ready') return null;
    const series = loadSeries(load.items, now);
    const days = series.slice(-LOAD_CHART_DAYS);
    const week = weekLoadVsUsual(load.items, now);
    const first = load.items.length ? Math.min(...load.items.map((i) => i.startTime)) : undefined;
    return { days, week, note: estimateNote(load.items), warm: warmupNote(first, now), rows: weeklyRows(days) };
  }, [load, now]);

  if (!model) {
    return (
      <div role="status" className="load-sk">
        <span className="sr-only">Calculando tu carga…</span>
        <Skeleton width="60%" />
        <Skeleton variant="fig" />
        <Skeleton variant="box" height={160} />
      </div>
    );
  }

  const { days, week, note, warm, rows } = model;
  if (days.length === 0) {
    return <p className="load-empty">Todavía no hay salidas con carga que mostrar.</p>;
  }
  const last = days.length - 1;
  const sel = selected === null ? last : Math.min(selected, last);
  const cur = days[sel];

  // Geometría: arriba fitness y fatiga (de 0 al máximo), abajo la forma (barras sobre y bajo el 0).
  const plotW = width - PAD_L - PAD_R;
  const slot = plotW / Math.max(days.length, 1);
  const X = (i: number) => PAD_L + slot * (i + 0.5);
  const axis = niceAxis(Math.max(...days.map((d) => Math.max(d.fitness, d.fatigue))));
  const yLine = (v: number) => PAD_T + (H_LINES - PAD_T) * (1 - v / axis.hi);
  const formAbs = Math.max(1, ...days.map((d) => Math.abs(d.form)));
  const formTop = H_LINES + GAP;
  const yForm = (v: number) => formTop + H_FORM / 2 - (v / formAbs) * (H_FORM / 2 - 2);
  const height = formTop + H_FORM + H_AXIS;
  const path = (key: 'fitness' | 'fatigue') => days.map((d, i) => `${i ? 'L' : 'M'}${f1(X(i))} ${f1(yLine(d[key]))}`).join('');

  // Etiquetas directas al final de cada línea, separadas al menos 14 px.
  let yFit = yLine(days[last].fitness);
  let yFat = yLine(days[last].fatigue);
  if (Math.abs(yFit - yFat) < 14) {
    if (yFit <= yFat) {
      yFit -= (14 - (yFat - yFit)) / 2;
      yFat += (14 - (yFat - yFit)) / 2;
    } else {
      yFat -= (14 - (yFit - yFat)) / 2;
      yFit += (14 - (yFit - yFat)) / 2;
    }
  }

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round((e.clientX - r.left - PAD_L) / slot - 0.5);
    if (Number.isFinite(i)) setSelected(Math.max(0, Math.min(last, i)));
  };
  const go = (i: number) => setSelected(Math.max(0, Math.min(last, i)));
  const ids = { read: `${uid}-r`, table: `${uid}-tb` };
  const fig = (n: number) => formatNumber(Math.round(n));
  const isToday = sel === last;

  return (
    <>
      <div className="load-week">
        <p className="load-week-fig">
          <span className="fig">{formatCount(week.current)}</span>
          <span className="unit"> de carga esta semana</span>
        </p>
        <Meter
          value={week.pctOfUsual === null ? 0 : week.pctOfUsual / 100}
          label={week.pctOfUsual === null ? 'Sin carga habitual con la que comparar' : `${formatCount(week.pctOfUsual)} % de tu carga semanal habitual`}
          accent="time"
        />
        <p className="load-sentence">{weekSentence(week)}</p>
      </div>

      <dl className="load-figs" aria-label={isToday ? 'Hoy' : dayLabel(cur.day)}>
        <div>
          <dt>
            <i className="sw sw--fit" aria-hidden="true" />
            Fitness
          </dt>
          <dd>{fig(cur.fitness)}</dd>
        </div>
        <div>
          <dt>
            <i className="sw sw--fat" aria-hidden="true" />
            Fatiga
          </dt>
          <dd>{fig(cur.fatigue)}</dd>
        </div>
        <div>
          <dt>
            <i className="sw sw--form" aria-hidden="true" />
            Forma
          </dt>
          <dd>{cur.form > 0.5 ? `+${fig(cur.form)}` : fig(cur.form)}</dd>
        </div>
      </dl>

      <p className="load-read" id={ids.read} aria-live="polite">
        <b>{isToday ? 'Hoy' : dayLabel(cur.day)}.</b> {formSentence(cur.form)}
      </p>

      <div ref={box} className="load-box">
        <svg
          className="load-chart"
          role="img"
          aria-label={chartAriaLabel(days)}
          viewBox={`0 0 ${width} ${height}`}
          height={height}
          onPointerDown={pick}
          onPointerMove={(e) => (e.pointerType === 'mouse' || e.buttons > 0) && pick(e)}
        >
          {axis.ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'base' : 'grid'} x1={PAD_L} x2={width - PAD_R} y1={f1(yLine(t))} y2={f1(yLine(t))} />
              <text x={PAD_L - 6} y={f1(yLine(t) + 4)} textAnchor="end">
                {formatNumber(t)}
              </text>
            </g>
          ))}
          <line className="base" x1={PAD_L} x2={width - PAD_R} y1={f1(yForm(0))} y2={f1(yForm(0))} />
          <text x={PAD_L - 6} y={f1(yForm(0) + 4)} textAnchor="end">
            0
          </text>
          <text className="dl dl--form" x={width - PAD_R + 6} y={f1(yForm(0) + 4)}>
            Forma
          </text>
          {days.map((d, i) => {
            const y0 = yForm(0);
            const y1 = yForm(d.form);
            return (
              <rect
                key={d.day}
                className={i === sel ? 'fbar is-on' : 'fbar'}
                x={f1(X(i) - Math.max(slot - 1, 1) / 2)}
                width={f1(Math.max(slot - 1, 1))}
                y={f1(Math.min(y0, y1))}
                height={f1(Math.max(Math.abs(y1 - y0), 0.5))}
              />
            );
          })}
          <path className="fit" d={path('fitness')} />
          <path className="fat" d={path('fatigue')} />
          <line className="cursor" x1={f1(X(sel))} x2={f1(X(sel))} y1={PAD_T} y2={formTop + H_FORM} />
          <circle className="dot dot--fit" cx={f1(X(sel))} cy={f1(yLine(cur.fitness))} r={5} />
          <circle className="dot dot--fat" cx={f1(X(sel))} cy={f1(yLine(cur.fatigue))} r={5} />
          <text className="dl dl--fit" x={width - PAD_R + 6} y={f1(yFit + 4)}>
            Fitness
          </text>
          <text className="dl dl--fat" x={width - PAD_R + 6} y={f1(yFat + 4)}>
            Fatiga
          </text>
          <text x={PAD_L} y={height - 6}>
            {dayLabel(days[0].day)}
          </text>
          <text className="xl-now" x={width - PAD_R} y={height - 6} textAnchor="end">
            Hoy
          </text>
        </svg>
      </div>

      <div className="load-foot">
        <div className="trend-nav">
          <button type="button" className="icon-btn icon-btn--filled" aria-label="Día anterior" aria-controls={ids.read} aria-disabled={sel === 0} onClick={() => go(sel - 1)}>
            <ChevronLeft className="ic" aria-hidden="true" />
          </button>
          <button type="button" className="icon-btn icon-btn--filled" aria-label="Día siguiente" aria-controls={ids.read} aria-disabled={sel === last} onClick={() => go(sel + 1)}>
            <ChevronRight className="ic" aria-hidden="true" />
          </button>
        </div>
        <button type="button" className="btn btn--ghost trend-tbl" aria-expanded={tableOpen} aria-controls={ids.table} onClick={() => setTableOpen((o) => !o)}>
          <Table className="ic" aria-hidden="true" />
          <span className="trend-tbl-txt">{tableOpen ? 'Ocultar tabla' : 'Ver tabla'}</span>
        </button>
      </div>

      <div id={ids.table} className="trend-table-wrap" hidden={!tableOpen}>
        {tableOpen ? (
          <table className="trend-table">
            <caption>Carga por semana y valores al final de cada una.</caption>
            <thead>
              <tr>
                <th scope="col">Hasta el</th>
                <th scope="col">Carga</th>
                <th scope="col">Fitness</th>
                <th scope="col">Fatiga</th>
                <th scope="col">Forma</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td>{fig(r.load)}</td>
                  <td>{fig(r.fitness)}</td>
                  <td>{fig(r.fatigue)}</td>
                  <td>{fig(r.form)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <p className="meta load-how">
        Fitness: tu carga media de unas 6 semanas. Fatiga: la de la última semana. Forma: fitness menos fatiga.
      </p>
      {warm ? <p className="meta load-note">{warm}</p> : null}
      {note ? <p className="meta load-note">{note}</p> : null}
    </>
  );
}
