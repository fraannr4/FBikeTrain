import { useId, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { EventGoal, LocalDate } from '../../domain/types';
import type { GoalProgress } from '../../metrics/calendar';
import { diffDays } from '../calendarGrid';
import { Meter } from '../components/Meter';
import { daysAgoLabel, formatCount } from '../format';
import { Bike, Calendar, ChevronDown, ChevronRight, Flag, Mountain } from '../icons';
import { eventDate, full, pctText } from './model';

type Props = {
  goal: EventGoal;
  progress: GoalProgress;
  today: LocalDate;
  /** Entrenos pendientes desde hoy hasta la marcha. */
  planned: number;
  onNext: () => void;
};

const km = (m: number): string => formatCount(m / 1000);

/**
 * El evento en una fila compacta (objetivos.html): la cuenta atrás en un hito, el nombre, la fecha y
 * cómo vas con tu salida más larga. Un toque despliega tus mejores salidas de las últimas 8 semanas
 * y los entrenos planificados hasta la marcha.
 */
export function EventCard({ goal, progress, today, planned, onNext }: Props) {
  const [open, setOpen] = useState(false);
  const moreId = useId();
  const n = diffDays(goal.date, today);
  const figs = [
    goal.distanceM ? full('distanceM', goal.distanceM) : '',
    goal.elevGainM ? full('elevGainM', goal.elevGainM) : '',
  ].filter(Boolean).join(', ');
  const date = eventDate(goal.date, today);

  const band = n > 0 ? (n === 1 ? 'falta' : 'faltan') : n === 0 ? 'hoy' : 'pasó';
  const said = n > 0 ? `${n === 1 ? 'Falta 1 día' : `Faltan ${n} días`}` : n === 0 ? 'Es hoy' : 'Ya pasó';
  const meta =
    n > 0
      ? `${date}${figs ? ` · ${figs}` : ''}`
      : n === 0
        ? `Hoy${figs ? ` · ${figs}` : ''}. Buena marcha.`
        : `Fue el ${date.charAt(0).toLowerCase()}${date.slice(1)}, ${daysAgoLabel(-n)}. Pon el siguiente.`;

  const { longest, mostClimb } = progress;
  const rowBest = goal.distanceM ? longest : undefined;
  const rowClimb = !goal.distanceM && goal.elevGainM ? mostClimb : undefined;

  return (
    <div className="card ev" data-m="dist">
      <button className="ev-row" type="button" aria-expanded={open} aria-controls={moreId} onClick={() => setOpen((o) => !o)}>
        <span className="hito-date" aria-hidden="true">
          <span className="hito-date-d">{band}</span>
          <span className={n > 99 ? 'hito-date-n hito-date-n--3' : 'hito-date-n'}>
            {n > 0 ? n : <Flag className="ic" />}
          </span>
        </span>
        <span className="ev-main">
          <span className="sr-only">{said}: </span>
          <span className="ev-name">{goal.title}</span>
          <span className="ev-meta">{meta}</span>
          {n > 0 && (rowBest || rowClimb) ? (
            <>
              <span
                className="meter ev-meter"
                aria-hidden="true"
                style={{ '--p': Math.min(1, (rowBest ?? rowClimb)!.pct / 100) } as CSSProperties}
              >
                <i />
              </span>
              <span className="ev-prep-l">
                {rowBest ? 'Tu salida más larga: ' : 'Tu salida con más desnivel: '}
                <b className="nw">
                  {rowBest
                    ? `${km(rowBest.distanceM)} de ${full('distanceM', goal.distanceM!)}`
                    : `${formatCount(rowClimb!.elevGainM)} de ${full('elevGainM', goal.elevGainM!)}`}
                </b>
              </span>
            </>
          ) : null}
        </span>
        <ChevronDown className="ev-chev" aria-hidden="true" />
      </button>
      <div className="ev-more" id={moreId} hidden={!open}>
        {n >= 0 ? (
          <>
            <div className="prep">
              <p className="prep-h">Tus mejores salidas de las últimas 8 semanas</p>
              {!longest && !mostClimb ? <p className="prep-none">Aún no hay salidas en estas 8 semanas.</p> : null}
              {goal.distanceM && longest ? (
                <div className="bar-row" data-m="dist">
                  <p className="bar-l">
                    <span>
                      <Bike className="ic" aria-hidden="true" />
                      La más larga
                    </span>
                    <span className="nw">
                      <b>{km(longest.distanceM)}</b> de {full('distanceM', goal.distanceM)}
                    </span>
                  </p>
                  <Meter
                    value={longest.pct / 100}
                    accent="dist"
                    label={`Tu salida más larga, ${km(longest.distanceM)} km, es el ${pctText(longest.pct)} % de la distancia de la marcha`}
                  />
                </div>
              ) : null}
              {goal.elevGainM && mostClimb ? (
                <div className="bar-row" data-m="elev">
                  <p className="bar-l">
                    <span>
                      <Mountain className="ic" aria-hidden="true" />
                      La de más desnivel
                    </span>
                    <span className="nw">
                      <b>{formatCount(mostClimb.elevGainM)}</b> de {full('elevGainM', goal.elevGainM)}
                    </span>
                  </p>
                  <Meter
                    value={mostClimb.pct / 100}
                    accent="elev"
                    label={`Tu salida con más desnivel, ${formatCount(mostClimb.elevGainM)} m, es el ${pctText(mostClimb.pct)} % del desnivel de la marcha`}
                  />
                </div>
              ) : null}
            </div>
            {n > 0 ? (
              <Link className="link-row" to="/plan">
                <Calendar className="ic" aria-hidden="true" />
                <span>
                  {planned > 0
                    ? `${planned} ${planned === 1 ? 'entreno planificado' : 'entrenos planificados'} hasta la marcha`
                    : 'Planifica entrenos hasta la marcha'}
                </span>
                <ChevronRight className="ic" aria-hidden="true" />
              </Link>
            ) : null}
          </>
        ) : (
          <>
            <p className="ev-note">Cuando importes la salida de ese día, la verás en tu historial.</p>
            <button className="btn btn--secondary btn--block" type="button" onClick={onNext}>
              <Flag className="ic" aria-hidden="true" />
              Poner el siguiente evento
            </button>
          </>
        )}
      </div>
    </div>
  );
}
