import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { accentVar, type Accent } from '../accent';
import { ValueText } from '../components/ValueText';
import { formatDeltaPct } from '../format';
import { useElementWidth } from '../hooks/useElementWidth';
import { ArrowDown, ArrowUp, Minus, TrendingUp, type LucideIcon } from '../icons';
import { Sparkline } from './Sparkline';

type Props = {
  label: string;
  icon: LucideIcon;
  accent: Accent;
  /** Cifra con su unidad, ya formateada: «88 km». */
  value: string;
  /** Variación frente a la referencia, en %. `null` sin referencia. */
  delta: number | null;
  /** Frente a qué se mide `delta`, para el lector de pantalla: «frente a tus semanas a estas alturas». */
  deltaRef?: string;
  /** Nota cuando no hay variación: «Tu media: 24,6 km/h», «Sin referencia aún». */
  note?: string;
  /** Las 8 últimas semanas, de la más antigua a esta. Sin ella, la tarjeta es compacta (prototipo móvil). */
  spark?: number[];
  sparkMean?: number;
  selected: boolean;
  /** Elegida sin que el usuario haya tocado nada (la de partida): se marca sin borde de color. */
  quiet?: boolean;
  onSelect: () => void;
  /** Id de la gráfica que controla («Tu progresión»). */
  controls?: string;
  describedBy?: string;
};

/**
 * KPI de vidrio sobre el paisaje. Es un botón: elige la métrica de «Tu progresión».
 * Subir va en `--good` con flecha y signo; bajar, en `--ink-2`, nunca en rojo.
 */
export function KpiCard({
  label,
  icon: Icon,
  accent,
  value,
  delta,
  deltaRef = 'vs tu media',
  note,
  spark,
  sparkMean,
  selected,
  quiet = false,
  onSelect,
  controls = 'progreso',
  describedBy,
}: Props) {
  const rowRef = useRef<HTMLSpanElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const fit = useFit(rowRef, valueRef, !spark, `${value}|${delta}|${note}`);
  return (
    <button
      type="button"
      className={spark ? 'kpi press' : 'kpi kpi--compact press'}
      aria-pressed={selected}
      aria-controls={controls}
      aria-describedby={describedBy}
      data-quiet={quiet && selected ? '' : undefined}
      style={{ '--acc': accentVar(accent), '--fit': fit } as CSSProperties}
      onClick={onSelect}
    >
      <span className="kpi-h">
        <span className="kpi-ic">
          <Icon size={18} strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="kpi-label">{label}</span>
        <span className="kpi-on" aria-hidden="true">
          <TrendingUp size={15} strokeWidth={2} />
        </span>
      </span>
      <span className="kpi-row" ref={rowRef}>
        <span className="kpi-value fig-i" ref={valueRef}>
          <ValueText value={value} />
        </span>
        {delta !== null ? <Delta pct={delta} refText={deltaRef} /> : note ? <span className="kpi-note">{note}</span> : null}
      </span>
      {spark ? <Sparkline values={spark} mean={sparkMean} /> : null}
    </button>
  );
}

/** Hueco entre la cifra y su diferencia (`.kpi--compact .kpi-row`). */
const GAP_PX = 6;
/** Por debajo, la diferencia baja de línea en vez de encoger más la cifra. */
const MIN_FIT = 0.72;

/**
 * Escala de la cifra para que quepa con su diferencia en una línea (como en el prototipo): con
 * «11.810 m» a 360 px, la cifra encoge en vez de bajar la diferencia y descuadrar la fila de tarjetas.
 * El ancho natural es el medido dividido por la escala actual; una pasada basta.
 */
function useFit(
  rowRef: RefObject<HTMLSpanElement>,
  valueRef: RefObject<HTMLSpanElement>,
  active: boolean,
  content: string,
): number {
  const width = useElementWidth(rowRef);
  const [fit, setFit] = useState(1);
  // La cifra cambia de ancho cuando llega la fuente de dorsal.
  const [fonts, setFonts] = useState(0);
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => alive && setFonts((n) => n + 1));
    return () => {
      alive = false;
    };
  }, []);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const v = valueRef.current;
    if (!active || !row || !v) return;
    const note = v.nextElementSibling;
    const avail = row.clientWidth - (note ? note.getBoundingClientRect().width + GAP_PX : 0);
    const natural = v.getBoundingClientRect().width / fit;
    if (!natural || avail <= 0) return;
    const next = Math.max(MIN_FIT, Math.min(1, Math.floor((avail / natural) * 100) / 100));
    if (next !== fit) setFit(next);
  }, [rowRef, valueRef, active, content, width, fonts, fit]);

  return fit;
}

function Delta({ pct, refText }: { pct: number; refText: string }) {
  const r = Math.round(pct);
  const dir = r > 0 ? 'up' : r < 0 ? 'down' : 'flat';
  const Arrow = r > 0 ? ArrowUp : r < 0 ? ArrowDown : Minus;
  const text = formatDeltaPct(pct);
  return (
    <span className={`kpi-note delta ${dir}`}>
      <Arrow size={14} strokeWidth={2.5} aria-hidden="true" />
      <span className="delta-short" aria-hidden="true">
        {text}
      </span>
      <span className="delta-full">{`${text} ${refText}`}</span>
    </span>
  );
}
