import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PlannedWorkout } from '../../domain/types';
import { formatCount, formatDuration, formatNumber } from '../format';
import { Calendar, ChevronRight, Route } from '../icons';
import { useElementWidth } from '../hooks/useElementWidth';
import { dayMark, followUp } from './inicioPlan';

const TITLE_ID = 'inicio-proximo';
/** El tiempo estimado se redondea a 5 minutos: «unas 3 h 10», nunca «3 h 17». */
const ROUND_S = 300;

type Props = {
  /** Los dos próximos entrenos pendientes; vacío si no hay ninguno. */
  items: PlannedWorkout[];
  now: number;
  /** Tu velocidad media de las últimas semanas, para estimar el tiempo. */
  kmh: number | null;
};

/**
 * Próximo entreno (antes de salir): ficha de fecha, nombre, cifras y lo que hay que hacer para
 * llevarlo al ciclocomputador. El siguiente, en una línea al pie.
 *
 * Diferencia con el prototipo (inicio.html), pendiente de datos: sin miniatura de la forma, sin
 * chips de dificultad y de circular, y «Ruta y GPX» lleva a Rutas en vez de abrir la hoja del GPX.
 * Todo eso sale de la ruta del entreno, y `PlannedWorkout` no la tiene (solo nombre, km, desnivel y
 * notas). El prototipo no tiene fila de atajos: «Generar ruta» va fijo en la cabecera e «Importar»,
 * en «Tus datos».
 */
export function NextWorkout({ items, now, kmh }: Props) {
  const [next, after] = items;
  return (
    <section className="card next" data-m="time" aria-labelledby={TITLE_ID}>
      <div className="card-h">
        <span className="card-ic" aria-hidden="true">
          <Calendar className="ic" />
        </span>
        <h2 className="card-title" id={TITLE_ID}>
          Próximo entreno
        </h2>
        <Link className="card-link" to="/plan" aria-label="Ver el plan de entrenos">
          Plan
          <ChevronRight className="ic" aria-hidden="true" />
        </Link>
      </div>
      {next ? <Planned w={next} now={now} kmh={kmh} /> : <Nothing />}
      {after ? <FollowUp {...followUp(after, now)} /> : null}
    </section>
  );
}

function FollowUp({ when, title, km }: { when: string; title: string; km: string }) {
  return (
    <p className="card-foot">
      {when}: <bdi>{title}</bdi>
      {km}.
    </p>
  );
}

function Planned({ w, now, kmh }: { w: PlannedWorkout; now: number; kmh: number | null }) {
  const mark = dayMark(w.date, now);
  const est = w.distanceM && kmh && kmh > 0 ? Math.round((w.distanceM / 1000 / kmh) * 3600 / ROUND_S) * ROUND_S : null;
  return (
    <>
      <div className="next-main">
        <div className="hito-date" aria-hidden="true">
          <span className="hito-date-d">{mark.weekday}</span>
          <span className="hito-date-n">{mark.day}</span>
          <span className="hito-date-m">{mark.under}</span>
        </div>
        <div className="next-body">
          <p className="sr-only">{mark.spoken}</p>
          <Title text={w.title} />
          {w.distanceM || w.elevGainM || est ? (
            <p className="route-meta">
              {w.distanceM ? (
                <span>
                  <b>{formatNumber(w.distanceM / 1000)}</b> km
                </span>
              ) : null}
              {w.elevGainM ? (
                <span>
                  <b>{formatCount(w.elevGainM)}</b> m
                </span>
              ) : null}
              {est ? (
                <span>
                  unas <b>{formatDuration(est, 'short')}</b>
                </span>
              ) : null}
            </p>
          ) : null}
          {w.notes ? <p className="next-notes">{w.notes}</p> : null}
        </div>
      </div>
      <div className="btn-row next-actions">
        <Link className="btn btn--secondary" to="/plan">
          Ver en el plan
        </Link>
        <Link className="btn btn--primary" to="/rutas">
          <Route className="ic" aria-hidden="true" />
          Ruta y GPX
        </Link>
      </div>
    </>
  );
}

/**
 * Nombre del entreno: tres líneas como mucho. Si se corta, «Ver nombre entero» lo despliega (en el
 * teléfono no hay `title` que leer al pasar el ratón).
 */
function Title({ text }: { text: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const width = useElementWidth(ref);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    // Media línea de margen: un emoji alto estira la caja sin que falte texto.
    const half = (parseFloat(getComputedStyle(el).lineHeight) || 24) / 2;
    setCut(el.scrollHeight > el.clientHeight + half);
  }, [text, width, open]);

  return (
    <>
      <h3 ref={ref} id="inicio-proximo-nombre" dir="auto" className={open ? 'next-title is-open' : 'next-title'}>
        {text}
      </h3>
      {cut ? (
        <button
          type="button"
          className="next-more"
          aria-expanded={open}
          aria-controls="inicio-proximo-nombre"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Ver menos' : 'Ver nombre entero'}
        </button>
      ) : null}
    </>
  );
}

function Nothing() {
  return (
    <div className="next-empty">
      <p>No tienes salidas planificadas.</p>
      <Link className="btn btn--secondary" to="/plan">
        Ver calendario
      </Link>
    </div>
  );
}
