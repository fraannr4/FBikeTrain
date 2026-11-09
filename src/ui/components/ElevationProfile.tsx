import { memo, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { TrackPoint } from '../../domain/types';
import { buildProfile, type ProfilePoint } from '../../metrics/climbs';
import { GRADE_LABELS, gradeClass, profileBands } from '../charts/grade';
import { formatCount, formatNumber } from '../format';
import { useElementWidth } from '../hooks/useElementWidth';
import { Info } from '../icons';

export type ProfileClimb = { startDistM: number; lengthM: number; avgGradePct?: number };

type Props = {
  points: TrackPoint[];
  /** Tramos de subida: se sombrean y llevan su número, en el mismo orden que la lista. */
  climbs?: ProfileClimb[];
  /** Título de la sección: va a la izquierda de la lectura del punto. */
  heading?: ReactNode;
  /** El punto del perfil bajo el dedo (con su posición) o `null` al empezar. */
  onCursor?: (p: ProfilePoint | null) => void;
};

/** Puntos del perfil como mucho: de sobra para 430 px y para recorrerlo con las flechas. */
const MAX_POINTS = 480;
/** Tramo con el que se mide la pendiente bajo el dedo (m). */
const GRADE_SPAN_M = 100;
const W = 320;
const H = 100;
const PAGE = 12;
const NB = ' ';

/** Reparte el perfil en MAX_POINTS puntos como mucho, sin perder el último ni la cima. */
function sample(p: ProfilePoint[]): ProfilePoint[] {
  if (p.length <= MAX_POINTS) return p;
  let top = 0;
  for (let i = 1; i < p.length; i++) if (p[i].ele > p[top].ele) top = i;
  const step = (p.length - 1) / (MAX_POINTS - 1);
  const picks = new Set<number>([top]);
  for (let k = 0; k < MAX_POINTS; k++) picks.add(Math.round(k * step));
  return [...picks].sort((a, b) => a - b).map((i) => p[i]);
}

/** Pendiente (%) en el punto k: la de los GRADE_SPAN_M que lo rodean. */
function gradeAt(p: ProfilePoint[], k: number): number {
  let a = k;
  let b = k;
  while (p[b].distM - p[a].distM < GRADE_SPAN_M && (a > 0 || b < p.length - 1)) {
    if (a > 0) a--;
    if (b < p.length - 1) b++;
  }
  const run = p[b].distM - p[a].distM;
  return run > 0 ? ((p[b].ele - p[a].ele) / run) * 100 : 0;
}

/** Índice del punto más cercano a la distancia `d` (búsqueda binaria). */
function nearest(p: ProfilePoint[], d: number): number {
  let lo = 0;
  let hi = p.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (p[mid].distM < d) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && d - p[lo - 1].distM < p[lo].distM - d ? lo - 1 : lo;
}

/** Marcas del eje: 0, múltiplos redondos y el total. */
export function axisTicks(totalKm: number): number[] {
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200].find((v) => totalKm / v <= 4.5) ?? 500;
  const out: number[] = [];
  for (let v = step; v < totalKm - step * 0.6; v += step) out.push(v);
  return out;
}

/** Líneas de cota redondas entre el 10 y el 88 % de la altura, dos o tres. */
function gridLines(lo: number, hi: number, yFrac: (v: number) => number): number[] {
  const span = hi - lo;
  const step = [10, 20, 25, 50, 100, 200, 250, 500, 1000].find((v) => span / v <= 3.2) ?? 2000;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const f = yFrac(v);
    if (f > 0.1 && f < 0.88) out.push(v);
  }
  return out.slice(-3);
}

const fmtKm = (m: number) => formatNumber(m / 1000, 1);
const fmtGrade = (g: number) => formatNumber(Math.round(g * 10) / 10 === 0 ? 0 : g, 1);

/**
 * Perfil de altitud coloreado por pendiente que se recorre con el dedo, el ratón o las flechas. El
 * punto bajo el dedo se lee arriba (km, altitud y pendiente) y se avisa con `onCursor` para que el
 * mapa lo siga. Las subidas van sombreadas y numeradas. El SVG es la imagen con el resumen; encima, un
 * control deslizante accesible.
 */
export const ElevationProfile = memo(function ElevationProfile({ points, climbs = [], heading, onCursor }: Props) {
  const full = useMemo(() => buildProfile(points), [points]);
  const prof = useMemo(() => sample(full), [full]);
  const box = useRef<HTMLDivElement>(null);
  const width = useElementWidth(box);
  const [cur, setCur] = useState(-1);
  const dragging = useRef(false);

  const geo = useMemo(() => {
    if (prof.length < 2) return null;
    const d0 = prof[0].distM;
    const total = prof[prof.length - 1].distM - d0;
    const bands = profileBands(
      prof.map((p) => ({ dM: p.distM, ele: p.ele })),
      { width: W, height: H },
    );
    if (!bands || !(total > 0)) return null;
    let min = prof[0].ele;
    let top = 0;
    for (let i = 0; i < prof.length; i++) {
      if (prof[i].ele < min) min = prof[i].ele;
      if (prof[i].ele > prof[top].ele) top = i;
    }
    const max = prof[top].ele;
    // La misma escala que profileBands: la base, un 12 % del desnivel por debajo del mínimo.
    const lo = min - (max - min) * 0.12;
    const span = max - lo || 1;
    const yFrac = (v: number) => (H - ((v - lo) / span) * (H - 4)) / H;
    const xFrac = (d: number) => (d - d0) / total;
    return { d0, total, bands, min, max, top, yFrac, xFrac, lines: gridLines(lo, max, yFrac), ticks: axisTicks(total / 1000) };
  }, [prof]);

  if (!geo) return null;
  const { total, bands, min, max, top, yFrac, xFrac } = geo;

  const show = (i: number) => {
    const k = Math.max(0, Math.min(prof.length - 1, i));
    setCur(k);
    onCursor?.(prof[k]);
  };
  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width > 0) show(nearest(prof, geo.d0 + ((e.clientX - r.left) / r.width) * total));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const start = cur < 0 ? top : cur;
    const steps: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: PAGE, PageDown: -PAGE };
    if (e.key in steps) show(start + steps[e.key]);
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(prof.length - 1);
    else return;
    e.preventDefault();
  };

  const p = cur >= 0 ? prof[cur] : null;
  const g = p ? gradeAt(prof, cur) : 0;
  const valueText = p
    ? `km ${fmtKm(p.distM - geo.d0)}: ${formatCount(p.ele)} metros, pendiente del ${fmtGrade(g)} %`
    : `Cima: ${formatCount(max)} m en el km ${fmtKm(prof[top].distM - geo.d0)}. Usa las flechas para recorrer el perfil.`;

  // Chinchetas en la cima de cada subida; si se tocan, se funden en una («2·3»).
  const pins: { x: number; y: number; text: string; cls: number; half: number }[] = [];
  climbs.forEach((c, n) => {
    const k = nearest(prof, c.startDistM + c.lengthM);
    const x = xFrac(prof[k].distM) * width;
    const y = yFrac(prof[k].ele);
    const cls = gradeClass(c.avgGradePct ?? 0);
    const last = pins[pins.length - 1];
    if (width > 0 && last && Math.abs(last.x - x) < last.half + 16) {
      last.text += `·${n + 1}`;
      last.cls = Math.max(last.cls, cls);
      last.y = Math.min(last.y, y);
      last.x = (last.x + x) / 2;
      last.half = (10 + last.text.length * 8) / 2;
    } else pins.push({ x, y, text: String(n + 1), cls, half: 12 });
  });

  const label =
    `Perfil de altitud: ${fmtKm(total)} km, de ${formatCount(min)} a ${formatCount(max)} m, ` +
    `con la cima en el km ${fmtKm(prof[top].distM - geo.d0)}.` +
    (climbs.length === 1 ? ' Una subida, sombreada.' : climbs.length > 1 ? ` ${climbs.length} subidas, sombreadas y numeradas.` : '');

  return (
    <>
      <div className="section-h">
        {heading}
        <p className="scrub-read" aria-hidden="true">
          {p ? (
            <>
              <span>
                km <b>{fmtKm(p.distM - geo.d0)}</b>
              </span>
              <span>
                <b>{formatCount(p.ele)}</b>m
              </span>
              <span>
                <i className={`sw sw-${gradeClass(g)}`} />
                <b>{fmtGrade(g)}</b>%
              </span>
            </>
          ) : (
            <>
              <span>
                Cima <b>{formatCount(max)}</b>m
              </span>
              <span>
                en el km <b>{fmtKm(prof[top].distM - geo.d0)}</b>
              </span>
            </>
          )}
        </p>
      </div>
      <div ref={box} className={cur >= 0 ? 'scrub is-on' : 'scrub'}>
        <div className="scrub-grid" aria-hidden="true">
          {geo.lines.map((v) => (
            <span key={v} style={{ top: `${(yFrac(v) * 100).toFixed(2)}%` }}>
              <b>
                {formatCount(v)}
                {NB}m
              </b>
            </span>
          ))}
        </div>
        {climbs.map((c, n) => (
          <span
            key={n}
            className="scrub-band"
            aria-hidden="true"
            style={{ left: `${(xFrac(geo.d0 + c.startDistM) * 100).toFixed(2)}%`, width: `${((c.lengthM / total) * 100).toFixed(2)}%` }}
          />
        ))}
        <svg className="profile" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
          {bands.polygons.map((q, i) => (
            <polygon key={i} className={`g${q.cls}`} points={q.points} />
          ))}
          <path className="edge" vectorEffect="non-scaling-stroke" d={bands.edge} />
        </svg>
        {width > 0
          ? pins.map((q) => (
              <span
                key={q.text}
                className="scrub-pin"
                aria-hidden="true"
                style={{ '--pin': `var(--g${q.cls})`, left: Math.max(q.half, Math.min(width - q.half, q.x)), top: `${(q.y * 100).toFixed(2)}%` } as CSSProperties}
              >
                {q.text}
              </span>
            ))
          : null}
        <span
          className="scrub-line"
          aria-hidden="true"
          style={p ? { left: `${(xFrac(p.distM) * 100).toFixed(2)}%` } : undefined}
        />
        <span
          className="scrub-dot"
          aria-hidden="true"
          style={p ? { left: `${(xFrac(p.distM) * 100).toFixed(2)}%`, top: `${(yFrac(p.ele) * 100).toFixed(2)}%` } : undefined}
        />
        <div
          className="scrub-hit"
          role="slider"
          tabIndex={0}
          aria-label="Punto del perfil"
          aria-valuemin={0}
          aria-valuemax={Number((total / 1000).toFixed(1))}
          aria-valuenow={Number(((p ? p.distM - geo.d0 : prof[top].distM - geo.d0) / 1000).toFixed(1))}
          aria-valuetext={valueText}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            if (e.button > 0) return;
            dragging.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            fromPointer(e);
          }}
          onPointerMove={(e) => {
            if (dragging.current || e.pointerType === 'mouse') fromPointer(e);
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
        />
      </div>
      <div className="profile-axis scrub-axis" aria-hidden="true">
        <span>0</span>
        {geo.ticks.map((v) => (
          <span key={v} style={{ left: `${((v * 1000) / total) * 100}%` }}>
            {formatCount(v)}
          </span>
        ))}
        <span className="is-end">
          {fmtKm(total)}
          {NB}km
        </span>
      </div>
      <p className="legend" aria-hidden="true">
        {bands.present.map((c) => (
          <span key={c}>
            <i className={`sw sw-${c}`} />
            {GRADE_LABELS[c]}
          </span>
        ))}
      </p>
      <p className="scrub-hint">
        <Info className="ic" aria-hidden="true" />
        <span>Desliza el dedo por el perfil: el punto te sigue también en el mapa.</span>
      </p>
    </>
  );
});
