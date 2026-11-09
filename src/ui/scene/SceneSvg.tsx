import { useId, useMemo, type CSSProperties } from 'react';
import { sceneLayout, type Scene, type SceneInput } from './scene';

type Props = SceneInput & {
  /** Estado vacío: la línea de luz es decorado, más tenue y sin hilo. */
  still?: boolean;
  /** Paisaje ya calculado (el hero lo necesita también para colocar el rótulo de la cima). */
  scene?: Scene | null;
};

const SKY: [number, string][] = [
  [0, '--sky-0'],
  [0.34, '--sky-1'],
  [0.6, '--sky-2'],
  [0.82, '--sky-3'],
  [1, '--sky-4'],
];

const stop = (token: string, opacity = 1): CSSProperties => ({ stopColor: `var(${token})`, stopOpacity: opacity });

/**
 * Paisaje del hero, a sangre detrás de todo. De atrás adelante: cielo y bruma cálida,
 * estrellas, luna o sol tras la cima, cuatro crestas con su bruma, la cresta de tu última
 * salida con curvas de nivel, la carretera, la línea de luz y el velo tras el saludo.
 * Todo color sale de los tokens del paisaje, así que el tema cambia sin repintar.
 */
export function SceneSvg({ still = false, scene: given, ...input }: Props) {
  const uid = useId().replace(/:/g, '');
  const { profile, width, height, textBox, groundY, topbarBottom } = input;
  const computed = useMemo(
    () =>
      given === undefined && width > 0 && height > 0
        ? sceneLayout({ profile, width, height, textBox, groundY, topbarBottom })
        : null,
    [given, profile, width, height, textBox, groundY, topbarBottom],
  );
  const s = given ?? computed;
  if (!s || width <= 0 || height <= 0) return null;

  const id = (name: string) => `${uid}${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  const { near, orb, scrim } = s;

  return (
    <svg
      className="land"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={id('sky')} x1="0" y1="0" x2="0" y2={s.horizon} gradientUnits="userSpaceOnUse">
          {SKY.map(([o, t]) => (
            <stop key={t} offset={o} style={stop(t)} />
          ))}
        </linearGradient>
        <radialGradient id={id('glow')} cx={orb.x} cy={orb.y} r={orb.glowR} gradientUnits="userSpaceOnUse">
          <stop offset="0" style={stop('--orb-glow', 0.5)} />
          <stop offset="0.3" style={stop('--haze', 0.3)} />
          <stop offset="1" style={stop('--haze', 0)} />
        </radialGradient>
        <radialGradient id={id('orbh')} cx={orb.x} cy={orb.y} r={orb.r * 2.4} gradientUnits="userSpaceOnUse">
          <stop offset="0.4" style={stop('--orb', 0.45)} />
          <stop offset="1" style={stop('--orb', 0)} />
        </radialGradient>
        {s.layers.map((l, k) => (
          <linearGradient
            key={k}
            id={id(`mist${k}`)}
            x1="0"
            y1={l.mistTop}
            x2="0"
            y2={l.mistBottom}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" style={stop('--mist', 0)} />
            <stop offset="1" style={stop('--mist', l.mist)} />
          </linearGradient>
        ))}
        <linearGradient id={id('near')} x1="0" y1={near.summit.y} x2="0" y2={height} gradientUnits="userSpaceOnUse">
          <stop offset="0" style={stop('--ridge-near')} />
          <stop offset="0.78" style={stop('--ridge-near')} />
          <stop offset="1" style={stop('--surface')} />
        </linearGradient>
        <radialGradient id={id('scrim')} cx={scrim.x} cy={scrim.y} r={scrim.r} gradientUnits="userSpaceOnUse">
          <stop offset="0" style={stop('--hero-scrim', 0.95)} />
          <stop offset="0.55" style={stop('--hero-scrim', 0.55)} />
          <stop offset="1" style={stop('--hero-scrim', 0)} />
        </radialGradient>
      </defs>

      <rect width={width} height={height} fill={url('sky')} />

      <g className="land-stars">
        {s.stars.map((st, i) => (
          <circle key={i} cx={st.x.toFixed(1)} cy={st.y.toFixed(1)} r={st.r.toFixed(2)} fillOpacity={st.o.toFixed(2)} />
        ))}
      </g>

      <rect width={width} height={height} fill={url('glow')} />
      <circle cx={orb.x} cy={orb.y} r={orb.r * 2.4} fill={url('orbh')} />
      <circle className="land-orb" cx={orb.x} cy={orb.y} r={orb.r} />

      {s.layers.map((l, k) => (
        <g key={k}>
          <path d={l.d} style={{ fill: `var(--ridge-${k + 1})` }} />
          <path className="land-edge" d={l.line} strokeOpacity={0.08 + k * 0.03} />
          <rect y={l.mistTop} width={width} height={Math.max(0, height - l.mistTop)} fill={url(`mist${k}`)} />
        </g>
      ))}

      <path d={near.fill} fill={url('near')} />
      <g className="land-contours">
        {near.contours.map((d, k) => (
          <path key={k} d={d} strokeOpacity={1 - k * 0.08} />
        ))}
      </g>

      <g className="land-road">
        <path className="road-edge" d={s.road.edge} />
        <path className="road-body" d={s.road.body} />
        {s.road.dash ? <path className="road-dash" d={s.road.dash} /> : null}
      </g>

      <g className={still ? 'ridge-light still' : 'ridge-light'}>
        <path className="ridge-halo" d={near.line} pathLength={1} />
        <path className="ridge-core" d={near.line} pathLength={1} />
        {still ? null : <path className="ridge-thread" d={near.line} pathLength={1} />}
      </g>

      <rect width={width} height={height} fill={url('scrim')} />
    </svg>
  );
}
