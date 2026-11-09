import { memo, useMemo } from 'react';
import { axisTicks } from '../components/ElevationProfile';
import { formatCount, formatKm } from '../format';
import type { ProfilePoint } from '../profile';
import { GRADE_LABELS, profileBands } from './grade';

const W = 320;

type Props = {
  /** Distancia acumulada y altura (de `profileFromTrack` o `reduceProfile`). */
  profile: ProfilePoint[];
  /** Lo que dice el perfil, completo: «Perfil de 87,6 km: sube a 980 m, la rampa más dura entre el 10 y el 16 %». */
  label: string;
  /** Leyenda con solo las pendientes que aparecen. */
  legend?: boolean;
  /** Distancia bajo el perfil: «0 km» y el total; con `'ticks'`, también los km redondos en su sitio. */
  axis?: boolean | 'ticks';
  /** Alto en px (72 por defecto). El ancho es el de su caja. */
  height?: number;
  className?: string;
};

/**
 * Perfil de altura coloreado por pendiente en seis tramos (`--g0` a `--g5`), como FBT.profile. Un
 * polígono por tramo seguido de la misma pendiente, la línea del perfil encima y, si se pide, la
 * leyenda con las pendientes presentes y el eje de distancia. Sin datos, un hueco con el motivo.
 */
export const ProfileSvg = memo(function ProfileSvg({ profile, label, legend, axis, height = 72, className }: Props) {
  const bands = useMemo(() => profileBands(profile, { width: W, height }), [profile, height]);
  if (!bands) {
    return (
      <div className="profile--empty" role="img" aria-label={label}>
        Sin perfil de altura
      </div>
    );
  }
  const total = profile[profile.length - 1].dM - profile[0].dM;
  return (
    <figure className={className ? `profile-fig ${className}` : 'profile-fig'}>
      <svg
        className="profile"
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        style={{ height }}
        role="img"
        aria-label={label}
      >
        {bands.polygons.map((p, i) => (
          <polygon key={i} className={`g${p.cls}`} points={p.points} />
        ))}
        <path className="edge" vectorEffect="non-scaling-stroke" d={bands.edge} />
      </svg>
      {axis === 'ticks' ? (
        <KmTicks totalM={total} />
      ) : axis ? (
        <div className="profile-axis" aria-hidden="true">
          <span>0 km</span>
          <span>{formatKm(total, total < 100_000 ? 1 : 0)}</span>
        </div>
      ) : null}
      {legend ? (
        <figcaption className="legend">
          <span className="sr-only">Pendientes:</span>
          {bands.present.map((c) => (
            <span key={c}>
              <i className={`sw sw-${c}`} aria-hidden="true" />
              {GRADE_LABELS[c]}
            </span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  );
});

/** Eje de km proporcional a la distancia: 0, los km redondos y el total al final. */
function KmTicks({ totalM }: { totalM: number }) {
  const km = totalM / 1000;
  const at = (v: number) => `${Math.round((v / km) * 10_000) / 100}%`;
  return (
    <div className="profile-axis profile-axis--ticks" aria-hidden="true">
      {[0, ...axisTicks(km)].map((v) => (
        <span key={v} style={{ left: at(v) }}>
          {formatCount(v)}
        </span>
      ))}
      <span className="is-end" style={{ left: '100%' }}>
        {formatKm(totalM, km < 100 && km % 1 !== 0 ? 1 : 0)}
      </span>
    </div>
  );
}
