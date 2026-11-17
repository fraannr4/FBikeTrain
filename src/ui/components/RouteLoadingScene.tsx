import { useEffect, useId, useRef } from 'react';
import './RouteLoadingScene.css';

const INITIAL_PHASE = .7;
const CADENCE_RPM = 66;

/** Dos segmentos de longitud fija mantienen rodilla y tobillo unidos al pedal. */
function legPose(angle: number) {
  const hip = { x: 159, y: 113 };
  const ankle = { x: 166 + 12 * Math.cos(angle), y: 175 + 12 * Math.sin(angle) };
  const dx = ankle.x - hip.x, dy = ankle.y - hip.y, distance = Math.hypot(dx, dy);
  const thigh = 45, shin = 46;
  const along = (thigh * thigh - shin * shin + distance * distance) / (2 * distance);
  const across = Math.sqrt(Math.max(0, thigh * thigh - along * along));
  const knee = { x: hip.x + along * dx / distance + across * dy / distance, y: hip.y + along * dy / distance - across * dx / distance };
  const f = (n: number) => n.toFixed(2);
  return {
    thigh: `M${hip.x} ${hip.y}L${f(knee.x)} ${f(knee.y)}`,
    shin: `M${f(knee.x)} ${f(knee.y)}L${f(ankle.x)} ${f(ankle.y)}`,
    short: `M${hip.x} ${hip.y}L${f(hip.x + (knee.x - hip.x) * .39)} ${f(hip.y + (knee.y - hip.y) * .39)}`,
    sock: `M${f(ankle.x + (knee.x - ankle.x) * .22)} ${f(ankle.y + (knee.y - ankle.y) * .22)}L${f(ankle.x)} ${f(ankle.y)}`,
    shoe: `translate(${f(ankle.x)} ${f(ankle.y + 1)}) rotate(-5)`,
  };
}

const initialFront = legPose(INITIAL_PHASE);
const initialBack = legPose(INITIAL_PHASE + Math.PI);

function legParts(group: SVGGElement) {
  return {
    thigh: group.querySelector<SVGPathElement>('[data-thigh]')!,
    shin: group.querySelector<SVGPathElement>('[data-shin]')!,
    short: group.querySelector<SVGPathElement>('[data-short]')!,
    sock: group.querySelector<SVGPathElement>('[data-sock]'),
    shoe: group.querySelector<SVGGElement>('[data-shoe]')!,
  };
}

function drawLeg(parts: ReturnType<typeof legParts>, angle: number) {
  const pose = legPose(angle);
  parts.thigh.setAttribute('d', pose.thigh);
  parts.shin.setAttribute('d', pose.shin);
  parts.short.setAttribute('d', pose.short);
  parts.sock?.setAttribute('d', pose.sock);
  parts.shoe.setAttribute('transform', pose.shoe);
}

/** Ilustración decorativa: no calcula progreso ni retrasa el resultado de una búsqueda. */
export function RouteLoadingScene() {
  const svgRef = useRef<SVGSVGElement>(null);
  const id = `route-scene-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const terrain = svg.querySelector<SVGGElement>('[data-terrain]')!;
    const frontWheel = svg.querySelector<SVGGElement>('[data-wheel="front"]')!;
    const backWheel = svg.querySelector<SVGGElement>('[data-wheel="back"]')!;
    const crank = svg.querySelector<SVGGElement>('[data-crank]')!;
    const front = legParts(svg.querySelector<SVGGElement>('[data-leg="front"]')!);
    const back = legParts(svg.querySelector<SVGGElement>('[data-leg="back"]')!);
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let phase = INITIAL_PHASE;
    let travel = 0;
    let previous: number | null = null;
    let frame: number | null = null;
    let disposed = false;
    const canAnimate = () => !disposed && !document.hidden && !media?.matches;
    const draw = () => {
      drawLeg(front, phase);
      drawLeg(back, phase + Math.PI);
      crank.setAttribute('transform', `rotate(${phase * 180 / Math.PI})`);
      const rotation = `rotate(${phase * 1.9 * 180 / Math.PI})`;
      frontWheel.setAttribute('transform', rotation);
      backWheel.setAttribute('transform', rotation);
      terrain.setAttribute('transform', `translate(${-travel % 390} 0)`);
    };
    const tick = (now: number) => {
      frame = null;
      if (!canAnimate()) return;
      const delta = previous === null ? 0 : Math.min((now - previous) / 1000, .04);
      previous = now;
      phase += delta * CADENCE_RPM * Math.PI / 30;
      travel += delta * 11;
      draw();
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      previous = null;
      if (canAnimate()) frame = requestAnimationFrame(tick);
    };
    draw();
    sync();
    document.addEventListener('visibilitychange', sync);
    media?.addEventListener('change', sync);
    return () => {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', sync);
      media?.removeEventListener('change', sync);
    };
  }, []);

  return <div className="route-loading-scene">
    <svg ref={svgRef} className="route-loading-scene__svg" viewBox="0 0 390 254" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-jersey`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--cv-highlight)" /><stop offset=".5" stopColor="var(--cv-jersey)" /><stop offset="1" stopColor="var(--cv-shade)" /></linearGradient>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="white" stopOpacity=".15" /><stop offset=".38" stopColor="white" /><stop offset="1" stopColor="white" stopOpacity=".75" /></linearGradient>
        <mask id={`${id}-mask`}><rect width="390" height="254" fill={`url(#${id}-fade)`} /></mask>
        <g id={`${id}-tile`} fill="none" stroke="var(--cv-contour)" strokeWidth=".8" opacity=".5">
          <path fill="none" d="M0 119C50 119 50 31 120 39S180 134 250 109C310 84 340 119 390 119" />
          <path fill="none" d="M0 130C50 130 50 42 120 50S180 145 250 120C310 95 340 130 390 130" />
          <path fill="none" d="M0 141C50 141 50 53 120 61S180 156 250 131C310 106 340 141 390 141" />
          <path fill="none" d="M0 152C50 152 50 64 120 72S180 167 250 142C310 117 340 152 390 152" />
          <path fill="none" d="M0 163C50 163 50 75 120 83S180 178 250 153C310 128 340 163 390 163" />
          <path fill="none" d="M0 174C50 174 50 86 120 94S180 189 250 164C310 139 340 174 390 174" />
          <path fill="none" d="M0 185C50 185 50 97 120 105S180 200 250 175C310 150 340 185 390 185" />
          <path fill="none" d="M0 196C50 196 50 108 120 116S180 211 250 186C310 161 340 196 390 196" />
          <path fill="none" d="M0 207C50 207 50 119 120 127S180 222 250 197C310 172 340 207 390 207" />
          <path fill="none" d="M0 218C50 218 50 130 120 138S180 233 250 208C310 183 340 218 390 218" />
          <path fill="none" d="M0 229C50 229 50 141 120 149S180 244 250 219C310 194 340 229 390 229" />
        </g>
      </defs>
      <g mask={`url(#${id}-mask)`}><g data-terrain=""><use href={`#${id}-tile`} /><use href={`#${id}-tile`} x="390" /><use href={`#${id}-tile`} x="780" /></g></g>
      <path className="cv-small-route" d="M-20 79C30 80 46 17 90 24S132 66 166 52S190 24 226 28" strokeDasharray="2 5" />
      <g transform="rotate(-5 185 216)">
        <path d="M-30 219H430" stroke="var(--cv-paper)" strokeWidth="14" />
        <path d="M-30 216.5H430" stroke="var(--cv-blue)" strokeWidth="2" />
        <ellipse cx="178" cy="215" rx="90" ry="3" fill="var(--cv-ink)" opacity=".065" />
        <g>
          <g data-leg="back"><path data-thigh="" d={initialBack.thigh} fill="none" stroke="var(--cv-skin-shade)" strokeWidth="12" strokeLinecap="round" /><path data-shin="" d={initialBack.shin} fill="none" stroke="var(--cv-skin-shade)" strokeWidth="8" strokeLinecap="round" /><path data-short="" d={initialBack.short} fill="none" stroke="var(--cv-kit)" strokeWidth="15" strokeLinecap="round" /><g data-shoe="" transform={initialBack.shoe}><path d="M-8-2L4-3L13 1Q17 5 11 6H-8Z" fill="var(--cv-carbon)" /><path d="M-8 6H13" stroke="var(--cv-paper)" strokeWidth="1.5" /></g></g>
          <g><circle className="cv-tyre" cx="112" cy="181" r="34" /><circle className="cv-rim" cx="112" cy="181" r="31" /><g transform="translate(112 181)"><g data-wheel="back" className="cv-spokes"><path d="M-30 0H30M0-30V30M-21-21L21 21M-21 21L21-21" /></g></g><circle cx="112" cy="181" r="3" fill="var(--cv-carbon)" /></g>
          <g><circle className="cv-tyre" cx="245" cy="181" r="34" /><circle className="cv-rim" cx="245" cy="181" r="31" /><g transform="translate(245 181)"><g data-wheel="front" className="cv-spokes"><path d="M-30 0H30M0-30V30M-21-21L21 21M-21 21L21-21" /></g></g><circle cx="245" cy="181" r="3" fill="var(--cv-carbon)" /></g>
          <path d="M112 181L157 126L170 180Z" fill="none" stroke="var(--cv-carbon)" strokeWidth="3.2" strokeLinejoin="round" />
          <path d="M157 127L213 127L170 180Z" fill="none" stroke="var(--cv-carbon)" strokeWidth="5" strokeLinejoin="round" />
          <path d="M174 175L211 133" stroke="var(--cv-blue)" strokeWidth="2.2" />
          <path d="M214 128L220 146L245 181" fill="none" stroke="var(--cv-carbon)" strokeWidth="3.8" strokeLinejoin="round" />
          <path d="M156 127L151 112" stroke="var(--cv-carbon)" strokeWidth="3.4" />
          <path d="M140 112Q147 109 161 112L164 114H143Z" fill="var(--cv-carbon)" />
          <path d="M213 128L208 113L224 109Q235 108 235 117Q235 124 228 125" fill="none" stroke="var(--cv-carbon)" strokeWidth="3" strokeLinecap="round" />
          <path d="M224 109Q235 108 235 117Q235 124 228 125" fill="none" stroke="var(--cv-muted)" strokeWidth="2" strokeLinecap="round" />
          <path d="M112 181L169 175M112 183L169 185" stroke="var(--cv-muted)" strokeWidth=".7" />
          <circle cx="170" cy="180" r="9" fill="var(--cv-carbon)" /><circle cx="170" cy="180" r="5.8" fill="var(--cv-paper)" /><g transform="translate(170 180)"><g data-crank=""><path d="M-12 0H12" stroke="var(--cv-carbon)" strokeWidth="2.5" /></g></g>
          <path d="M187 80L203 96L224 110" fill="none" stroke="var(--cv-skin-shade)" strokeWidth="7" strokeLinecap="round" />
          <g>
            <path d="M150 104Q146 113 152 121L164 126L176 111L164 100Z" fill="var(--cv-kit)" />
            <path d="M151 105Q151 95 164 85L182 72Q188 68 195 75L202 84L186 96L171 113Q162 113 151 105Z" fill={`url(#${id}-jersey)`} />
            <path d="M156 99Q169 86 184 77" fill="none" stroke="var(--cv-highlight)" strokeWidth="1.5" opacity=".7" />
            <path d="M177 99L184 91" stroke="var(--cv-paper)" strokeWidth="2.2" opacity=".8" />
            <path d="M195 80L210 92L226 108" fill="none" stroke="var(--cv-skin)" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M193 77L200 84" stroke="var(--cv-jersey)" strokeWidth="11" />
            <path d="M225 107L231 110L229 114" fill="none" stroke="var(--cv-carbon)" strokeWidth="4" strokeLinecap="round" />
            <path d="M190 74L198 63" stroke="var(--cv-skin-shade)" strokeWidth="8" />
            <path d="M197 48Q207 42 214 50L218 60L212 61L211 69L203 70L198 64Z" fill="var(--cv-skin)" />
            <path d="M201 56L217 54L217 59L204 61Z" fill="var(--cv-carbon)" />
            <path d="M193 53Q190 44 201 40Q212 36 220 49L220 52L205 51L199 56Z" fill="var(--cv-paper)" stroke="var(--cv-carbon)" strokeWidth="1.3" />
            <path d="M198 48L203 43M204 48L209 42M210 48L214 45" stroke="var(--cv-carbon)" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M199 57L204 66L210 67" fill="none" stroke="var(--cv-carbon)" strokeWidth=".9" />
          </g>
          <g data-leg="front"><path data-thigh="" d={initialFront.thigh} fill="none" stroke="var(--cv-skin)" strokeWidth="13" strokeLinecap="round" /><path data-shin="" d={initialFront.shin} fill="none" stroke="var(--cv-skin)" strokeWidth="8.5" strokeLinecap="round" /><path data-short="" d={initialFront.short} fill="none" stroke="var(--cv-kit)" strokeWidth="15" strokeLinecap="round" /><path data-sock="" d={initialFront.sock} fill="none" stroke="var(--cv-paper)" strokeWidth="8.5" strokeLinecap="butt" /><g data-shoe="" transform={initialFront.shoe}><path d="M-8-2L4-3L13 1Q17 5 11 6H-8Z" fill="var(--cv-carbon)" /><path d="M-8 6H13" stroke="var(--cv-paper)" strokeWidth="1.5" /><path d="M0-1L5 1" stroke="var(--cv-muted)" strokeWidth="1" /></g></g>
        </g>
      </g>
    </svg>
  </div>;
}
