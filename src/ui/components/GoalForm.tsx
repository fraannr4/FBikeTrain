import { useId, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { newId } from '../../calendar/calendarRepo';
import type { EventGoal, Goal, LocalDate, VolumeGoal } from '../../domain/types';
import { periodStartOf } from '../../metrics/calendar';
import { Activity, Calendar, CircleAlert, Flag, Trash2, TriangleAlert } from '../icons';
import { formatNumber } from '../format';
import { eventDate, full, listAnd, takenBy, targetsText, volumeTitle, type Average, type Slot } from '../objetivos/model';
import { Field } from './Field';
import { SegmentedControl } from './SegmentedControl';
import { Sheet } from './Sheet';
import { parseFigure } from './WorkoutForm';

export type GoalKind = Goal['kind'];

type Props = {
  open: boolean;
  /** Objetivo que se edita; `null` para crear uno. */
  goal: Goal | null;
  /** Al crear: con qué tipo y cada cuánto se abre. */
  kind: GoalKind;
  period: Slot;
  today: LocalDate;
  /** Todos los objetivos: para avisar si el nuevo sustituye a otro. */
  goals: Goal[];
  /** Tu semana y tu mes medios, para rellenar el volumen de un toque. */
  avg: { week?: Average; month?: Average };
  onClose: () => void;
  /** `replaced`: el objetivo que ocupaba ese hueco y que hay que borrar. */
  onSave: (goal: Goal, replaced?: Goal) => void;
  onDelete: (goal: Goal) => void;
};

const NAME_ERROR = 'Ponle un nombre para reconocerlo en la cuenta atrás.';
const EVENT_EMPTY = 'Pon al menos una cifra: distancia o desnivel.';
const VOLUME_EMPTY = 'Pon al menos una cifra: distancia, desnivel o tiempo.';

const text = (n: number | undefined, decimals = 1): string =>
  n === undefined ? '' : formatNumber(n, Number.isInteger(Math.round(n * 10 ** decimals) / 10 ** decimals) ? 0 : decimals);

/** Minutos de 0 a 59; vacío vale. */
function parseMinutes(raw: string): { ok: boolean; n?: number } {
  const v = raw.trim();
  if (!v) return { ok: true };
  if (!/^\d{1,2}$/.test(v) || Number(v) > 59) return { ok: false };
  return { ok: true, n: Number(v) || undefined };
}

function figureError(raw: string, decimal: string, whole: string): string {
  const p = parseFigure(raw);
  if (p.ok) return '';
  return p.ok === false && p.dot
    ? `No sabemos si «${raw.trim()}» lleva decimales. Escribe ${decimal} o ${whole}.`
    : `Escribe solo la cifra, por ejemplo ${decimal}.`;
}

/** Pestañas Evento y Volumen: `.seg` relleno, con `role="tablist"`. */
function KindTabs({ value, onChange, panelId }: { value: GoalKind; onChange: (k: GoalKind) => void; panelId: string }) {
  const tabs: { value: GoalKind; label: string; icon: typeof Flag }[] = [
    { value: 'event', label: 'Evento', icon: Flag },
    { value: 'volume', label: 'Volumen', icon: Calendar },
  ];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = value === 'event' ? 0 : 1;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = 1 - index;
    refs.current[next]?.focus();
    onChange(tabs[next].value);
  };
  return (
    <div className="seg goal-kind" role="tablist" aria-label="Tipo de objetivo" style={{ '--n': 2 } as CSSProperties} onKeyDown={onKeyDown}>
      <span className="seg-ind" aria-hidden="true" style={{ transform: `translateX(${index * 100}%)` }} />
      {tabs.map(({ value: v, label, icon: Icon }, i) => (
        <button
          key={v}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          aria-selected={v === value}
          aria-controls={panelId}
          tabIndex={v === value ? 0 : -1}
          onClick={() => onChange(v)}
        >
          <Icon className="ic" aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function NumberInput(props: {
  id: string;
  label: string;
  unit: string;
  value: string;
  bad: boolean;
  decimal?: boolean;
  srLabel?: boolean;
  describedBy?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field" data-invalid={props.bad ? '' : undefined}>
      <label className={props.srLabel ? 'sr-only' : 'field-label'} htmlFor={props.id}>
        {props.label}
      </label>
      <div className="input-wrap unit-wrap">
        <input
          id={props.id}
          className="input"
          type="text"
          inputMode={props.decimal ? 'decimal' : 'numeric'}
          autoComplete="off"
          value={props.value}
          aria-invalid={props.bad || undefined}
          aria-describedby={props.describedBy}
          onChange={(e) => props.onChange(e.target.value)}
        />
        <span className="sfx" aria-hidden="true">
          {props.unit}
        </span>
      </div>
    </div>
  );
}

function FormError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="form-err" id={id} role="alert">
      <CircleAlert className="ic" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Hoja para crear o editar un objetivo (objetivos.html): un evento con fecha o un volumen para una
 * semana o un mes. Pide km, m, horas y minutos y guarda metros y segundos. Si el hueco ya tiene
 * objetivo (el evento en curso, o esa semana o ese mes), avisa de que lo sustituye.
 */
export function GoalForm({ open, goal, kind: initialKind, period: initialPeriod, today, goals, avg, onClose, onSave, onDelete }: Props) {
  const ids = useId();
  const ev = goal?.kind === 'event' ? goal : null;
  const vol = goal?.kind === 'volume' ? goal : null;
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? initialKind);
  const [name, setName] = useState(ev?.title ?? '');
  const [date, setDate] = useState(ev?.date ?? '');
  const [ekm, setEkm] = useState(text(ev?.distanceM === undefined ? undefined : ev.distanceM / 1000));
  const [em, setEm] = useState(text(ev?.elevGainM, 0));
  const [period, setPeriod] = useState<Slot>(vol?.period ?? initialPeriod);
  const [month, setMonth] = useState((vol?.period === 'month' ? vol.start : today).slice(0, 7));
  const [week, setWeek] = useState(vol?.period === 'week' ? vol.start : periodStartOf('week', today));
  const [km, setKm] = useState(text(vol?.distanceM === undefined ? undefined : vol.distanceM / 1000));
  const [m, setM] = useState(text(vol?.elevGainM, 0));
  const hm = vol?.movingTimeS ? Math.round(vol.movingTimeS / 60) : 0;
  const [h, setH] = useState(hm ? String(Math.floor(hm / 60)) : '');
  const [min, setMin] = useState(hm % 60 ? String(hm % 60) : '');
  const [nameError, setNameError] = useState(false);
  const [emptyError, setEmptyError] = useState(false);
  const [bad, setBad] = useState<Record<string, boolean>>({});

  const formId = `${ids}-form`;
  const panelId = `${ids}-panel`;
  const numErrId = `${ids}-num`;
  const id = (k: string) => `${ids}-${k}`;

  const start = period === 'week' ? periodStartOf('week', week || today) : `${month || today.slice(0, 7)}-01`;
  const replaced = takenBy(
    goals,
    kind === 'event' ? { kind: 'event' } : { kind: 'volume', period, start },
    today,
    goal?.id,
  );
  // Al editar, solo se sustituye otro objetivo si se cambia de hueco.
  const warn = replaced ? replaceText(replaced, period, start, today) : '';

  const numFields: Record<string, { raw: string; decimal: string; whole: string }> =
    kind === 'event'
      ? { ekm: { raw: ekm, decimal: '140,5', whole: '1405' }, em: { raw: em, decimal: '2600', whole: '2600' } }
      : { km: { raw: km, decimal: '74,5', whole: '745' }, m: { raw: m, decimal: '3500', whole: '3500' }, h: { raw: h, decimal: '7,5', whole: '7' } };
  const firstBad = Object.keys(numFields).find((k) => bad[k]);
  const minBad = kind === 'volume' && bad.min;
  const numError = firstBad
    ? figureError(numFields[firstBad].raw, numFields[firstBad].decimal, numFields[firstBad].whole)
    : minBad
      ? 'Los minutos van de 0 a 59.'
      : '';

  const setField = (k: string, set: (v: string) => void, check: (v: string) => boolean) => (v: string) => {
    set(v);
    setEmptyError(false);
    if (bad[k] && check(v)) setBad((b) => ({ ...b, [k]: false }));
  };
  const figOk = (v: string) => parseFigure(v).ok;
  const minOk = (v: string) => parseMinutes(v).ok;

  const focus = (k: string) => document.getElementById(id(k))?.focus();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (kind === 'event' && !name.trim()) {
      setNameError(true);
      focus('name');
      return;
    }
    const parsed = Object.fromEntries(Object.entries(numFields).map(([k, f]) => [k, parseFigure(f.raw)]));
    const nextBad: Record<string, boolean> = Object.fromEntries(Object.entries(parsed).map(([k, p]) => [k, !p.ok]));
    if (kind === 'volume') nextBad.min = !parseMinutes(min).ok;
    setBad(nextBad);
    const badKey = Object.keys(nextBad).find((k) => nextBad[k]);
    if (badKey) {
      focus(badKey);
      return;
    }
    const n = (k: string): number | undefined => {
      const p = parsed[k];
      return p.ok ? p.n : undefined;
    };
    const base = { id: goal?.id ?? newId(), createdAt: goal?.createdAt ?? Date.now() };
    if (kind === 'event') {
      const distanceM = n('ekm') === undefined ? undefined : Math.round((n('ekm') as number) * 1000);
      const elevGainM = n('em') === undefined ? undefined : Math.round(n('em') as number);
      if (!distanceM && !elevGainM) {
        setEmptyError(true);
        focus('ekm');
        return;
      }
      const g: EventGoal = {
        ...base,
        kind: 'event',
        title: name.trim(),
        date: date || today,
        ...(distanceM ? { distanceM } : {}),
        ...(elevGainM ? { elevGainM } : {}),
      };
      onSave(g, replaced);
      return;
    }
    const distanceM = n('km') === undefined ? undefined : Math.round((n('km') as number) * 1000);
    const elevGainM = n('m') === undefined ? undefined : Math.round(n('m') as number);
    const movingTimeS = Math.round(((n('h') ?? 0) * 60 + (parseMinutes(min).n ?? 0)) * 60);
    if (!distanceM && !elevGainM && !movingTimeS) {
      setEmptyError(true);
      focus('km');
      return;
    }
    const g: VolumeGoal = {
      ...base,
      kind: 'volume',
      title: volumeTitle(period, start),
      period,
      start,
      ...(distanceM ? { distanceM } : {}),
      ...(elevGainM ? { elevGainM } : {}),
      ...(movingTimeS ? { movingTimeS } : {}),
    };
    onSave(g, replaced);
  };

  const mean = avg[period];
  const fill = () => {
    if (!mean) return;
    setKm(String(Math.round(mean.distanceM / 1000)));
    setM(formatNumber(Math.round(mean.elevGainM / 10) * 10));
    const total = Math.round(mean.movingTimeS / 60);
    setH(String(Math.floor(total / 60)));
    setMin(total % 60 ? String(total % 60) : '');
    setBad({});
    setEmptyError(false);
  };

  const describe = numError ? numErrId : undefined;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={goal ? 'Editar objetivo' : 'Nuevo objetivo'}
      footer={
        <button className="btn btn--primary btn--block" type="submit" form={formId}>
          {replaced ? 'Sustituir objetivo' : goal ? 'Guardar cambios' : 'Crear objetivo'}
        </button>
      }
    >
      <form className="goal-form" id={formId} noValidate onSubmit={submit}>
        {goal ? null : (
          <KindTabs
            value={kind}
            panelId={panelId}
            onChange={(k) => {
              setKind(k);
              setEmptyError(false);
              setBad({});
            }}
          />
        )}
        {warn ? (
          <p className="form-warn" aria-live="polite">
            <TriangleAlert className="ic" aria-hidden="true" />
            <span>{warn}</span>
          </p>
        ) : null}

        {kind === 'event' ? (
          <div className="goal-form" id={panelId} role={goal ? undefined : 'tabpanel'} aria-label={goal ? undefined : 'Evento'}>
            <Field
              id={id('name')}
              label="Nombre"
              type="text"
              autoComplete="off"
              maxLength={80}
              placeholder="Por ejemplo, Marxa del Lluçanès"
              value={name}
              error={nameError ? NAME_ERROR : undefined}
              onChange={(e) => {
                setName(e.target.value);
                if (e.target.value.trim()) setNameError(false);
              }}
            />
            <Field label="Fecha" type="date" required min={goal ? undefined : today} value={date || today} onChange={(e) => setDate(e.target.value)} />
            <div className="goal-pair">
              <NumberInput id={id('ekm')} label="Distancia" unit="km" decimal value={ekm} bad={!!bad.ekm} describedBy={describe ?? `${ids}-evh`} onChange={setField('ekm', setEkm, figOk)} />
              <NumberInput id={id('em')} label="Desnivel" unit="m" value={em} bad={!!bad.em} describedBy={describe ?? `${ids}-evh`} onChange={setField('em', setEm, figOk)} />
            </div>
            {numError ? (
              <p className="field-error goal-num-error" id={numErrId}>
                <CircleAlert className="ic" aria-hidden="true" />
                {numError}
              </p>
            ) : null}
            <p className="field-help goal-help" id={`${ids}-evh`}>
              Pon una o las dos: las comparamos con tus mejores salidas de las últimas 8 semanas.
            </p>
            {emptyError ? <FormError>{EVENT_EMPTY}</FormError> : null}
          </div>
        ) : (
          <div className="goal-form" id={panelId} role={goal ? undefined : 'tabpanel'} aria-label={goal ? undefined : 'Volumen'}>
            <div className="field">
              <span className="field-label" aria-hidden="true">
                Cada
              </span>
              <SegmentedControl
                label="Cada"
                quiet
                value={period}
                options={[
                  { value: 'week', label: 'Semana' },
                  { value: 'month', label: 'Mes' },
                ]}
                onChange={(p) => setPeriod(p)}
              />
            </div>
            {period === 'month' ? (
              <Field label="Mes" type="month" required value={month} onChange={(e) => setMonth(e.target.value)} />
            ) : (
              <Field
                label="Semana del"
                type="date"
                required
                value={week}
                help="Cuenta de lunes a domingo."
                onChange={(e) => setWeek(e.target.value)}
              />
            )}
            <div className="goal-pair">
              <NumberInput id={id('km')} label="Distancia" unit="km" decimal value={km} bad={!!bad.km} describedBy={describe} onChange={setField('km', setKm, figOk)} />
              <NumberInput id={id('m')} label="Desnivel" unit="m" value={m} bad={!!bad.m} describedBy={describe} onChange={setField('m', setM, figOk)} />
            </div>
            <fieldset className="field goal-set">
              <legend className="field-label">Tiempo en movimiento</legend>
              <div className="goal-pair">
                <NumberInput id={id('h')} label="Horas" unit="h" decimal srLabel value={h} bad={!!bad.h} describedBy={describe ?? `${ids}-volh`} onChange={setField('h', setH, figOk)} />
                <NumberInput id={id('min')} label="Minutos" unit="min" srLabel value={min} bad={!!bad.min} describedBy={describe ?? `${ids}-volh`} onChange={setField('min', setMin, minOk)} />
              </div>
            </fieldset>
            {numError ? (
              <p className="field-error goal-num-error" id={numErrId}>
                <CircleAlert className="ic" aria-hidden="true" />
                {numError}
              </p>
            ) : null}
            <p className="field-help goal-help" id={`${ids}-volh`}>
              Pon una cifra o varias. La primera (distancia, desnivel o tiempo) va en el anillo; las demás, en barras.
            </p>
            {mean ? (
              <button className="fill-btn" type="button" onClick={fill}>
                <Activity className="ic" aria-hidden="true" />
                <span>
                  {period === 'week' ? 'Usar tu semana media: ' : 'Usar tu mes medio: '}
                  {listAnd([
                    full('distanceM', mean.distanceM),
                    full('elevGainM', Math.round(mean.elevGainM / 10) * 10),
                    full('movingTimeS', mean.movingTimeS),
                  ])}
                </span>
              </button>
            ) : null}
            {emptyError ? <FormError>{VOLUME_EMPTY}</FormError> : null}
          </div>
        )}

        {goal ? (
          <button className="btn btn--danger btn--block" type="button" onClick={() => onDelete(goal)}>
            <Trash2 className="ic" aria-hidden="true" />
            Borrar objetivo
          </button>
        ) : null}
      </form>
    </Sheet>
  );
}

/** «Ya tienes un objetivo para esta semana: 250 km. Este lo sustituye.» */
function replaceText(g: Goal, period: Slot, start: LocalDate, today: LocalDate): string {
  if (g.kind === 'event') {
    const when = g.date === today ? 'hoy' : `el ${eventDate(g.date, today).toLowerCase()}`;
    return `Ya tienes un evento: ${g.title}, ${when}. Este lo sustituye.`;
  }
  const slot =
    period === 'week'
      ? start === periodStartOf('week', today)
        ? 'esta semana'
        : 'esa semana'
      : start === `${today.slice(0, 7)}-01`
        ? 'este mes'
        : 'ese mes';
  return `Ya tienes un objetivo para ${slot}: ${targetsText(g)}. Este lo sustituye.`;
}
