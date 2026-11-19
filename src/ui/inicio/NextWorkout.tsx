import { Link } from 'react-router-dom';
import type { PlannedWorkout } from '../../domain/types';
import { formatCount, formatDuration, formatNumber } from '../format';
import { dayMark } from './inicioPlan';

/** El tiempo estimado se redondea a 5 minutos: «unas 3 h 10», nunca «3 h 17». */
const ROUND_S = 300;

type Props = {
  /** Los próximos entrenos pendientes; vacío si no hay ninguno. Se enseña el primero. */
  items: PlannedWorkout[];
  now: number;
  /** Tu velocidad media de las últimas semanas, para estimar el tiempo. */
  kmh: number | null;
};

/**
 * «Hoy» (lámina de distribución, 2026-11-19): el próximo entreno en una línea, sin caja. El hito de
 * fecha del Plan, el nombre y sus cifras (el enlace al Plan, donde están las notas y el siguiente) y
 * «Ruta y GPX». «Ruta y GPX» lleva a Rutas: `PlannedWorkout` no guarda su ruta.
 */
export function NextWorkout({ items, now, kmh }: Props) {
  const [next] = items;
  return (
    <section className={next ? 'today' : 'today today--empty'} aria-label="Próximo entreno">
      {next ? <Planned w={next} now={now} kmh={kmh} /> : <Nothing />}
    </section>
  );
}

function Planned({ w, now, kmh }: { w: PlannedWorkout; now: number; kmh: number | null }) {
  const mark = dayMark(w.date, now);
  const est = w.distanceM && kmh && kmh > 0 ? Math.round((w.distanceM / 1000 / kmh) * 3600 / ROUND_S) * ROUND_S : null;
  const km = w.distanceM ? formatNumber(w.distanceM / 1000) : null;
  const m = w.elevGainM ? formatCount(w.elevGainM) : null;
  const time = est ? formatDuration(est, 'short') : null;
  const spoken = [km && `${km} km`, m && `${m} m de desnivel`, time && `unas ${time}`].filter(Boolean);
  return (
    <>
      <div className="hito-date" aria-hidden="true">
        <span className="hito-date-d">{mark.weekday}</span>
        <span className="hito-date-n">{mark.day}</span>
        <span className="hito-date-m">{mark.under}</span>
      </div>
      <Link
        className="today-main"
        to="/plan"
        aria-label={`${mark.spoken}: ${[w.title, ...spoken].join(', ')}. Ver en el plan`}
      >
        <span className="today-title" dir="auto">
          {w.title}
        </span>
        {spoken.length > 0 ? (
          <span className="route-meta">
            {km ? (
              <span>
                <b>{km}</b> km
              </span>
            ) : null}
            {m ? (
              <span>
                <b>{m}</b> m
              </span>
            ) : null}
            {time ? (
              <span>
                unas <b>{time}</b>
              </span>
            ) : null}
          </span>
        ) : null}
      </Link>
      <Link className="btn btn--primary" to="/rutas">
        Ruta y GPX
      </Link>
    </>
  );
}

function Nothing() {
  return (
    <>
      <p className="today-none">No tienes salidas planificadas.</p>
      <Link className="btn btn--secondary" to="/plan">
        Ver calendario
      </Link>
    </>
  );
}
