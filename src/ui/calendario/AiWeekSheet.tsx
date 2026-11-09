import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isAbort } from '../../ai/abort';
import { buildLevelSummary, climbsInWindow, resolveReference } from '../../ai/levelSummary';
import { createSharedWorkoutPlanner, SHARED_AI_ENABLED } from '../../ai/sharedClient';
import { nextGoal, proposeWeek, toPlannedWorkouts, type ProposedWorkout, type WeekProposal } from '../../ai/workoutPlanner';
import { listGoals, saveWorkout } from '../../calendar/calendarRepo';
import { listActivities, listClimbEfforts } from '../../db/repo';
import type { LocalDate, PlannedWorkout } from '../../domain/types';
import { localDay } from '../../metrics/calendar';
import { sessionToken } from '../../routes/orsProxy';
import { loadSettings } from '../../settings/settings';
import { addDays, dayNumber, longDate, relativeDayName, weekdayInitial } from '../calendarGrid';
import { CyclingLoader } from '../components/CyclingLoader';
import { Sheet } from '../components/Sheet';
import { formatCount, formatNumber } from '../format';
import { Check, CircleAlert, RefreshCw, Sparkles } from '../icons';
import { referenceRange } from '../routes/routeView';

export type WeekAsk = { disponibles: number[]; ocupados: number[]; notas: string };
export type ProposeWeekFn = (req: WeekAsk, signal: AbortSignal) => Promise<WeekProposal>;

const MAX_NOTES = 200;
const UNEXPECTED = 'No se ha podido preparar la semana. Vuelve a intentarlo.';
const SAVE_FAILED = 'No se han podido guardar todos los entrenos. Vuelve a pulsar «Añadir» para guardar los que faltan.';
const NO_LEVEL = 'Aún no conocemos tu nivel: importa tus salidas o contesta las preguntas de Rutas con IA.';

/**
 * Propuesta real: nivel de la ventana de referencia, objetivo más próximo y la IA compartida
 * (con cuenta y `VITE_SHARED_AI_ENABLED`) o la clave propia de Ajustes.
 */
export function createWeekProposer(client: SupabaseClient | null): ProposeWeekFn {
  return async (req, signal) => {
    const now = Date.now();
    const acts = await listActivities(referenceRange(now));
    const [settings, climbs, goals, reference] = await Promise.all([
      loadSettings(),
      listClimbEfforts(acts.map((a) => a.id)),
      listGoals(),
      resolveReference(acts, now),
    ]);
    if (!reference) return { ok: false, cause: 'other', message: NO_LEVEL };
    const summary = buildLevelSummary(reference, climbsInWindow(climbs, reference, now));
    const shared = SHARED_AI_ENABLED && client ? createSharedWorkoutPlanner(sessionToken(client)) : undefined;
    return proposeWeek(
      { summary, objetivo: nextGoal(goals, localDay(now)), ...req },
      { personal: settings.llm, shared, signal },
    );
  };
}

type Proposal = Extract<WeekProposal, { ok: true }>;
type State =
  | { kind: 'form' }
  | { kind: 'loading' }
  | { kind: 'result'; proposal: Proposal; picked: ReadonlySet<number>; saving: boolean; saveError?: boolean }
  | { kind: 'error'; message: string };

type Props = {
  open: boolean;
  onClose: () => void;
  /** Hoy en Madrid: el día 0 de la propuesta. */
  today: LocalDate;
  /** Días de los próximos 7 (índices desde hoy) que ya tienen entreno. */
  busy: number[];
  propose: ProposeWeekFn;
  /** Ayuda bajo las notas (por ejemplo, que el servicio común no las envía). */
  notesHelp?: string;
  onAdded: (saved: PlannedWorkout[]) => void;
};

/** Copia del conjunto con `d` marcado o desmarcado. */
function toggled(set: ReadonlySet<number>, d: number): Set<number> {
  const next = new Set(set);
  if (!next.delete(d)) next.add(d);
  return next;
}

function figures(e: ProposedWorkout): string {
  const km = `${formatNumber(e.distanciaKm, Number.isInteger(e.distanciaKm) ? 0 : 1)} km`;
  return e.desnivelM === null ? km : `${km} · ${formatCount(e.desnivelM)} m`;
}

/**
 * Hoja «Proponer semana con IA»: días disponibles y notas, espera cancelable, propuestas con casillas
 * (todas marcadas) y «Añadir al calendario (N)». Solo se guarda lo que el usuario acepta.
 */
export function AiWeekSheet({ open, onClose, today, busy, propose, notesHelp, onAdded }: Props) {
  const ids = useId();
  const [chosen, setChosen] = useState<ReadonlySet<number>>(
    () => new Set([0, 1, 2, 3, 4, 5, 6].filter((d) => !busy.includes(d))),
  );
  const [notes, setNotes] = useState('');
  const [noDays, setNoDays] = useState(false);
  const [state, setState] = useState<State>({ kind: 'form' });
  const abort = useRef<AbortController | null>(null);
  // Entrenos ya guardados en un intento que falló a medias: al cerrar, el calendario los recarga.
  const savedSoFar = useRef<PlannedWorkout[]>([]);
  const allBusy = [0, 1, 2, 3, 4, 5, 6].every((d) => busy.includes(d));

  useEffect(() => () => abort.current?.abort(), []);

  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));

  const toggle = (d: number) => {
    setNoDays(false);
    setChosen((s) => toggled(s, d));
  };

  const run = async () => {
    const disponibles = [...chosen].filter((d) => !busy.includes(d)).sort((a, b) => a - b);
    if (disponibles.length === 0) {
      setNoDays(true);
      return;
    }
    abort.current?.abort();
    const ctrl = (abort.current = new AbortController());
    setState({ kind: 'loading' });
    try {
      const p = await propose({ disponibles, ocupados: busy, notas: notes.trim().slice(0, MAX_NOTES) }, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setState(p.ok ? { kind: 'result', proposal: p, picked: new Set(p.entrenos.map((e) => e.dia)), saving: false } : { kind: 'error', message: p.message });
    } catch (e) {
      if (ctrl.signal.aborted || isAbort(e)) return;
      setState({ kind: 'error', message: UNEXPECTED });
    }
  };

  const cancel = () => {
    abort.current?.abort();
    setState({ kind: 'form' });
  };

  const close = () => {
    abort.current?.abort();
    if (savedSoFar.current.length) onAdded(savedSoFar.current);
    else onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run();
  };

  const add = async () => {
    if (state.kind !== 'result') return;
    const accepted = state.proposal.entrenos.filter((e) => state.picked.has(e.dia));
    const ws = toPlannedWorkouts(accepted, today, Date.now());
    setState({ ...state, saving: true, saveError: false });
    const saved = new Set<number>();
    try {
      for (const [i, w] of ws.entries()) {
        await saveWorkout(w);
        saved.add(accepted[i].dia);
        savedSoFar.current.push(w);
      }
    } catch {
      // Se conserva la propuesta sin los ya guardados: reintentar guarda solo los que faltan y no
      // vuelve a pedir (ni a gastar cuota de) la IA.
      const left = state.proposal.entrenos.filter((e) => !saved.has(e.dia));
      setState({
        kind: 'result',
        proposal: { ...state.proposal, entrenos: left },
        picked: new Set([...state.picked].filter((d) => !saved.has(d))),
        saving: false,
        saveError: true,
      });
      return;
    }
    onAdded(savedSoFar.current);
  };

  const formId = `${ids}-form`;
  let footer;
  if (state.kind === 'form') {
    footer = (
      <button className="btn btn--primary btn--block" type="submit" form={formId} disabled={allBusy}>
        <Sparkles className="ic" aria-hidden="true" />
        Proponer
      </button>
    );
  } else if (state.kind === 'loading') {
    footer = (
      <button className="btn btn--secondary btn--block" type="button" onClick={cancel}>
        Cancelar
      </button>
    );
  } else if (state.kind === 'result') {
    const n = state.picked.size;
    footer = (
      <button className="btn btn--primary btn--block" type="button" disabled={n === 0 || state.saving} onClick={() => void add()}>
        <Check className="ic" aria-hidden="true" />
        Añadir al calendario ({n})
      </button>
    );
  } else {
    footer = (
      <button className="btn btn--primary btn--block" type="button" onClick={() => void run()}>
        <RefreshCw className="ic" aria-hidden="true" />
        Volver a intentarlo
      </button>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Proponer semana con IA"
      sub="De 1 a 7 entrenos para los próximos 7 días, según tu nivel y tu próximo objetivo. Tú eliges cuáles añadir."
      className="sheet--aiw"
      footer={footer}
    >
      {state.kind === 'form' ? (
        <form className="aiw-form" id={formId} noValidate onSubmit={submit}>
          <fieldset className="aiw-days">
            <legend className="field-label">Días en que puedes salir</legend>
            <div className="aiw-chips">
              {days.map((d, i) => {
                const isBusy = busy.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    className="fchip aiw-chip"
                    aria-pressed={!isBusy && chosen.has(i)}
                    aria-label={isBusy ? `${longDate(d)}, ya tiene entreno` : longDate(d)}
                    disabled={isBusy}
                    onClick={() => toggle(i)}
                  >
                    <span>
                      <b aria-hidden="true">{weekdayInitial(d)}</b>
                      <span aria-hidden="true">{dayNumber(d)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {allBusy ? (
              <p className="aiw-hint" role="status">
                Ya tienes entreno los 7 próximos días. Borra o mueve alguno para pedir una propuesta.
              </p>
            ) : noDays ? (
              <p className="field-error" role="alert">
                <CircleAlert className="ic" aria-hidden="true" />
                Elige al menos un día sin entreno.
              </p>
            ) : (
              <p className="aiw-hint">Los días que ya tienen entreno se respetan.</p>
            )}
          </fieldset>
          <div className="field">
            <label className="field-label" htmlFor={`${ids}-notes`}>
              Notas <span className="wo-optional">(opcional)</span>
            </label>
            <textarea
              id={`${ids}-notes`}
              className="input wo-notes-input"
              rows={2}
              maxLength={MAX_NOTES}
              placeholder="Por ejemplo, el jueves voy justo de tiempo"
              aria-describedby={notesHelp ? `${ids}-notes-help` : undefined}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            {notesHelp ? (
              <p className="field-help" id={`${ids}-notes-help`}>
                {notesHelp}
              </p>
            ) : null}
          </div>
        </form>
      ) : null}

      {state.kind === 'loading' ? (
        <div className="aiw-wait" role="status">
          <CyclingLoader compact />
          <p>Preparando tu semana…</p>
        </div>
      ) : null}

      {state.kind === 'error' ? (
        <div className="aiw-error">
          <p className="field-error" role="alert">
            <CircleAlert className="ic" aria-hidden="true" />
            {state.message}
          </p>
          <button className="btn btn--ghost" type="button" onClick={() => setState({ kind: 'form' })}>
            Cambiar días o notas
          </button>
        </div>
      ) : null}

      {state.kind === 'result' ? (
        <div className="aiw-result">
          {state.saveError ? (
            <p className="field-error" role="alert">
              <CircleAlert className="ic" aria-hidden="true" />
              {SAVE_FAILED}
            </p>
          ) : null}
          <p className="aiw-why">{state.proposal.motivo}</p>
          <ul className="aiw-list" aria-label="Entrenos propuestos">
            {state.proposal.entrenos.map((e) => {
              const date = addDays(today, e.dia);
              const id = `${ids}-e${e.dia}`;
              return (
                <li key={e.dia}>
                  <input
                    id={id}
                    type="checkbox"
                    className="aiw-check"
                    checked={state.picked.has(e.dia)}
                    disabled={state.saving}
                    onChange={() => setState({ ...state, picked: toggled(state.picked, e.dia) })}
                  />
                  <label htmlFor={id} className="aiw-item">
                    <span className="aiw-when">{relativeDayName(date, today)}</span>
                    <b className="aiw-title">{e.titulo}</b>
                    <span className="aiw-figs">{figures(e)}</span>
                    {e.notas ? <span className="aiw-notes">{e.notas}</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
          {state.proposal.descartadas > 0 ? (
            <p className="aiw-hint">
              {state.proposal.descartadas === 1
                ? 'Se ha quitado 1 propuesta que no encajaba con tus días o tu nivel.'
                : `Se han quitado ${state.proposal.descartadas} propuestas que no encajaban con tus días o tu nivel.`}
            </p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
