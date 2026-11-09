import { Link } from 'react-router-dom';
import type { EventGoal } from '../../domain/types';
import { Meter } from '../components/Meter';
import { ArrowDown, ArrowUp, ChevronRight, Flag, Target } from '../icons';
import { eventWhen, type VolumeGlance } from './inicioPlan';

/**
 * Objetivo de volumen, compacto, justo debajo de las cifras de la semana: lo hecho frente a la meta,
 * el medidor con la muesca del ritmo y cuánto vas por delante o por detrás, en km y no en puntos.
 */
export function GoalGlance({ id, glance }: { id: string; glance: VolumeGlance }) {
  const titleId = `${id}-t`;
  const Arrow = glance.dir === 'up' ? ArrowUp : ArrowDown;
  return (
    <section className="card goal" data-m="dist" aria-labelledby={titleId}>
      <div className="goal-h">
        <h2 className="glance-label" id={titleId}>
          <Target className="ic" aria-hidden="true" />
          {glance.title}
        </h2>
        <p className="goal-v">
          <span className="fig-i">{glance.done}</span>
          <span className="u">{glance.of}</span>
        </p>
      </div>
      <Meter
        value={glance.value}
        pace={glance.pace}
        label={glance.label}
        accent="dist"
        legend={
          <>
            <span>
              {glance.dir === 'flat' ? (
                glance.word
              ) : (
                <>
                  <span className={glance.dir === 'up' ? 'delta delta--up' : 'delta delta--down'}>
                    <Arrow className="ic" aria-hidden="true" />
                    {glance.diff}
                  </span>
                  {glance.word}
                </>
              )}
            </span>
            <span>{glance.left}</span>
          </>
        }
      />
    </section>
  );
}

/** Objetivo de evento: una fila que lleva a Objetivos. */
export function EventGoalRow({ goal, now }: { goal: EventGoal; now: number }) {
  return (
    <Link className="card goal-event press" to="/plan/objetivos" data-m="elev">
      <span className="row-lead" aria-hidden="true">
        <Flag className="ic" />
      </span>
      <span className="goal-event-main">
        <b dir="auto">{goal.title}</b>
        <span>{eventWhen(goal, now)}</span>
      </span>
      <ChevronRight className="chev" aria-hidden="true" />
    </Link>
  );
}
