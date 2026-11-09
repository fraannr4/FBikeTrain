import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import type { LatLng, StoredActivity, TrackPoint } from '../../domain/types';
import type { Difficulty } from '../../metrics/reference';
import { ProfileSvg } from '../charts/ProfileSvg';
import { rideDayLabel } from '../climbView';
import { formatCount, formatDuration, formatKm, formatMeters, formatSpeed } from '../format';
import { Bike, ChevronRight, Gauge, HeartPulse, MapPin, Mountain, Timer, Zap, type LucideIcon } from '../icons';
import { profileExtent, type ProfilePoint } from '../profile';
import { DifficultyChip } from './Chip';
import { Panel } from './Panel';
// RideMap ya va en el chunk de entrada (Salida, Rutas); Leaflet se descarga aparte, al pintar un mapa.
import { RideMap } from './RideMap';
import { ValueText } from './ValueText';


type GpsPoint = TrackPoint & LatLng;
const hasGps = (p: TrackPoint): p is GpsPoint => p.lat !== undefined && p.lng !== undefined;

type Stat = { key: string; label: string; icon: LucideIcon; accent?: string; value: string };

/**
 * `true` en cuanto el mapa de dentro de `ref` pinta su primera tesela. Hasta entonces (o sin
 * cobertura, con las teselas bloqueadas) el filtro oscuro y el tinte no tienen nada que oscurecer
 * y, solos, se verían como un bloque lavanda: se quedan ocultos y se ve el fondo del mapa.
 * El evento `load` de las imágenes no burbujea, pero sí pasa por la fase de captura.
 */
function useTilesLoaded(ref: RefObject<HTMLElement | null>, active: boolean): boolean {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el || loaded) return;
    if (el.querySelector('img.leaflet-tile-loaded')) {
      setLoaded(true);
      return;
    }
    const onLoad = (e: Event) => {
      if (e.target instanceof HTMLImageElement && e.target.classList.contains('leaflet-tile')) setLoaded(true);
    };
    el.addEventListener('load', onLoad, true);
    return () => el.removeEventListener('load', onLoad, true);
  }, [ref, active, loaded]);
  return loaded;
}

type Props = {
  activity: StoredActivity;
  /** Track de la salida; `null` mientras se lee. */
  track: TrackPoint[] | null;
  /** Perfil de altitud del track (el mismo que la cresta del hero). */
  profile: ProfilePoint[];
  /** Dificultad para ti, si hay referencia de nivel. */
  level: Difficulty | null;
  now: number;
};

/**
 * Tu última salida, como en inicio.html: mapa CyclOSM con el trazado luminoso y la dificultad, nombre,
 * fecha, cuatro cifras (pulso y potencia solo si el fichero los trae) y el perfil por pendiente.
 * Pulsar el mapa o «Ver salida» abre el detalle. Sin GPS, lo dice y no hay mapa ni perfil.
 */
export const RideMapCard = memo(function RideMapCard({ activity, track, profile, level, now }: Props) {
  const { totals } = activity;
  const gps = useMemo(() => (track ?? []).filter(hasGps), [track]);
  const extent = profileExtent(profile);
  const to = `/historial/${activity.id}`;
  const loading = activity.hasTrack && track === null;
  const withMap = activity.hasTrack && gps.length > 1;
  const mapRef = useRef<HTMLDivElement>(null);
  const tiles = useTilesLoaded(mapRef, withMap);

  const stats: Stat[] = [
    { key: 'dist', label: 'Distancia', icon: Bike, accent: 'dist', value: formatKm(totals.distanceM, 1) },
    { key: 'elev', label: 'Desnivel', icon: Mountain, accent: 'elev', value: formatMeters(totals.elevGainM) },
    { key: 'time', label: 'Tiempo en movimiento', icon: Timer, accent: 'time', value: formatDuration(totals.movingTimeS, 'short') },
    { key: 'speed', label: 'Velocidad media', icon: Gauge, accent: 'speed', value: formatSpeed(totals.avgSpeedMs) },
  ];
  if (totals.avgHr !== undefined && Number.isFinite(totals.avgHr))
    stats.push({ key: 'hr', label: 'Pulso medio', icon: HeartPulse, value: `${formatCount(Math.round(totals.avgHr))} ppm` });
  if (totals.avgPower !== undefined && Number.isFinite(totals.avgPower))
    stats.push({ key: 'power', label: 'Potencia media', icon: Zap, value: `${formatCount(Math.round(totals.avgPower))} W` });

  return (
    <Panel
      titleId="last-ride-title"
      title="Tu última salida"
      icon={MapPin}
      className="card--flush lastride"
      action={
        <Link className="card-link" to={to}>
          Ver salida
          <ChevronRight className="ic" aria-hidden="true" />
        </Link>
      }
    >
      {withMap || loading ? (
        <div ref={mapRef} className={tiles ? 'lastride-map has-tiles' : 'lastride-map'}>
          {withMap ? (
            <RideMap
              points={gps}
              label="Mapa de la última salida"
              interactive={false}
              attribution
              fitPadding={40}
              className="ride-map"
            />
          ) : null}
          {/* Todo el mapa abre la salida, como en el prototipo; el enlace con nombre es «Ver salida». */}
          <Link className="lastride-tap" to={to} tabIndex={-1} aria-hidden="true" />
          {level ? (
            <span className="lastride-level">
              <DifficultyChip level={level} />
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="lastride-body">
        {activity.name?.trim() ? <h3 className="lastride-name ride-name" dir="auto">{activity.name}</h3> : null}
        <p className="lastride-date">{rideDayLabel(activity.startTime, now)}</p>
        {!loading && !withMap ? <p className="lastride-nomap">Esta salida no tiene GPS, así que no tiene mapa.</p> : null}
        <dl className="lastride-stats">
          {stats.map(({ key, label, icon: Icon, accent, value }) => (
            <div className="lastride-stat" data-m={accent} key={key}>
              <dt>
                <Icon className="ic" aria-hidden="true" />
                <span className="sr-only">{label}</span>
              </dt>
              <dd className="stat-value">
                <ValueText value={value} />
              </dd>
            </div>
          ))}
        </dl>
        {withMap && extent ? (
          <>
            <p className="prof-h">
              <span>Perfil por pendiente</span>
              <span>
                cima <b className="fig fig-i">{formatCount(extent.max)}</b> m
              </span>
            </p>
            <ProfileSvg
              profile={profile}
              label={`Perfil de altitud: mínima ${formatMeters(extent.min)}, máxima ${formatMeters(extent.max)}`}
              axis="ticks"
              legend
            />
          </>
        ) : null}
      </div>
    </Panel>
  );
});
