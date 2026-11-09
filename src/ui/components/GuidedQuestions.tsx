import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { Answers, Focus } from '../../ai/prompts';
import { MAX_UPLIFT, MIN_UPLIFT } from '../../ai/routePlanner';
import type { LatLng } from '../../domain/types';
import type { UserReference } from '../../metrics/reference';
import { formatCount, formatDuration, formatKm } from '../format';
import { Check, House, MapPin, Pencil, Repeat, Sparkles, Timer, type LucideIcon } from '../icons';
import { Field } from './Field';
import { StartPointMap } from './StartPointMap';

/** Las cuatro preguntas y el resumen: una pantalla cada una, en este orden. */
export type Step = 'foco' | 'tiempo' | 'salida' | 'zona' | 'resumen';
export const STEPS: Step[] = ['foco', 'tiempo', 'salida', 'zona', 'resumen'];

export const STEP_TITLE: Record<Step, string> = {
  foco: '¿Qué quieres entrenar?',
  tiempo: '¿Cuánto tiempo tienes?',
  salida: '¿Desde dónde sales?',
  zona: '¿Repetir zona o descubrir?',
  resumen: 'Tu petición',
};

/** Respuestas a medias. El punto de salida va aparte de `Answers`: solo llega a ORS. */
export type Draft = {
  focus: Focus | null;
  /** Minutos de una opción, u «otro» con los minutos escritos en `otherMin`. */
  time: number | 'otro' | null;
  otherMin: string;
  start: 'casa' | 'mapa' | null;
  point: LatLng | null;
  explore: Answers['explore'] | null;
  notes: string;
};

export const EMPTY_DRAFT: Draft = { focus: null, time: null, otherMin: '', start: null, point: null, explore: null, notes: '' };

const TIMES = [60, 90, 120, 180, 240];
export const OTHER_MIN = { min: 30, max: 600 };
export const NOTES_MAX = 200;

export function draftMinutes(d: Draft): number | null {
  if (typeof d.time === 'number') return d.time;
  if (d.time !== 'otro') return null;
  const n = Number(d.otherMin);
  return Number.isInteger(n) && n >= OTHER_MIN.min && n <= OTHER_MIN.max ? n : null;
}

/** Punto de salida de las respuestas, o `null` si falta. */
export function draftStart(d: Draft, home: LatLng | null): LatLng | null {
  if (d.start === 'casa') return home;
  return d.start === 'mapa' ? d.point : null;
}

/** ¿Está contestada la pregunta? */
export function stepDone(step: Step, d: Draft, home: LatLng | null): boolean {
  if (step === 'foco') return d.focus !== null;
  if (step === 'tiempo') return draftMinutes(d) !== null;
  if (step === 'salida') return draftStart(d, home) !== null;
  if (step === 'zona') return d.explore !== null;
  return true;
}

/** Primer paso sin contestar: hasta ahí se puede llegar. */
export function firstOpenStep(d: Draft, home: LatLng | null): Step {
  return STEPS.find((s) => !stepDone(s, d, home)) ?? 'resumen';
}

export function toAnswers(d: Draft): Answers | null {
  const minutes = draftMinutes(d);
  if (!d.focus || minutes === null || !d.explore) return null;
  return { focus: d.focus, minutes, explore: d.explore, notes: d.notes.trim() };
}

const FOCUS_TEXT: Record<Focus, string> = { fondo: 'Fondo', subidas: 'Subidas', mixto: 'Mixto' };
const EXPLORE_TEXT: Record<Answers['explore'], string> = { repetir: 'Repetir zona', descubrir: 'Descubrir' };
export const START_TEXT = { casa: 'Casa', mapa: 'Un punto del mapa' } as const;

/** Texto de la respuesta de cada pregunta, o «Sin responder». */
export function answerText(step: Step, d: Draft): string {
  const none = 'Sin responder';
  if (step === 'foco') return d.focus ? FOCUS_TEXT[d.focus] : none;
  if (step === 'tiempo') {
    const m = draftMinutes(d);
    return m === null ? none : formatDuration(m * 60);
  }
  if (step === 'salida') return d.start ? START_TEXT[d.start] : none;
  if (step === 'zona') return d.explore ? EXPLORE_TEXT[d.explore] : none;
  return '';
}

/** Rango de km y m que se pedirá: del 5 al 15 % sobre tu media en lo que entrenas; el tiempo manda. */
export function askRange(ref: UserReference, d: Draft) {
  const minutes = draftMinutes(d) ?? 0;
  const capKm = (minutes * 60 * ref.avgSpeedMs) / 1000;
  const km = ref.avgDistanceM / 1000;
  const moreKm = d.focus !== 'subidas';
  const moreElev = d.focus !== 'fondo';
  const cap = (x: number) => (capKm > 0 ? Math.min(x, capKm) : x);
  return {
    km: [cap(km * (moreKm ? MIN_UPLIFT : 1)), cap(km * (moreKm ? MAX_UPLIFT : 1))] as const,
    m: [ref.avgElevGainM * (moreElev ? MIN_UPLIFT : 1), ref.avgElevGainM * (moreElev ? MAX_UPLIFT : 1)] as const,
    timeCapped: capKm > 0 && capKm < km * (moreKm ? MIN_UPLIFT : 1),
    capKm,
  };
}

/** «53 a 58», o una sola cifra si las dos coinciden. */
export function rangeText(lo: number, hi: number, round = 1): string {
  const a = Math.round(lo / round) * round;
  const b = Math.round(hi / round) * round;
  return a === b ? formatCount(a) : `${formatCount(a)} a ${formatCount(b)}`;
}

type Option<T> = { value: T; title: string; sub?: ReactNode; lead: ReactNode; disabled?: boolean };

/**
 * Respuestas en tarjetas grandes con radio (`.opt`): tocar una la elige y avanza; con las flechas
 * se elige sin avanzar. Toda la tarjeta es el objetivo táctil.
 */
function OptionGroup<T extends string | number>({
  label,
  accent,
  options,
  value,
  onPick,
}: {
  label: string;
  accent?: string;
  options: Option<T>[];
  value: T | null;
  onPick: (v: T, advance: boolean) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.filter((o) => !o.disabled);
  const focusable = value !== null && enabled.some((o) => o.value === value) ? value : enabled[0]?.value;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    const at = enabled.findIndex((o) => refs.current[options.indexOf(o)] === document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const next = enabled[(at + dir + enabled.length) % enabled.length];
    refs.current[options.indexOf(next)]?.focus();
    onPick(next.value, false);
  };

  return (
    <div className="opts" role="radiogroup" aria-label={label} data-m={accent} onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          className="opt"
          aria-checked={value === o.value}
          disabled={o.disabled}
          tabIndex={o.value === focusable ? 0 : -1}
          onClick={() => onPick(o.value, true)}
        >
          <span className="opt-lead" aria-hidden="true">
            {o.lead}
          </span>
          <span className="opt-main">
            <span className="opt-t">{o.title}</span>
            {o.sub ? <span className="opt-s">{o.sub}</span> : null}
          </span>
          <span className="opt-mark" aria-hidden="true">
            <Check className="ic" />
          </span>
        </button>
      ))}
    </div>
  );
}

const icon = (Icon: LucideIcon) => <Icon className="ic" />;

/** Perfil en miniatura coloreado por pendiente (la escala de los perfiles), como en el prototipo. */
const TERRAIN: Record<Focus, ReactNode> = {
  fondo: (
    <svg className="terrain" viewBox="0 0 34 24">
      <path className="t0" d="M2 17L10 16L18 17L25 15.5L32 16.5" />
    </svg>
  ),
  subidas: (
    <svg className="terrain" viewBox="0 0 34 24">
      <path className="t1" d="M2 20L8 18" />
      <path className="t3" d="M8 18L20 4" />
      <path className="t0" d="M20 4L32 19" />
    </svg>
  ),
  mixto: (
    <svg className="terrain" viewBox="0 0 34 24">
      <path className="t1" d="M2 18L8 13" />
      <path className="t0" d="M8 13L13 17" />
      <path className="t2" d="M13 17L20 10" />
      <path className="t0" d="M20 10L25 15" />
      <path className="t1" d="M25 15L32 11" />
    </svg>
  ),
};

type StepProps = {
  step: Exclude<Step, 'resumen'>;
  /** Nombre del grupo de respuestas: la pregunta. */
  label: string;
  draft: Draft;
  reference: UserReference;
  home: LatLng | null;
  onChange: (patch: Partial<Draft>, advance: boolean) => void;
  onSaveHome: (p: LatLng) => void;
};

/** Una pregunta: sus respuestas y, si hace falta, el campo o el mapa que la completa. */
export function GuidedStep({ step, label, draft, reference: ref, home, onChange, onSaveHome }: StepProps) {
  if (step === 'foco') {
    const km = ref.avgDistanceM / 1000;
    return (
      <OptionGroup<Focus>
        label={label}
        value={draft.focus}
        onPick={(focus, advance) => onChange({ focus }, advance)}
        options={[
          {
            value: 'fondo',
            title: 'Fondo',
            lead: TERRAIN.fondo,
            sub: (
              <>
                Más distancia: de <b>{rangeText(km * MIN_UPLIFT, km * MAX_UPLIFT)}&nbsp;km</b>
              </>
            ),
          },
          {
            value: 'subidas',
            title: 'Subidas',
            lead: TERRAIN.subidas,
            sub: (
              <>
                Más desnivel: de <b>{rangeText(ref.avgElevGainM * MIN_UPLIFT, ref.avgElevGainM * MAX_UPLIFT, 10)}&nbsp;m</b>
              </>
            ),
          },
          { value: 'mixto', title: 'Mixto', lead: TERRAIN.mixto, sub: 'Un poco más de las dos; la IA elige en cada ruta' },
        ]}
      />
    );
  }

  if (step === 'tiempo') {
    const kmFor = (min: number) => formatKm(Math.round((min * 60 * ref.avgSpeedMs) / 1000) * 1000);
    const other = draftMinutes({ ...draft, time: 'otro' });
    return (
      <>
        <OptionGroup<number | 'otro'>
          label={label}
          accent="time"
          value={draft.time}
          onPick={(time, advance) => onChange({ time }, advance && time !== 'otro')}
          options={[
            ...TIMES.map((min) => ({
              value: min,
              title: formatDuration(min * 60),
              lead: icon(Timer),
              sub: ref.avgSpeedMs > 0 ? <>Unos <b>{kmFor(min)}</b> a tu ritmo</> : undefined,
            })),
            { value: 'otro' as const, title: 'Otro tiempo', lead: icon(Pencil), sub: 'Lo escribes en minutos' },
          ]}
        />
        {draft.time === 'otro' ? (
          <Field
            label="Minutos"
            type="number"
            inputMode="numeric"
            min={OTHER_MIN.min}
            max={OTHER_MIN.max}
            step={5}
            suffix="min"
            value={draft.otherMin}
            onChange={(e) => onChange({ otherMin: e.target.value }, false)}
            help={
              other !== null && ref.avgSpeedMs > 0 ? (
                <>
                  {formatDuration(other * 60)}: unos <b>{kmFor(other)}</b> a tu ritmo
                </>
              ) : (
                `Entre ${OTHER_MIN.min} y ${OTHER_MIN.max} minutos.`
              )
            }
          />
        ) : null}
      </>
    );
  }

  if (step === 'salida') {
    return (
      <>
        <OptionGroup<'casa' | 'mapa'>
          label={label}
          accent="dist"
          value={draft.start}
          onPick={(start, advance) => onChange({ start }, advance && start === 'casa')}
          options={[
            {
              value: 'casa',
              title: 'Casa',
              lead: icon(House),
              disabled: !home,
              sub: home ? 'Tu punto guardado. La IA nunca lo ve.' : 'Guárdala en Ajustes o desde el mapa.',
            },
            { value: 'mapa', title: 'Un punto del mapa', lead: icon(MapPin), sub: 'Solo lo recibe OpenRouteService, nunca la IA.' },
          ]}
        />
        {draft.start === 'mapa' ? (
          <StartPointMap value={draft.point} home={home} onChange={(point) => onChange({ point }, false)} onSaveHome={onSaveHome} />
        ) : null}
      </>
    );
  }

  return (
    <OptionGroup<Answers['explore']>
      label={label}
      accent="elev"
      value={draft.explore}
      onPick={(explore, advance) => onChange({ explore }, advance)}
      options={[
        { value: 'repetir', title: 'Repetir zona', lead: icon(Repeat), sub: 'Carreteras que ya conoces' },
        { value: 'descubrir', title: 'Descubrir', lead: icon(Sparkles), sub: 'Prioriza carretera que no has rodado' },
      ]}
    />
  );
}

/** Resumen: cada respuesta en una fila que vuelve a su pregunta. */
export function AnswerList({ draft, onEdit }: { draft: Draft; onEdit: (s: Step) => void }) {
  const rows: { step: Step; label: string; accent: string; Icon: LucideIcon }[] = [
    { step: 'foco', label: 'Entrenar', accent: 'elev', Icon: Sparkles },
    { step: 'tiempo', label: 'Tiempo', accent: 'time', Icon: Timer },
    { step: 'salida', label: 'Sale de', accent: 'dist', Icon: MapPin },
    { step: 'zona', label: 'Zona', accent: 'speed', Icon: Repeat },
  ];
  return (
    <ul className="list list--inset" aria-label="Tus respuestas">
      {rows.map(({ step, label, accent, Icon }) => (
        <li key={step}>
          <button type="button" className="row" data-m={accent} onClick={() => onEdit(step)}>
            <span className="row-lead" aria-hidden="true">
              <Icon className="ic" />
            </span>
            <span className="row-main">
              <span className="row-meta">{label}</span>
              <span className="row-title">{answerText(step, draft)}</span>
            </span>
            <span className="row-trail">
              <span className="sr-only">Cambiar</span>
              <Pencil className="chev" aria-hidden="true" />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** «Lo que pedirás»: el rango de km y m que calcula el código y de dónde sale. */
export function AskCard({ draft, reference }: { draft: Draft; reference: UserReference }) {
  const r = askRange(reference, draft);
  const minutes = draftMinutes(draft) ?? 0;
  return (
    <section className="card ask" data-m="elev" aria-labelledby="ia-ask-t">
      <div className="card-h">
        <span className="card-ic" aria-hidden="true">
          <Sparkles className="ic" />
        </span>
        <h2 className="card-title" id="ia-ask-t">
          Lo que pedirás
        </h2>
      </div>
      <p className="ask-figs">
        <span>
          <b>{rangeText(r.km[0], r.km[1])}</b>km
        </span>
        <span>
          <b>{rangeText(r.m[0], r.m[1], 10)}</b>m
        </span>
      </p>
      <p className="muted">
        {r.timeCapped
          ? `Tu tiempo manda: con ${formatDuration(minutes * 60)} no da para más de ${formatKm(r.capKm * 1000)}. `
          : ''}
        De 3 a 5 rutas desde {draft.start === 'mapa' ? 'el punto del mapa' : 'Casa'}, cada una con su forma, su perfil por pendiente y
        por qué encaja contigo.
      </p>
    </section>
  );
}

/** Nota libre para la IA, con el aviso de privacidad. */
export function NotesField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field
      label="Algo más (opcional)"
      maxLength={NOTES_MAX}
      autoComplete="off"
      placeholder="Por ejemplo: sin la nacional"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      help="No escribas direcciones: este texto se envía a la IA."
    />
  );
}

