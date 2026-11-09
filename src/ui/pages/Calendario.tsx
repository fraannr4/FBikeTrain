import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SHARED_AI_ENABLED } from '../../ai/sharedClient';
import { busyDays } from '../../ai/workoutPlanner';
import { useAccount } from '../../auth/AccountBoundary';
import { deleteWorkout, listWorkouts, saveWorkout, setWorkoutDone } from '../../calendar/calendarRepo';
import { syncCalendar } from '../../calendar/sync';
import { getBackupMeta, needsBackup } from '../../backup/backup';
import { getActivity } from '../../db/repo';
import { loadSettings } from '../../settings/settings';
import { localDay } from '../../metrics/calendar';
import type { LocalDate, PlannedWorkout, StoredActivity } from '../../domain/types';
import {
  Bike,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Info,
  Mountain,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
} from '../icons';
import { formatCount, formatDuration, formatNumber } from '../format';
import {
  addDays,
  addMonths,
  diffDays,
  dayNumber,
  longDate,
  mondayOf,
  monthGrid,
  monthLabel,
  relativeDayName,
  weekdayInitial,
  weekdayOf,
  weekdayShort,
  weekRangeLabel,
  whenLabel,
  WEEKDAY_INITIALS,
} from '../calendarGrid';
import { AiWeekSheet, createWeekProposer } from '../calendario/AiWeekSheet';
import { Banner } from '../components/Banner';
import { Page } from '../components/Page';
import { SegmentedNav } from '../components/SegmentedControl';
import { Sheet } from '../components/Sheet';
import { Skeleton } from '../components/Skeleton';
import { StateView } from '../components/StateView';
import { useToast } from '../components/Toast';
import { WorkoutForm } from '../components/WorkoutForm';
import { PLAN_VIEWS } from '../shell/screens';
import { useReducedMotion } from '../theme/motion';

type Status = 'done' | 'pending' | 'missed';
const STATUS_TEXT: Record<Status, string> = { done: 'hecho', pending: 'pendiente', missed: 'sin hacer' };

/** `personalAi`: hay clave y modelo de IA propios en Ajustes. */
type Data = { workouts: PlannedWorkout[]; acts: Map<string, StoredActivity>; backup: boolean; personalAi: boolean };
type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: Data };

/** Semanas de la tira antes y después de la de hoy. */
const WEEKS_BEFORE = 8;
const WEEKS_AFTER = 12;
/** Entrenos de «Próximos». */
const UPCOMING = 5;
const NNBSP = ' ';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const statusOf = (w: PlannedWorkout, today: LocalDate): Status =>
  w.done ? 'done' : w.date < today ? 'missed' : 'pending';

/** Kilómetros: «86», «87,6»; sin decimales a partir de 100. */
function kmText(m: number): string {
  const km = m / 1000;
  const tenth = Math.round(km * 10) / 10;
  return formatNumber(km, km >= 100 || Number.isInteger(tenth) ? 0 : 1);
}

async function loadData(): Promise<Data> {
  const [workouts, meta, settings] = await Promise.all([listWorkouts(), getBackupMeta(), loadSettings()]);
  const ids = [...new Set(workouts.flatMap((w) => (w.done && w.activityId ? [w.activityId] : [])))];
  const found = await Promise.all(ids.map((id) => getActivity(id)));
  const acts = new Map<string, StoredActivity>();
  for (const a of found) if (a) acts.set(a.id, a);
  const personalAi = settings.llm.apiKey.trim() !== '' && settings.llm.model.trim() !== '';
  return { workouts, acts, backup: needsBackup(meta), personalAi };
}

/** Día inicial: el de `?mes=yyyy-MM` (hoy si es este mes, si no el día 1) o hoy. */
function initialDay(mes: string | null, today: LocalDate): LocalDate {
  if (!mes || !MONTH_RE.test(mes) || today.startsWith(mes)) return today;
  return `${mes}-01`;
}

/** Plan, vista Calendario (`/plan`): la semana deslizable, el día elegido, lo próximo y el mes en una hoja. */
export function Calendario() {
  const [params] = useSearchParams();
  const [today] = useState(() => localDay(Date.now()));
  const [selected, setSelected] = useState(() => initialDay(params.get('mes'), today));
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [monthOpen, setMonthOpen] = useState(false);
  const [form, setForm] = useState<{ key: number; open: boolean; workout: PlannedWorkout | null; date: LocalDate }>({
    key: 0,
    open: false,
    workout: null,
    date: today,
  });
  const [aiWeek, setAiWeek] = useState({ key: 0, open: false });
  const account = useAccount();
  const sharedAi = SHARED_AI_ENABLED && account !== null;
  const proposeWeek = useMemo(() => createWeekProposer(account?.client ?? null), [account]);
  const toast = useToast();
  const reduced = useReducedMotion();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const stripSecRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    loadData().then(
      (data) => setLoad({ state: 'ready', data }),
      () => setLoad({ state: 'error' }),
    );
  }, []);
  useEffect(reload, [reload]);

  const workouts = load.state === 'ready' ? load.data.workouts : [];
  const byDay = useMemo(() => {
    const m = new Map<LocalDate, PlannedWorkout[]>();
    for (const w of workouts) m.set(w.date, [...(m.get(w.date) ?? []), w]);
    return m;
  }, [workouts]);

  // Tira de semanas: de 8 semanas antes de hoy a 12 después, y hasta la del día elegido si cae fuera.
  const todayMonday = mondayOf(today);
  const selMonday = mondayOf(selected);
  const firstMonday = [addDays(todayMonday, -7 * WEEKS_BEFORE), selMonday].sort()[0];
  const lastMonday = [addDays(todayMonday, 7 * WEEKS_AFTER), selMonday].sort()[1];
  const weeks = useMemo(() => {
    const out: LocalDate[] = [];
    for (let m = firstMonday; m <= lastMonday; m = addDays(m, 7)) out.push(m);
    return out;
  }, [firstMonday, lastMonday]);
  const [shownMonday, setShownMonday] = useState(selMonday);

  const goWeek = useCallback(
    (monday: LocalDate, smooth: boolean) => {
      setShownMonday(monday);
      const el = scrollerRef.current;
      const i = weeks.indexOf(monday);
      if (!el || i < 0) return;
      el.scrollTo?.({ left: i * el.clientWidth, behavior: smooth && !reduced ? 'smooth' : 'auto' });
    },
    [weeks, reduced],
  );

  // Al montar la tira o cambiar su rango, la semana visible vuelve a su sitio sin animación.
  const ready = load.state === 'ready';
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const i = weeks.indexOf(shownMonday);
    if (i >= 0) el.scrollLeft = i * el.clientWidth;
    // Solo al cambiar el rango o al aparecer la tira; los pasos de semana los mueve goWeek.
  }, [weeks, ready]);

  useEffect(() => {
    const onResize = () => goWeek(shownMonday, false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [goWeek, shownMonday]);

  const select = useCallback(
    (d: LocalDate, o: { scroll?: boolean; focusDay?: boolean } = {}) => {
      setSelected(d);
      if (o.scroll) goWeek(mondayOf(d), true);
      if (o.focusDay) {
        requestAnimationFrame(() =>
          scrollerRef.current?.querySelector<HTMLButtonElement>(`[data-date="${d}"]`)?.focus({ preventScroll: true }),
        );
      }
    },
    [goWeek],
  );

  // Al acabar de deslizar, la selección acompaña a la semana: el mismo día de la semana.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const settle = useRef<number>();
  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el || el.clientWidth === 0) return;
    const monday = weeks[Math.round(el.scrollLeft / el.clientWidth)];
    if (!monday) return;
    setShownMonday(monday);
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const sel = selectedRef.current;
      if (mondayOf(sel) !== monday) setSelected(addDays(monday, weekdayOf(sel)));
    }, 120);
  };
  useEffect(() => () => window.clearTimeout(settle.current), []);

  const onStripKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!step) return;
    const d = addDays(selected, step);
    if (d < weeks[0] || d > addDays(weeks[weeks.length - 1], 6)) return;
    e.preventDefault();
    select(d, { focusDay: true });
    if (mondayOf(d) !== shownMonday) goWeek(mondayOf(d), true);
  };

  const openForm = (workout: PlannedWorkout | null, date: LocalDate) =>
    setForm((f) => ({ key: f.key + 1, open: true, workout, date }));
  const closeForm = () => setForm((f) => ({ ...f, open: false }));
  // Foco diferido al título del día, salvo que entretanto el usuario ya esté escribiendo en un campo.
  const focusTitleIn = (ms: number) =>
    window.setTimeout(() => {
      if (document.activeElement?.closest('input, textarea, select')) return;
      titleRef.current?.focus({ preventScroll: true });
    }, ms);
  const focusTitle = () => focusTitleIn(280);

  const refresh = async () => {
    try {
      setLoad({ state: 'ready', data: await loadData() });
    } catch {
      setLoad({ state: 'error' });
    }
  };

  const onSave = async (w: PlannedWorkout) => {
    const wasNew = form.workout === null;
    closeForm();
    try {
      await saveWorkout(w);
      await syncCalendar();
    } catch {
      toast('No se ha podido guardar el entreno. Vuelve a intentarlo.', { tone: 'error' });
      return;
    }
    await refresh();
    select(w.date, { scroll: true });
    toast(wasNew ? 'Entreno guardado' : 'Cambios guardados', { tone: 'good' });
    focusTitle();
  };

  const onDelete = async (w: PlannedWorkout) => {
    closeForm();
    await deleteWorkout(w.id);
    await refresh();
    toast('Entreno borrado', {
      tone: 'info',
      action: { label: 'Deshacer', onClick: () => void saveWorkout(w).then(refresh) },
    });
    focusTitle();
  };

  const markDone = async (w: PlannedWorkout) => {
    await setWorkoutDone(w.id, true);
    await refresh();
    toast('Marcado como hecho', {
      tone: 'good',
      action: { label: 'Deshacer', onClick: () => void saveWorkout(w).then(refresh) },
    });
  };

  const goto = (d: LocalDate) => {
    select(d, { scroll: true });
    stripSecRef.current?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    focusTitleIn(120);
  };

  const goToday = () => {
    select(today, { scroll: true });
    window.scrollTo?.({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  };

  const closeAiWeek = () => setAiWeek((a) => ({ ...a, open: false }));

  const onAiAdded = async (ws: PlannedWorkout[]) => {
    closeAiWeek();
    try {
      await syncCalendar();
    } catch {
      // Marcar como hechos es secundario: los entrenos ya están guardados.
    }
    await refresh();
    if (ws.length > 0) select(ws[0].date, { scroll: true });
    toast(ws.length === 1 ? '1 entreno añadido' : `${ws.length} entrenos añadidos`, { tone: 'good' });
  };

  const empty = ready && workouts.length === 0;
  const aiReady = sharedAi || (load.state === 'ready' && load.data.personalAi);
  const planDate = diffDays(selected, today) >= 0 ? selected : today;

  const actions =
    load.state === 'ready' ? (
      <>
        <button className="btn btn--ghost cal-today" type="button" onClick={goToday}>
          Hoy
        </button>
        {!empty ? (
          <button className="btn btn--primary cal-add" type="button" onClick={() => openForm(null, planDate)}>
            <Plus className="ic" aria-hidden="true" />
            Planificar
          </button>
        ) : null}
      </>
    ) : null;

  return (
    <Page
      title="Plan"
      barTitle="Calendario"
      variant="dense"
      className="page--cal"
      busy={load.state === 'loading'}
      actions={actions}
      nav={<SegmentedNav label="Vistas del plan" items={PLAN_VIEWS} current="/plan" />}
    >
      {load.state === 'loading' ? <CalendarSkeleton /> : null}
      {load.state === 'error' ? (
        <section className="section" aria-label="Error">
          <div className="card">
            <StateView
              icon={CircleAlert}
              tone="error"
              level={2}
              title="No se ha podido abrir el calendario"
              text="El navegador no ha dejado leer los datos guardados. Tus entrenos siguen ahí: vuelve a intentarlo."
              action={
                <button className="btn btn--secondary" type="button" onClick={reload}>
                  <RefreshCw className="ic" aria-hidden="true" />
                  Reintentar
                </button>
              }
            />
          </div>
        </section>
      ) : null}

      {load.state === 'ready' ? (
        <>
          <section className="section wk-sec" aria-label="Semana" ref={stripSecRef}>
            <div className="card cal">
              <div className="cal-h">
                <button
                  className="month-btn"
                  type="button"
                  aria-describedby="cal-month-help"
                  onClick={() => setMonthOpen(true)}
                >
                  <span>{weekRangeLabel(shownMonday)}</span>
                  <ChevronDown className="ic" aria-hidden="true" />
                </button>
                <span className="sr-only" id="cal-month-help">
                  Abre el mes completo
                </span>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Semana anterior"
                  disabled={shownMonday <= weeks[0]}
                  onClick={() => goWeek(addDays(shownMonday, -7), true)}
                >
                  <ChevronLeft className="ic" aria-hidden="true" />
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Semana siguiente"
                  disabled={shownMonday >= weeks[weeks.length - 1]}
                  onClick={() => goWeek(addDays(shownMonday, 7), true)}
                >
                  <ChevronRight className="ic" aria-hidden="true" />
                </button>
              </div>
              <div
                className="wk-scroller"
                ref={scrollerRef}
                role="group"
                aria-label="Días. Desliza para cambiar de semana; con las flechas del teclado, de día"
                onScroll={onScroll}
                onKeyDown={onStripKey}
              >
                {weeks.map((monday) => (
                  <Week key={monday} monday={monday} byDay={byDay} today={today} selected={selected} onPick={select} />
                ))}
              </div>
              <WeekSummary monday={shownMonday} byDay={byDay} acts={load.data.acts} />
              <Legend className="cal-legend" />
            </div>
            {aiReady ? (
              <button
                className="btn btn--secondary btn--block aiw-open"
                type="button"
                onClick={() => setAiWeek((a) => ({ key: a.key + 1, open: true }))}
              >
                <Sparkles className="ic" aria-hidden="true" />
                Proponer semana con IA
              </button>
            ) : null}
          </section>

          {empty ? (
            <section className="section" aria-label="Sin entrenos">
              <div className="card">
                <StateView
                  icon={Calendar}
                  level={2}
                  title="Aún no has planificado nada"
                  text="Apunta tus próximas salidas. Cuando importes la salida de Strava, el entreno se marca solo como hecho."
                  action={
                    <button className="btn btn--primary" type="button" onClick={() => openForm(null, planDate)}>
                      <Plus className="ic" aria-hidden="true" />
                      Planificar un entreno
                    </button>
                  }
                />
              </div>
            </section>
          ) : (
            <div className="cal-cols">
              <section className="section day-sec" aria-labelledby="cal-day-title">
                <div className="day-panel" aria-live="polite">
                  <div className="day-panel-in" key={selected}>
                  <h2 className="day-title" id="cal-day-title" tabIndex={-1} ref={titleRef}>
                    {relativeDayName(selected, today)}
                  </h2>
                  <DayPanel
                    day={selected}
                    today={today}
                    workouts={byDay.get(selected) ?? []}
                    all={workouts}
                    acts={load.data.acts}
                    onEdit={(w) => openForm(w, w.date)}
                    onDone={markDone}
                    onPlan={(d) => openForm(null, d)}
                  />
                  </div>
                </div>
              </section>
              <Upcoming workouts={workouts} today={today} onPick={goto} onMonth={() => setMonthOpen(true)} />
            </div>
          )}

          {load.data.backup ? (
            <Banner
              tone="warn"
              action={
                <Link className="btn btn--ghost" to="/ajustes">
                  Exportar copia
                </Link>
              }
            >
              Tu calendario tiene cambios sin copia.
            </Banner>
          ) : null}

          {aiReady ? (
            <AiWeekSheet
              key={aiWeek.key}
              open={aiWeek.open}
              onClose={closeAiWeek}
              today={today}
              busy={busyDays(workouts, today)}
              propose={proposeWeek}
              notesHelp={sharedAi ? 'El servicio común no envía las notas; solo se usan con tu propia clave de IA.' : undefined}
              onAdded={(ws) => void onAiAdded(ws)}
            />
          ) : null}

          <MonthSheet
            open={monthOpen}
            onClose={() => setMonthOpen(false)}
            selected={selected}
            today={today}
            byDay={byDay}
            onPick={(d) => {
              setMonthOpen(false);
              select(d, { scroll: true });
            }}
          />
        </>
      ) : null}

      <WorkoutForm
        key={form.key}
        open={form.open}
        workout={form.workout}
        date={form.date}
        onClose={closeForm}
        onSave={onSave}
        onDelete={onDelete}
      />
    </Page>
  );
}

/* ---------------------------------------------------------------- Días */

function dayLabel(d: LocalDate, ws: PlannedWorkout[], today: LocalDate): string {
  const head = longDate(d) + (d === today ? ', hoy' : '');
  if (ws.length === 0) return `${head}, sin entrenos`;
  return `${head}: ${ws.map((w) => `${w.title}, ${STATUS_TEXT[statusOf(w, today)]}`).join('; ')}`;
}

/** Marcas del día: hasta dos; con más, dos y «+N». La forma, no solo el color, dice el estado. */
function Marks({ ws, today }: { ws: PlannedWorkout[]; today: LocalDate }) {
  if (ws.length === 0) return <span className="mk mk--none" aria-hidden="true" />;
  return (
    <span className="mk-pair" aria-hidden="true">
      {ws.slice(0, 2).map((w) => (
        <span key={w.id} className={`mk mk--${statusOf(w, today)}`} />
      ))}
      {ws.length > 2 ? <span className="mk-more">+{ws.length - 2}</span> : null}
    </span>
  );
}

type DayBtnProps = {
  d: LocalDate;
  ws: PlannedWorkout[];
  today: LocalDate;
  selected: boolean;
  /** En la hoja del mes no se escribe la inicial del día: va en la cabecera. */
  inMonth?: boolean;
  onPick: (d: LocalDate) => void;
};

function DayButton({ d, ws, today, selected, inMonth, onPick }: DayBtnProps) {
  return (
    <button
      className="day"
      type="button"
      data-date={d}
      aria-pressed={selected}
      aria-current={d === today ? 'date' : undefined}
      tabIndex={inMonth || selected ? 0 : -1}
      aria-label={dayLabel(d, ws, today)}
      onClick={() => onPick(d)}
    >
      {inMonth ? null : (
        <span className="day-w" aria-hidden="true">
          {weekdayInitial(d)}
        </span>
      )}
      <span className="day-n" aria-hidden="true">
        {dayNumber(d)}
      </span>
      <Marks ws={ws} today={today} />
    </button>
  );
}

type WeekProps = {
  monday: LocalDate;
  byDay: Map<LocalDate, PlannedWorkout[]>;
  today: LocalDate;
  selected: LocalDate;
  onPick: (d: LocalDate) => void;
};

/** Una semana de la tira. Memorizada: al elegir día solo se repintan las dos semanas afectadas. */
const Week = memo(function Week({ monday, byDay, today, selected, onPick }: WeekProps) {
  return (
    <div className="wk">
      {Array.from({ length: 7 }, (_, i) => {
        const d = addDays(monday, i);
        return (
          <DayButton key={d} d={d} ws={byDay.get(d) ?? []} today={today} selected={d === selected} onPick={onPick} />
        );
      })}
    </div>
  );
}, (a, b) => {
  const inWeek = (d: LocalDate, m: LocalDate) => d >= m && d <= addDays(m, 6);
  return (
    a.monday === b.monday &&
    a.byDay === b.byDay &&
    a.today === b.today &&
    a.onPick === b.onPick &&
    inWeek(a.selected, a.monday) === inWeek(b.selected, b.monday) &&
    (!inWeek(b.selected, b.monday) || a.selected === b.selected)
  );
});

function Legend({ className }: { className: string }) {
  return (
    <p className={className} aria-hidden="true">
      <span>
        <i className="mk mk--done" />
        Hecho
      </span>
      <span>
        <i className="mk mk--pending" />
        Pendiente
      </span>
      <span>
        <i className="mk mk--missed" />
        Sin hacer
      </span>
    </p>
  );
}

/** Pie de la tira: lo planificado de la semana visible y cuánto se ha hecho. */
function WeekSummary({
  monday,
  byDay,
  acts,
}: {
  monday: LocalDate;
  byDay: Map<LocalDate, PlannedWorkout[]>;
  acts: Map<string, StoredActivity>;
}) {
  const ws = Array.from({ length: 7 }, (_, i) => byDay.get(addDays(monday, i)) ?? []).flat();
  if (ws.length === 0) {
    return (
      <p className="cal-foot" aria-live="polite">
        Nada planificado esta semana.
      </p>
    );
  }
  const done = ws.filter((w) => w.done);
  const plannedM = ws.reduce((s, w) => s + (w.distanceM ?? 0), 0);
  const doneM = done.reduce((s, w) => {
    const a = w.activityId ? acts.get(w.activityId) : undefined;
    return s + (a ? a.totals.distanceM : (w.distanceM ?? 0));
  }, 0);
  const p = plannedM > 0 ? Math.min(1, doneM / plannedM) : 0;
  return (
    <p className="cal-foot" aria-live="polite">
      <span>
        <b className="nw">
          {done.length} de {ws.length}
        </b>{' '}
        {ws.length === 1 ? 'entreno hecho' : 'entrenos hechos'}
        {plannedM > 0 ? (
          <>
            {' · '}
            <b className="nw">
              {formatCount(doneM / 1000)} de {formatCount(plannedM / 1000)}
              {NNBSP}km
            </b>{' '}
            planificados
          </>
        ) : null}
      </span>
      {plannedM > 0 ? <span className="meter" data-m="dist" style={{ '--p': p.toFixed(3) } as CSSProperties} aria-hidden="true"><i /></span> : null}
    </p>
  );
}

/* ---------------------------------------------------------- Panel del día */

function Figs({ w }: { w: PlannedWorkout }) {
  if (!w.distanceM && !w.elevGainM) return null;
  return (
    <p className="figs">
      {w.distanceM ? (
        <span data-m="dist">
          <Bike className="ic" aria-hidden="true" />
          <b>{kmText(w.distanceM)}</b>km
        </span>
      ) : null}
      {w.elevGainM ? (
        <span data-m="elev">
          <Mountain className="ic" aria-hidden="true" />
          <b>{formatCount(w.elevGainM)}</b>m
        </span>
      ) : null}
    </p>
  );
}

function StatusChip({ status }: { status: Status }) {
  if (status === 'done') {
    return (
      <span className="chip chip--done">
        <Check className="ic" aria-hidden="true" />
        Hecho
      </span>
    );
  }
  return (
    <span className={`chip chip--${status}`}>
      <span className={`mk mk--${status}`} aria-hidden="true" />
      {status === 'missed' ? 'Sin hacer' : 'Pendiente'}
    </span>
  );
}

type CardProps = {
  w: PlannedWorkout;
  today: LocalDate;
  acts: Map<string, StoredActivity>;
  onEdit: (w: PlannedWorkout) => void;
  onDone: (w: PlannedWorkout) => void;
};

function WorkoutCard({ w, today, acts, onEdit, onDone }: CardProps) {
  const status = statusOf(w, today);
  const act = w.activityId ? acts.get(w.activityId) : undefined;
  let detail: ReactNode;
  if (status === 'done') {
    detail = (
      <div className="wo-match">
        <CircleCheck className="ic" aria-hidden="true" />
        <p>
          {act ? (
            <>
              Coincide con tu salida:{' '}
              <b>
                <span className="nw">
                  {kmText(act.totals.distanceM)}
                  {NNBSP}km
                </span>
                , <span className="nw">{formatCount(act.totals.elevGainM)}{NNBSP}m</span> y{' '}
                <span className="nw">{formatDuration(act.totals.movingTimeS)}</span>
              </b>
              . Marcado al importar.
            </>
          ) : w.activityId ? (
            'La salida que lo marcó no está importada en este navegador.'
          ) : (
            'Marcado a mano. No hay ninguna salida importada ese día.'
          )}
        </p>
        {act ? (
          <Link className="btn btn--ghost" to={`/historial/${act.id}`}>
            Ver salida
          </Link>
        ) : null}
      </div>
    );
  } else {
    const canMark = status === 'missed' || w.date === today;
    detail = (
      <>
        <p className="wo-help">
          <Info className="ic" aria-hidden="true" />
          {status === 'missed'
            ? 'No hay ninguna salida importada ese día. Si saliste sin GPS, márcalo tú.'
            : 'Se marcará como hecho cuando importes la salida de ese día.'}
        </p>
        {canMark ? (
          <button className="btn btn--secondary btn--block" type="button" onClick={() => onDone(w)}>
            <Check className="ic" aria-hidden="true" />
            Marcar como hecho
          </button>
        ) : null}
      </>
    );
  }
  return (
    <article className="card wo" aria-label={w.title}>
      <div className="wo-h">
        <StatusChip status={status} />
        <button className="icon-btn" type="button" aria-label={`Editar ${w.title}`} onClick={() => onEdit(w)}>
          <Pencil className="ic" aria-hidden="true" />
        </button>
      </div>
      <h3 className="wo-title">{w.title}</h3>
      <Figs w={w} />
      {w.notes ? <p className="wo-notes">{w.notes}</p> : null}
      {detail}
    </article>
  );
}

type PanelProps = {
  day: LocalDate;
  today: LocalDate;
  workouts: PlannedWorkout[];
  all: PlannedWorkout[];
  acts: Map<string, StoredActivity>;
  onEdit: (w: PlannedWorkout) => void;
  onDone: (w: PlannedWorkout) => void;
  onPlan: (d: LocalDate) => void;
};

function DayPanel({ day, today, workouts, all, acts, onEdit, onDone, onPlan }: PanelProps) {
  const n = diffDays(day, today);
  let rest: ReactNode = null;
  if (workouts.length === 0) {
    const next = n >= 0 ? all.find((w) => w.date > day && !w.done) : undefined;
    const meta =
      n < 0 ? (
        'Ese día no tenías nada apuntado.'
      ) : next ? (
        <>
          Lo siguiente, {whenLabel(next.date, today)}: <b>{next.title}</b>
          {next.distanceM ? `, ${kmText(next.distanceM)}${NNBSP}km` : ''}.
        </>
      ) : (
        'Día libre en el plan.'
      );
    rest = (
      <div className="list rest">
        <div className="row">
          <span className="row-lead" aria-hidden="true">
            <Calendar className="ic" />
          </span>
          <span className="row-main">
            <span className="row-title">{n === 0 ? 'Nada planificado para hoy' : 'Nada planificado'}</span>
            <span className="row-meta">{meta}</span>
          </span>
        </div>
      </div>
    );
  }
  return (
    <>
      {workouts.map((w) => (
        <WorkoutCard key={w.id} w={w} today={today} acts={acts} onEdit={onEdit} onDone={onDone} />
      ))}
      {rest}
      {n >= 0 ? (
        <button
          className={`btn ${workouts.length ? 'btn--ghost' : 'btn--secondary'} btn--block day-add`}
          type="button"
          onClick={() => onPlan(day)}
        >
          <Plus className="ic" aria-hidden="true" />
          {workouts.length ? 'Añadir otro entreno este día' : 'Planificar este día'}
        </button>
      ) : (
        <button className="btn btn--ghost btn--block day-add" type="button" onClick={() => onPlan(today)}>
          <Plus className="ic" aria-hidden="true" />
          Planificar un entreno
        </button>
      )}
    </>
  );
}

/* --------------------------------------------------------------- Próximos */

function Upcoming({
  workouts,
  today,
  onPick,
  onMonth,
}: {
  workouts: PlannedWorkout[];
  today: LocalDate;
  onPick: (d: LocalDate) => void;
  onMonth: () => void;
}) {
  const next = workouts.filter((w) => w.date > today).slice(0, UPCOMING);
  return (
    <section className="section prox-sec" aria-labelledby="cal-prox">
      <div className="section-h">
        <h2 className="section-title" id="cal-prox">
          Próximos
        </h2>
        <button className="card-link" type="button" onClick={onMonth}>
          Ver el mes
          <ChevronRight className="ic" aria-hidden="true" />
        </button>
      </div>
      {next.length === 0 ? (
        <p className="prox-none">No tienes nada planificado después de hoy.</p>
      ) : (
        <ul className="list list--inset list--hito">
          {next.map((w) => {
            const n = diffDays(w.date, today);
            return (
              <li key={w.id}>
                <button className="row row--hito" type="button" onClick={() => onPick(w.date)}>
                  <span className="hito-date hito-date--sm" aria-hidden="true">
                    <span className="hito-date-d">{weekdayShort(w.date)}</span>
                    <span className="hito-date-n">{dayNumber(w.date)}</span>
                  </span>
                  <span className="row-main">
                    <span className="sr-only">{longDate(w.date)}: </span>
                    <span className="row-title">{w.title}</span>
                    <span className="row-meta">
                      {n === 1 ? 'Mañana' : `En ${n} días`}
                      {w.elevGainM ? (
                        <>
                          , <span className="nw">{formatCount(w.elevGainM)}{NNBSP}m de desnivel</span>
                        </>
                      ) : null}
                    </span>
                  </span>
                  <span className="row-trail">
                    {w.distanceM ? (
                      <span className="row-val">
                        {kmText(w.distanceM)}
                        <span className="u">km</span>
                      </span>
                    ) : null}
                    <ChevronRight className="chev" aria-hidden="true" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ----------------------------------------------------------- Hoja del mes */

type MonthProps = {
  open: boolean;
  onClose: () => void;
  selected: LocalDate;
  today: LocalDate;
  byDay: Map<LocalDate, PlannedWorkout[]>;
  onPick: (d: LocalDate) => void;
};

function MonthSheet({ open, onClose, selected, today, byDay, onPick }: MonthProps) {
  const [month, setMonth] = useState(selected.slice(0, 7));
  // Cada vez que se abre, enseña el mes del día elegido.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setMonth(selected.slice(0, 7));
  }

  const grid = monthGrid(month);
  const days = grid.flat().filter((d) => d.startsWith(month));
  const ws = days.flatMap((d) => byDay.get(d) ?? []);
  const c = { done: 0, missed: 0, pending: 0 };
  for (const w of ws) c[statusOf(w, today)]++;
  const parts = [
    c.done ? `${c.done} ${c.done === 1 ? 'hecho' : 'hechos'}` : '',
    c.missed ? `${c.missed} sin hacer` : '',
    c.pending ? `${c.pending} por venir` : '',
  ].filter(Boolean);
  const sum = ws.length
    ? `${ws.length} ${ws.length === 1 ? 'entreno' : 'entrenos'}: ${parts.join(', ')}.`
    : 'Nada planificado este mes.';

  return (
    <Sheet open={open} onClose={onClose} title="Elegir día" className="sheet--month">
      <div className="mo-nav">
        <button className="icon-btn" type="button" aria-label="Mes anterior" onClick={() => setMonth((m) => addMonths(m, -1))}>
          <ChevronLeft className="ic" aria-hidden="true" />
        </button>
        <p className="mo-label" id="cal-mo-label" aria-live="polite">
          {monthLabel(month)}
        </p>
        <button className="icon-btn" type="button" aria-label="Mes siguiente" onClick={() => setMonth((m) => addMonths(m, 1))}>
          <ChevronRight className="ic" aria-hidden="true" />
        </button>
      </div>
      <p className="mo-sum">{sum}</p>
      <div className="mo-grid" role="group" aria-labelledby="cal-mo-label">
        {WEEKDAY_INITIALS.map((x) => (
          <span key={x} className="dow" aria-hidden="true">
            {x}
          </span>
        ))}
        {grid.flat().map((d) =>
          d.startsWith(month) ? (
            <DayButton key={d} d={d} ws={byDay.get(d) ?? []} today={today} selected={d === selected} inMonth onPick={onPick} />
          ) : (
            <span key={d} aria-hidden="true" />
          ),
        )}
      </div>
      <Legend className="mo-legend" />
    </Sheet>
  );
}

/* ---------------------------------------------------------------- Carga */

function CalendarSkeleton() {
  return (
    <section className="section" aria-label="Cargando el calendario">
      <span className="sr-only">Cargando el calendario</span>
      <div className="card cal-sk" aria-hidden="true">
        <div className="cal-sk-h">
          <Skeleton variant="title" width="46%" />
          <Skeleton width={64} height={18} />
        </div>
        <div className="sk-strip">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="sk sk-day" />
          ))}
        </div>
        <Skeleton width="70%" />
      </div>
      <div className="card cal-sk-day" aria-hidden="true">
        <Skeleton width="30%" />
        <Skeleton variant="title" width="72%" />
        <Skeleton width="48%" />
        <Skeleton variant="box" height={48} />
      </div>
    </section>
  );
}
