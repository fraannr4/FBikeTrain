import { useId, useState, type FormEvent } from 'react';
import { newId } from '../../calendar/calendarRepo';
import type { LocalDate, PlannedWorkout } from '../../domain/types';
import { CircleAlert, CircleCheck, Trash2 } from '../icons';
import { formatNumber } from '../format';
import { Field } from './Field';
import { Sheet } from './Sheet';

type Props = {
  open: boolean;
  /** Entreno que se edita; `null` para planificar uno nuevo el día `date`. */
  workout: PlannedWorkout | null;
  date: LocalDate;
  onClose: () => void;
  onSave: (w: PlannedWorkout) => void;
  onDelete: (w: PlannedWorkout) => void;
};

type Parsed = { ok: true; n?: number } | { ok: false; dot?: boolean };

/**
 * Cifra escrita a mano: '' vacío; '1.050' y '74,5' números; 'abc' o '-500' inválidos. El punto es
 * separador de miles si cuadra ('1.050', '12.500,5'); un solo punto con 1 o 2 cifras detrás es
 * decimal, porque muchos teclados Android lo sacan ('74.5'). Cualquier otro punto es ambiguo.
 */
export function parseFigure(raw: string): Parsed {
  let v = raw.replace(/[\s  ]/g, '');
  if (!v) return { ok: true };
  if (v.includes('.')) {
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(v)) v = v.replace(/\./g, '');
    else if (/^\d+\.\d{1,2}$/.test(v)) v = v.replace('.', ',');
    else return { ok: false, dot: true };
  }
  if (!/^\d+(,\d+)?$/.test(v)) return { ok: false };
  const n = Number(v.replace(',', '.'));
  return { ok: true, n: n > 0 ? n : undefined };
}

function figureError(raw: string, decimal: string, whole: string): string {
  const p = parseFigure(raw);
  if (p.ok) return '';
  return p.dot
    ? `No sabemos si «${raw.trim()}» lleva decimales. Escribe ${decimal} o ${whole}.`
    : `Escribe solo la cifra, por ejemplo ${decimal}.`;
}

const figureText = (n: number | undefined): string =>
  n === undefined ? '' : formatNumber(n, Number.isInteger(Math.round(n * 10) / 10) ? 0 : 1);

/**
 * Hoja para planificar o editar un entreno: día, nombre, distancia, desnivel y notas; al editar,
 * además, el interruptor «Hecho» y «Borrar entreno». Pide km y m y devuelve metros.
 */
export function WorkoutForm({ open, workout, date, onClose, onSave, onDelete }: Props) {
  const ids = useId();
  const [day, setDay] = useState(workout?.date ?? date);
  const [title, setTitle] = useState(workout?.title ?? '');
  const [km, setKm] = useState(figureText(workout?.distanceM === undefined ? undefined : workout.distanceM / 1000));
  const [m, setM] = useState(figureText(workout?.elevGainM));
  const [notes, setNotes] = useState(workout?.notes ?? '');
  const [done, setDone] = useState(workout?.done ?? false);
  const [titleError, setTitleError] = useState(false);
  const [badKm, setBadKm] = useState(false);
  const [badM, setBadM] = useState(false);

  const numError = badKm ? figureError(km, '74,5', '745') : badM ? figureError(m, '1.050', '1050') : '';
  const numErrId = `${ids}-num`;
  const formId = `${ids}-form`;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setTitleError(true);
      document.getElementById(`${ids}-title`)?.focus();
      return;
    }
    const pk = parseFigure(km);
    const pm = parseFigure(m);
    setBadKm(!pk.ok);
    setBadM(!pm.ok);
    if (!pk.ok || !pm.ok) {
      document.getElementById(`${ids}-${pk.ok ? 'm' : 'km'}`)?.focus();
      return;
    }
    // Al cambiar «Hecho» a mano, la sincronización deja de tocarlo; al desmarcar, se quita el enlace.
    const changedDone = workout !== null && done !== workout.done;
    const activityId = changedDone && !done ? undefined : workout?.activityId;
    const note = notes.trim();
    onSave({
      id: workout?.id ?? newId(),
      createdAt: workout?.createdAt ?? Date.now(),
      done: workout?.done ?? false,
      manual: workout?.manual ?? false,
      date: day || date,
      title: title.trim(),
      ...(pk.n !== undefined ? { distanceM: Math.round(pk.n * 1000) } : {}),
      ...(pm.n !== undefined ? { elevGainM: Math.round(pm.n) } : {}),
      ...(note ? { notes: note } : {}),
      ...(activityId !== undefined ? { activityId } : {}),
      ...(changedDone ? { done, manual: true } : {}),
    });
  };

  const numInput = (key: 'km' | 'm', label: string, unit: string, value: string, bad: boolean, set: (v: string) => void) => (
    <div className="field" data-invalid={bad ? '' : undefined}>
      <label className="field-label" htmlFor={`${ids}-${key}`}>
        {label}
      </label>
      <div className="input-wrap unit-wrap">
        <input
          id={`${ids}-${key}`}
          className="input"
          type="text"
          inputMode={key === 'km' ? 'decimal' : 'numeric'}
          autoComplete="off"
          value={value}
          aria-invalid={bad || undefined}
          aria-describedby={numError ? numErrId : undefined}
          onChange={(e) => {
            set(e.target.value);
            if (bad && parseFigure(e.target.value).ok) (key === 'km' ? setBadKm : setBadM)(false);
          }}
        />
        <span className="sfx" aria-hidden="true">
          {unit}
        </span>
      </div>
    </div>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={workout ? 'Editar entreno' : 'Planificar entreno'}
      footer={
        <button className="btn btn--primary btn--block" type="submit" form={formId}>
          {workout ? 'Guardar cambios' : 'Guardar entreno'}
        </button>
      }
    >
      <form className="wo-form" id={formId} noValidate onSubmit={submit}>
        <Field label="Día" type="date" required value={day} onChange={(e) => setDay(e.target.value)} />
        <Field
          id={`${ids}-title`}
          label="Nombre"
          type="text"
          autoComplete="off"
          enterKeyHint="next"
          maxLength={80}
          placeholder="Por ejemplo, Lluçanès por Prats"
          value={title}
          error={titleError ? 'Ponle un nombre: la zona o el puerto bastan.' : undefined}
          onChange={(e) => {
            setTitle(e.target.value);
            if (e.target.value.trim()) setTitleError(false);
          }}
        />
        <div className="wo-pair">
          {numInput('km', 'Distancia', 'km', km, badKm, setKm)}
          {numInput('m', 'Desnivel', 'm', m, badM, setM)}
        </div>
        {numError ? (
          <p className="field-error wo-num-error" id={numErrId}>
            <CircleAlert className="ic" aria-hidden="true" />
            {numError}
          </p>
        ) : null}
        <div className="field">
          <label className="field-label" htmlFor={`${ids}-notes`}>
            Notas <span className="wo-optional">(opcional)</span>
          </label>
          <textarea
            id={`${ids}-notes`}
            className="input wo-notes-input"
            rows={2}
            placeholder="Hora, con quién, qué llevar"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {workout ? (
          <>
            <ul className="list wo-done-row">
              <li>
                <div className="row">
                  <span className="row-lead" aria-hidden="true">
                    <CircleCheck className="ic" />
                  </span>
                  <span className="row-main">
                    <span className="row-title" id={`${ids}-done`}>
                      Hecho
                    </span>
                    <span className="row-meta">Se marca solo al importar la salida</span>
                  </span>
                  <span className="row-trail">
                    <button
                      type="button"
                      className="switch"
                      role="switch"
                      aria-checked={done}
                      aria-labelledby={`${ids}-done`}
                      onClick={() => setDone((v) => !v)}
                    />
                  </span>
                </div>
              </li>
            </ul>
            <button className="btn btn--danger btn--block" type="button" onClick={() => onDelete(workout)}>
              <Trash2 className="ic" aria-hidden="true" />
              Borrar entreno
            </button>
          </>
        ) : null}
      </form>
    </Sheet>
  );
}
