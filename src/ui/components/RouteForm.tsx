import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { EASY_BELOW_RATIO, HARD_ABOVE_RATIO, type Difficulty, type UserReference } from '../../metrics/reference';
import type { Target } from '../../metrics/score';
import { formatCount, formatKm } from '../format';
import { Sparkles } from '../icons';
import { DISTANCE_KM, ELEVATION_M, defaultTarget, elevationFor, levelOf } from '../routes/routeView';
import { DifficultyBars } from './Chip';
import { ListRow } from './ListRow';
import { SegmentedControl } from './SegmentedControl';
import { Stepper } from './Stepper';

type Props = {
  /** `id` del formulario: los botones de enviar viven fuera (pie de la hoja o dock) con `form={id}`. */
  id: string;
  initial?: Partial<Target>;
  /** Tu referencia de 8-12 semanas: da «Tu salida media» y la dificultad «para ti». */
  reference?: UserReference | null;
  onSubmit: (t: Target) => void;
  busy?: boolean;
  /** Grupos propios antes del interruptor de carretera nueva: de dónde sale la ruta. */
  children?: ReactNode;
};

/** Cada nivel con sus barras 1-3, como en toda la app: la dificultad nunca va solo en texto. */
const LEVELS: { value: Difficulty; label: string; lead: ReactNode }[] = (['Suave', 'Media', 'Dura'] as const).map((l) => ({
  value: l,
  label: l,
  lead: <DifficultyBars level={l} />,
}));
/** Sin referencia, los cortes por km del prototipo (m/km). */
const GENERIC_CUTS = { easy: 11, hard: 18 };
const round50 = (m: number) => Math.round(m / 50) * 50;

/** Rango de desnivel del nivel elegido: «Media para ti: de 700 a 900 m». */
function elevationHint(level: Difficulty, km: number, ref: UserReference | null): ReactNode {
  let lo: number;
  let hi: number;
  if (ref) {
    if (ref.avgElevGainM <= 0) return null;
    lo = round50(ref.avgElevGainM * EASY_BELOW_RATIO);
    hi = round50(ref.avgElevGainM * HARD_ABOVE_RATIO);
  } else {
    lo = round50(km * GENERIC_CUTS.easy);
    hi = round50(km * GENERIC_CUTS.hard);
  }
  const who = ref ? `${level} para ti` : level;
  if (level === 'Suave') return <>{who}: hasta <b>{formatCount(lo)}&nbsp;m</b></>;
  if (level === 'Dura') return <>{who}: más de <b>{formatCount(hi)}&nbsp;m</b></>;
  return (
    <>
      {who}: de <b>{formatCount(lo)}</b> a <b>{formatCount(hi)}&nbsp;m</b>
    </>
  );
}

/**
 * Qué ruta quieres: distancia y desnivel con pasos grandes, la dificultad que resulta (y que, al
 * elegirla, ajusta el desnivel) y si se prefiere carretera nueva. Va en la página mientras no hay
 * rutas y, después, en la hoja «Cambiar».
 */
export function RouteForm({ id, initial, reference = null, onSubmit, busy, children }: Props) {
  const base = { ...defaultTarget(reference), ...initial };
  const [km, setKm] = useState(base.distanceM / 1000);
  const [elev, setElev] = useState(base.elevGainM ?? elevationFor('Media', base.distanceM, reference));
  const [preferNew, setPreferNew] = useState(base.preferNew);
  const uid = useId();

  const distanceM = km * 1000;
  const level = levelOf({ distanceM, elevGainM: elev }, reference);
  // Con referencia, la distancia sola puede subir el nivel: se dice, para que el desnivel no despiste.
  const byClimb = reference ? levelOf({ distanceM: 0, elevGainM: elev }, reference) : level;
  const atLimit = km <= DISTANCE_KM.min || km >= DISTANCE_KM.max;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({ distanceM, elevGainM: elev, preferNew });
  };

  return (
    <form id={id} className="gen" onSubmit={submit} aria-busy={busy || undefined} noValidate>
      <div className="gen-group">
        <div className="gen-label-row">
          <p className="gen-label" aria-hidden="true">
            Distancia
          </p>
          <p className="gen-hint">
            {atLimit ? (
              `Entre ${DISTANCE_KM.min} y ${DISTANCE_KM.max} km`
            ) : reference ? (
              <>
                Tu salida media: <b>{formatKm(reference.avgDistanceM)}</b>
              </>
            ) : null}
          </p>
        </div>
        <Stepper
          label="Distancia"
          unit="km"
          value={km}
          onChange={setKm}
          min={DISTANCE_KM.min}
          max={DISTANCE_KM.max}
          step={DISTANCE_KM.step}
        />
      </div>

      <div className="gen-group">
        <p className="gen-label" aria-hidden="true">
          {reference ? 'Dificultad para ti' : 'Dificultad'}
        </p>
        <SegmentedControl
          label={reference ? 'Dificultad para ti' : 'Dificultad'}
          options={LEVELS}
          value={level}
          onChange={(l) => setElev(elevationFor(l, distanceM, reference))}
        />
      </div>

      <div className="gen-group">
        <div className="gen-label-row">
          <p className="gen-label" aria-hidden="true">
            Desnivel
          </p>
          <p className="gen-hint">
            {byClimb !== level ? (
              <>
                Con <b>{formatKm(distanceM)}</b> ya es {level} para ti
              </>
            ) : (
              elevationHint(level, km, reference)
            )}
          </p>
        </div>
        <Stepper
          label="Desnivel"
          unit="m"
          value={elev}
          onChange={setElev}
          min={ELEVATION_M.min}
          max={ELEVATION_M.max}
          step={ELEVATION_M.step}
        />
      </div>

      {children}

      <ul className="list list--inset">
        <ListRow
          icon={Sparkles}
          accent="time"
          title="Priorizar carretera nueva"
          titleId={`${uid}-new`}
          meta="Evita lo que ya has rodado"
          trail={
            <button
              type="button"
              className="switch"
              role="switch"
              aria-checked={preferNew}
              aria-labelledby={`${uid}-new`}
              onClick={() => setPreferNew((v) => !v)}
            />
          }
        />
      </ul>
    </form>
  );
}
