import { memo } from 'react';
import type { Difficulty } from '../../metrics/reference';
import { DifficultyBars } from '../components/Chip';
import { ListRow } from '../components/ListRow';
import { formatDuration, formatMeters, formatNumber, formatSpeed } from '../format';
import { Bike, Mountain, Repeat } from '../icons';
import { fullDate, highlight, whenLabel, type RideItem } from './model';
import { RideThumb } from './RideThumb';

const TONE: Record<Difficulty, string> = { Suave: 'easy', Media: 'mid', Dura: 'hard' };

type Props = {
  item: RideItem;
  now: number;
  /** Lista sin meses (ordenada por otra cosa que la fecha): la fecha lleva el mes. */
  flat: boolean;
  /** Búsqueda normalizada, para resaltar lo encontrado en el nombre. */
  qn: string;
  repeated: boolean;
  /** Ordenada por velocidad: la velocidad a la vista. */
  showSpeed: boolean;
};

function Title({ name, qn }: { name: string; qn: string }) {
  const h = highlight(name, qn);
  if (!h) return <>{name}</>;
  const marked = (
    <>
      {h.lead}
      {h.before}
      <mark>{h.hit}</mark>
      {h.after}
    </>
  );
  if (!h.lead) return marked;
  // Recortado por delante: el lector de pantalla oye el nombre entero.
  return (
    <>
      <span aria-hidden="true">{marked}</span>
      <span className="sr-only">{name}</span>
    </>
  );
}

/**
 * Fila de una salida: forma (o bici si no hay GPS) con la insignia de ruta repetida, nombre en dos
 * líneas como mucho, cuándo y desnivel; a la derecha, km y, debajo, dificultad para ti y tiempo.
 */
export const RideRow = memo(function RideRow({ item, now, flat, qn, repeated, showSpeed }: Props) {
  const { act, name, level } = item;
  const t = act.totals;
  return (
    <ListRow
      to={`/historial/${encodeURIComponent(act.id)}`}
      lead={
        <>
          {act.hasTrack ? <RideThumb id={act.id} /> : <Bike className="ic" />}
          {repeated ? (
            <span className="rep-badge">
              <Repeat className="ic" />
            </span>
          ) : null}
        </>
      }
      title={
        <span dir="auto" title={name}>
          <Title name={name} qn={qn} />
        </span>
      }
      meta={
        <span className="ride-meta">
          <span className="when">
            {whenLabel(act.startTime, now, flat)}
            <span className="sr-only">, {fullDate(act.startTime)}</span>
          </span>
          <span data-m="elev">
            <Mountain className="ic" aria-hidden="true" />
            {formatMeters(t.elevGainM)}
          </span>
          {showSpeed ? <span data-m="speed">{formatSpeed(item.speedMs)}</span> : null}
          {act.hasTrack ? null : <span className="no-gps">Sin GPS</span>}
          {repeated ? <span className="sr-only">Ruta repetida</span> : null}
        </span>
      }
      trail={
        <span className="ride-figs">
          <span className="row-val">
            {formatNumber(t.distanceM / 1000, 1)}
            <span className="u"> km</span>
          </span>
          <span className="row-time">
            {level ? (
              <span className={`dif dif--${TONE[level]}`}>
                <DifficultyBars level={level} />
                <span className="sr-only">, {level.toLowerCase()} para ti, </span>
              </span>
            ) : null}
            {formatDuration(t.movingTimeS, 'short')}
          </span>
        </span>
      }
    />
  );
});
