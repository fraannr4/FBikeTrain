import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteGoal, listGoals, listWorkouts, saveGoal } from '../../calendar/calendarRepo';
import { listActivities } from '../../db/repo';
import type { Goal, PlannedWorkout, StoredActivity, VolumeGoal } from '../../domain/types';
import { goalProgress, localDay, volumeProgress } from '../../metrics/calendar';
import { Calendar, CircleAlert, Flag, Pencil, Plus, RefreshCw, Target } from '../icons';
import { GoalForm, type GoalKind } from '../components/GoalForm';
import { List, ListRow } from '../components/ListRow';
import { Page } from '../components/Page';
import { SegmentedNav } from '../components/SegmentedControl';
import { StateView } from '../components/StateView';
import { useToast } from '../components/Toast';
import { EventCard } from '../objetivos/EventCard';
import { PastGoals } from '../objetivos/PastGoals';
import { VolumeCard } from '../objetivos/VolumeCard';
import {
  arrange,
  averages,
  full,
  pastRow,
  periodEnd,
  plannedSum,
  plannedUntil,
  type Average,
  type Slot,
} from '../objetivos/model';
import { PLAN_VIEWS } from '../shell/screens';

type Data = { goals: Goal[]; acts: StoredActivity[]; workouts: PlannedWorkout[]; now: number };
type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: Data };
type FormState = { key: number; open: boolean; goal: Goal | null; kind: GoalKind; period: Slot };

async function loadData(): Promise<Data> {
  const [goals, acts, workouts] = await Promise.all([listGoals(), listActivities(), listWorkouts()]);
  return { goals, acts, workouts, now: Date.now() };
}

const avgText = (a: Average | undefined): string =>
  a ? `Tu semana media son ${full('distanceM', a.distanceM)}: empieza por ahí` : 'Una cifra para cada semana o para cada mes';

/** Plan, vista Objetivos (`/plan/objetivos`): volumen de la semana y del mes, el evento y lo anterior. */
export function Objetivos() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [form, setForm] = useState<FormState>({ key: 0, open: false, goal: null, kind: 'event', period: 'week' });
  const toast = useToast();
  const volTitle = useRef<HTMLHeadingElement>(null);
  const evTitle = useRef<HTMLHeadingElement>(null);

  const refresh = useCallback(async () => {
    try {
      setLoad({ state: 'ready', data: await loadData() });
    } catch {
      setLoad({ state: 'error' });
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const data = load.state === 'ready' ? load.data : null;
  const today = localDay(data?.now ?? Date.now());
  const arr = useMemo(() => arrange(data?.goals ?? [], today), [data, today]);
  const avg = useMemo(() => (data ? averages(data.acts, today) : {}), [data, today]);
  const pastRows = useMemo(
    () => (data ? arr.past.map((g) => pastRow(g, data.acts, data.now, today)) : []),
    [arr, data, today],
  );

  const openForm = (goal: Goal | null, kind?: GoalKind) => {
    const liveEvent = arr.event && arr.event.date >= today;
    const k = goal?.kind ?? kind ?? (!liveEvent ? 'event' : !arr.week || !arr.month ? 'volume' : 'event');
    const period: Slot = !arr.week ? 'week' : !arr.month ? 'month' : 'week';
    setForm((f) => ({ key: f.key + 1, open: true, goal, kind: k, period }));
  };
  const closeForm = () => setForm((f) => ({ ...f, open: false }));
  const focusSection = (kind: GoalKind) =>
    window.setTimeout(() => (kind === 'event' ? evTitle : volTitle).current?.focus({ preventScroll: false }), 280);

  const onSave = async (goal: Goal, replaced?: Goal) => {
    const previous = form.goal;
    closeForm();
    try {
      if (replaced) await deleteGoal(replaced.id);
      await saveGoal(goal);
    } catch {
      toast('No se ha podido guardar el objetivo. Vuelve a intentarlo.', { tone: 'error' });
      return;
    }
    await refresh();
    focusSection(goal.kind);
    if (!replaced) {
      toast(previous ? 'Cambios guardados' : 'Objetivo creado', { tone: 'good' });
      return;
    }
    toast('Objetivo sustituido', {
      tone: 'good',
      action: {
        label: 'Deshacer',
        onClick: () =>
          void (previous ? saveGoal(previous) : deleteGoal(goal.id)).then(() => saveGoal(replaced)).then(refresh),
      },
    });
  };

  const onDelete = async (goal: Goal) => {
    closeForm();
    await deleteGoal(goal.id);
    await refresh();
    focusSection(goal.kind);
    toast('Objetivo borrado', { tone: 'info', action: { label: 'Deshacer', onClick: () => void saveGoal(goal).then(refresh) } });
  };

  const empty = data !== null && data.goals.length === 0;
  const volumes: VolumeGoal[] = [arr.week, arr.month, ...arr.future].filter((g): g is VolumeGoal => !!g);
  const hasCurrent = !!(arr.week || arr.month);

  return (
    <Page
      title="Plan"
      barTitle="Objetivos"
      busy={load.state === 'loading'}
      className="page--goals"
      actions={
        data && !empty ? (
          <button className="btn btn--primary goals-add-bar" type="button" onClick={() => openForm(null)}>
            <Plus className="ic" aria-hidden="true" />
            Nuevo objetivo
          </button>
        ) : null
      }
      nav={<SegmentedNav label="Vistas del plan" items={PLAN_VIEWS} current="/plan/objetivos" />}
    >
      {load.state === 'loading' ? <GoalsSkeleton /> : null}

      {load.state === 'error' ? (
        <section className="section" aria-label="Error">
          <div className="card">
            <StateView
              icon={CircleAlert}
              tone="error"
              level={2}
              title="No se han podido abrir tus objetivos"
              text="El navegador no ha dejado leer los datos guardados. Tus objetivos siguen ahí: vuelve a intentarlo."
              action={
                <button className="btn btn--secondary" type="button" onClick={() => void refresh()}>
                  <RefreshCw className="ic" aria-hidden="true" />
                  Reintentar
                </button>
              }
            />
          </div>
        </section>
      ) : null}

      {data && empty ? (
        <section className="section stack" aria-labelledby="goals-empty-t">
          <div className="card state">
            <span className="state-ic" aria-hidden="true">
              <Target className="ic" />
            </span>
            <h2 className="state-title" id="goals-empty-t">
              Ponte un objetivo
            </h2>
            <p className="state-text">
              Una marcha con fecha o un volumen para cada semana o mes. Lo medimos con tus salidas importadas.
            </p>
          </div>
          <List inset>
            <ListRow
              icon={Flag}
              accent="dist"
              title="Una marcha o evento"
              meta="Cuenta atrás y si tus salidas ya llegan a esa distancia"
              onClick={() => openForm(null, 'event')}
            />
            <ListRow
              icon={Calendar}
              accent="time"
              title="Volumen por semana o mes"
              meta={avgText(avg.week)}
              onClick={() => openForm(null, 'volume')}
            />
          </List>
        </section>
      ) : null}

      {data && !empty ? (
        <>
          <section className="section" aria-labelledby="goals-vol-t">
            <div className="section-h">
              <h2 className="section-title" id="goals-vol-t" tabIndex={-1} ref={volTitle}>
                Volumen
              </h2>
            </div>
            {hasCurrent ? (
              <p className="section-sub">
                <span className="notch-key" aria-hidden="true" />
                La muesca marca dónde tendrías que ir hoy para llegar justo a tiempo.
              </p>
            ) : null}
            {volumes.length > 0 ? (
              <div className="vol-grid stack">
                {volumes.map((g) => {
                  const first = g.distanceM ? 'distanceM' : g.elevGainM ? 'elevGainM' : null;
                  return (
                    <VolumeCard
                      key={g.id}
                      goal={g}
                      progress={volumeProgress(g, data.acts, data.now)}
                      today={today}
                      planned={first ? plannedSum(data.workouts, first, today, periodEnd(g)) : 0}
                      onEdit={(goal) => openForm(goal)}
                    />
                  );
                })}
              </div>
            ) : (
              <List inset>
                <ListRow
                  icon={Calendar}
                  accent="time"
                  title="Sin objetivo de volumen"
                  meta={avgText(avg.week)}
                  onClick={() => openForm(null, 'volume')}
                />
              </List>
            )}
          </section>

          {arr.event ? (
            <section className="section" aria-labelledby="goals-ev-t">
              <div className="section-h">
                <h2 className="section-title" id="goals-ev-t" tabIndex={-1} ref={evTitle}>
                  Tu próximo evento
                </h2>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label={`Editar ${arr.event.title}`}
                  onClick={() => arr.event && openForm(arr.event)}
                >
                  <Pencil className="ic" aria-hidden="true" />
                </button>
              </div>
              <EventCard
                key={arr.event.id}
                goal={arr.event}
                progress={goalProgress(arr.event, data.acts, data.now)}
                today={today}
                planned={plannedUntil(data.workouts, today, arr.event.date)}
                onNext={() => openForm(null, 'event')}
              />
            </section>
          ) : null}

          <div className="goal-add">
            <button className="btn btn--secondary btn--block" type="button" onClick={() => openForm(null)}>
              <Plus className="ic" aria-hidden="true" />
              Nuevo objetivo
            </button>
          </div>

          <PastGoals rows={pastRows} />
        </>
      ) : null}

      {data ? (
        <GoalForm
          key={form.key}
          open={form.open}
          goal={form.goal}
          kind={form.kind}
          period={form.period}
          today={today}
          goals={data.goals}
          avg={avg}
          onClose={closeForm}
          onSave={(g, r) => void onSave(g, r)}
          onDelete={(g) => void onDelete(g)}
        />
      ) : null}
    </Page>
  );
}

/** Esqueleto con la forma real: el anillo con sus líneas y la fila del evento. */
function GoalsSkeleton() {
  return (
    <section className="section stack" aria-label="Cargando tus objetivos">
      <div className="card goals-sk" aria-hidden="true">
        <span className="sk sk-title" />
        <div className="goals-sk-body">
          <span className="sk sk-ring" />
          <span className="goals-sk-lines">
            <span className="sk sk-line" />
            <span className="sk sk-line" style={{ width: '60%' }} />
            <span className="sk sk-line" style={{ width: '84%' }} />
          </span>
        </div>
      </div>
      <div className="card goals-sk-ev" aria-hidden="true">
        <span className="sk goals-sk-hito" />
        <span className="goals-sk-lines">
          <span className="sk sk-title" style={{ width: '70%' }} />
          <span className="sk sk-line" style={{ width: '56%' }} />
          <span className="sk sk-line" />
        </span>
      </div>
    </section>
  );
}
