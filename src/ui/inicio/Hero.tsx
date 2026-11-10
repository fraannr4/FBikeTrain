import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useElementSize } from '../hooks/useElementWidth';
import { useDesktopLayout } from '../hooks/useDesktopLayout';
import { User } from '../icons';
import type { ProfilePoint } from '../profile';
import { SceneSvg } from '../scene/SceneSvg';
import { placeSummitLabel, sceneLayout, type SummitPlace } from '../scene/scene';
import { BrandMark } from '../shell/BrandMark';
import type { Notice } from './inicioNotices';
import { Notices } from './Notices';

type Rect = { x: number; y: number; w: number; h: number };
type Boxes = {
  textBox: { right: number; bottom: number };
  avoid: Rect[];
  groundY?: number;
  /** Pie del paisaje: un poco por debajo de las KPI. Lo que va detrás (la frase de la semana) queda sobre la página. */
  landBottom?: number;
  topbarBottom: number;
};

/** Lo que el paisaje baja por debajo de las KPI. */
const LAND_BELOW_KPIS = 16;

type Props = {
  greeting: string;
  date: string;
  /** La frase con la cifra en negrita. */
  sentence: ReactNode;
  /** Perfil de la cresta cercana: tu última salida o el decorado. */
  profile: ProfilePoint[];
  /** Cota y km de la cima de tu última salida; `null` con el decorado. */
  summitLabel: { ele: string; km: string } | null;
  notices: Notice[];
  avatarInitial?: string;
  /** Aviso en línea bajo la frase («Última importación hace N días»). */
  notice?: ReactNode;
  /** Botón bajo la frase (estado vacío). */
  action?: ReactNode;
  empty?: boolean;
  /** Las KPI, apoyadas en el pie del paisaje. */
  children?: ReactNode;
  /**
   * Botones de la barra superior. Si se pasan, sustituyen a los avisos y al avatar: en el prototipo
   * móvil la barra lleva «Generar ruta», y los avisos de importar y copiar viven en «Tus datos».
   */
  actions?: ReactNode;
};

function rel(r: DOMRect, hr: DOMRect): Rect {
  return { x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height };
}

/** Cajas de las líneas de texto reales (no la caja del bloque), relativas al hero. */
function textLines(node: Element, hr: DOMRect): Rect[] {
  const out: Rect[] = [];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let tn = walker.nextNode(); tn; tn = walker.nextNode()) {
    if (!tn.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(tn);
    for (const c of Array.from(range.getClientRects())) if (c.width > 0) out.push(rel(c, hr));
  }
  // Botones y enlaces del bloque (el de importar en el estado vacío) también cuentan.
  for (const el of Array.from(node.querySelectorAll('a, button'))) out.push(rel(el.getBoundingClientRect(), hr));
  return out;
}

const sameBoxes = (a: Boxes | null, b: Boxes) => a !== null && JSON.stringify(a) === JSON.stringify(b);

/**
 * Hero de Inicio: el paisaje a sangre detrás del saludo, la barra superior y las KPI. La
 * cresta cercana es el perfil de tu última salida y su cima lleva un rótulo HTML, colocado
 * donde no choque con el texto ni con la barra superior.
 */
export function Hero({
  greeting,
  date,
  sentence,
  profile,
  summitLabel,
  notices,
  avatarInitial,
  notice,
  action,
  empty = false,
  children,
  actions,
}: Props) {
  const heroRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const actsRef = useRef<HTMLDivElement>(null);
  const summitRef = useRef<HTMLSpanElement>(null);
  const { width, height } = useElementSize(heroRef);
  const desktop = useDesktopLayout();
  const [boxes, setBoxes] = useState<Boxes | null>(null);
  const [placed, setPlaced] = useState<SummitPlace | null>(null);

  // Mide el texto, la barra y las KPI tras cada pintado; solo vuelve a pintar si algo cambió.
  useLayoutEffect(() => {
    const hero = heroRef.current;
    const copy = copyRef.current;
    if (!hero || !copy || width === 0) return;
    const hr = hero.getBoundingClientRect();
    const lines = textLines(copy, hr);
    const acts = actsRef.current ? rel(actsRef.current.getBoundingClientRect(), hr) : null;
    const kpis = hero.querySelector('.kpis');
    const kpiRect = kpis ? rel(kpis.getBoundingClientRect(), hr) : null;
    const next: Boxes = {
      textBox: {
        right: Math.round(Math.max(0, ...lines.map((l) => l.x + l.w))),
        bottom: Math.round(Math.max(0, ...lines.map((l) => l.y + l.h))),
      },
      avoid: [...lines, ...(acts ? [acts] : []), ...(kpiRect ? [kpiRect] : [])].map((r) => ({
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.w),
        h: Math.round(r.h),
      })),
      groundY: kpiRect && kpiRect.h > 0 ? Math.round(kpiRect.y) : undefined,
      landBottom: kpiRect && kpiRect.h > 0 ? Math.round(kpiRect.y + kpiRect.h + LAND_BELOW_KPIS) : undefined,
      topbarBottom: acts ? Math.round(acts.y + acts.h) : 0,
    };
    setBoxes((prev) => (sameBoxes(prev, next) ? prev : next));
  });

  // El paisaje llega hasta el pie de las KPI; sin KPI (estado vacío), hasta el pie del hero.
  const landH = boxes?.landBottom ? Math.min(boxes.landBottom, height) : height;
  const scene = useMemo(
    () =>
      boxes && width > 0 && landH > 0
        ? sceneLayout({
            profile,
            width,
            height: landH,
            textBox: boxes.textBox,
            groundY: boxes.groundY,
            topbarBottom: boxes.topbarBottom,
          })
        : null,
    [boxes, profile, width, landH],
  );

  // El rótulo se mide ya pintado y se coloca a un lado de la cima o encima.
  useLayoutEffect(() => {
    const label = summitRef.current;
    if (!scene || !boxes || !label) return;
    const { summit, points } = scene.near;
    // La cresta también es un obstáculo, salvo la ladera junto a la cima, que cae bajo el rótulo: el
    // filo y todo el monte que hay debajo, para que el rótulo no quede cruzado por la línea de luz.
    const ridge = points
      .filter(([x]) => Math.abs(x - summit.x) > 60)
      .map(([x, y]) => ({ x: x - 1, y: y - 2, w: 2, h: Math.max(2, landH - y) }));
    // Las dos medidas del rótulo: en una línea y estrecho (en dos), con la clase puesta un momento.
    const wasNarrow = label.classList.contains('is-narrow');
    label.classList.remove('is-narrow');
    const wide = { w: label.offsetWidth, h: label.offsetHeight };
    label.classList.add('is-narrow');
    const narrow = { w: label.offsetWidth, h: label.offsetHeight };
    if (!wasNarrow) label.classList.remove('is-narrow');
    let next = placeSummitLabel(summit, wide, [...boxes.avoid, ...ridge], width, narrow);
    // En el paisaje panorámico la cresta puede ocupar todo el espacio lateral. El halo
    // permite rotularla sin ocultar la cota; el saludo, las acciones y las KPI siguen protegidos.
    if (desktop && !next.fits) next = placeSummitLabel(summit, wide, boxes.avoid, width, narrow);
    setPlaced((prev) =>
      prev &&
      prev.side === next.side &&
      prev.fits === next.fits &&
      prev.narrow === next.narrow &&
      Math.round(prev.x) === Math.round(next.x) &&
      Math.round(prev.y) === Math.round(next.y)
        ? prev
        : next,
    );
  });

  return (
    <section
      ref={heroRef}
      className={empty ? 'hero hero-empty' : 'hero'}
      aria-label="Resumen de la semana"
      style={boxes?.landBottom ? ({ '--land-h': `${landH}px` } as CSSProperties) : undefined}
    >
      {scene ? (
        <SceneSvg
          scene={scene}
          still={empty}
          profile={profile}
          width={width}
          height={landH}
          textBox={boxes!.textBox}
        />
      ) : null}

      <div className="hero-top">
        <span className="m-brand">
          <BrandMark />
          <span className="m-brand-name">FBikeTrain</span>
        </span>
        <div className="acts" ref={actsRef}>
          {actions !== undefined ? (
            actions
          ) : (
            <>
              <Notices notices={notices} />
              <Link to="/ajustes" className="round avatar press" aria-label="Tu perfil">
                {avatarInitial ? avatarInitial : <User size={20} strokeWidth={2} aria-hidden="true" />}
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="hero-copy" ref={copyRef}>
        <p className="hero-date">{date}</p>
        <p className={greeting.length > 26 ? 'hello hello-long' : 'hello'}>{greeting}</p>
        <p className="sub">{sentence}</p>
        {notice}
        {action}
      </div>

      {summitLabel ? (
        <>
          {/* El vértice, siempre en la cima; la guía hacia el texto solo cuando va a un lado. */}
          {scene ? (
            <span
              className={placed ? 'summit-pin on' : 'summit-pin'}
              data-side={placed?.fits ? placed.side : 'up'}
              style={{ left: Math.round(scene.near.summit.x), top: Math.round(scene.near.summit.y - 9) }}
              aria-hidden="true"
            >
              <svg className="summit-vertex" width="16" height="16" viewBox="0 0 16 16" focusable="false">
                <path d="M8 1.5 14.6 13.5H1.4Z" />
                <circle cx="8" cy="9.4" r="1.8" />
              </svg>
              <span className="summit-lead" />
            </span>
          ) : null}
          {/* Sin sitio, queda solo el vértice: el texto sigue ahí, oculto, para medir siempre lo mismo. */}
          <span
            ref={summitRef}
            className={`summit-lbl${placed?.fits && scene ? ' on' : ''}${placed?.narrow ? ' is-narrow' : ''}`}
            data-side={placed?.side ?? 'right'}
            style={placed ? { left: Math.round(placed.x), top: Math.round(placed.y) } : undefined}
            aria-hidden={placed && !placed.fits ? true : undefined}
          >
            <b>{summitLabel.ele}</b>
            <span>cima de tu última salida, en el km {summitLabel.km}</span>
          </span>
        </>
      ) : null}

      {children}
    </section>
  );
}
