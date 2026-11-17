import { useState } from 'react';
import type { RiderThresholds } from '../../domain/types';
import {
  FTP_FACTOR_20MIN,
  FTP_MAX_W,
  FTP_MIN_W,
  FTP_WINDOW_S,
  MAX_HR_MAX,
  MAX_HR_MIN,
  validateThresholds,
  type ThresholdField,
} from '../../metrics/thresholds';
import { ESTIMATE_WINDOW_DAYS, estimateFromHistory } from '../../settings/estimateThresholds';
import { Banner } from '../components/Banner';
import { Disclosure } from '../components/Disclosure';
import { Field } from '../components/Field';
import { HeartPulse, LoaderCircle, Sparkles } from '../icons';

type Texts = Record<ThresholdField, string>;

const toText = (n: number | null) => (n === null ? '' : String(n));
const toNumber = (text: string): number | null => {
  const t = text.trim().replace(',', '.');
  return t === '' ? null : Number(t);
};

type Props = {
  value: RiderThresholds;
  defaultOpen: boolean;
  /** Guarda los umbrales; devuelve si se pudo. */
  onSave: (t: RiderThresholds) => Promise<boolean>;
};

function summary(t: RiderThresholds): string {
  const parts = [
    t.ftpW !== null ? `FTP ${t.ftpW} W` : null,
    t.maxHr !== null ? `Pulso máx. ${t.maxHr}` : null,
    t.thresholdHr !== null ? `Umbral ${t.thresholdHr}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Sin definir';
}

/**
 * Ajustes > «Tu forma»: FTP, pulso máximo y pulso de umbral. Vacío es «no lo sé»: sin valor no hay zonas
 * ni carga por potencia o pulso, y la IA no habla de vatios. Se puede estimar con el historial (rotulado
 * como estimado) y todo sigue editable.
 */
export function ThresholdsSection({ value, defaultOpen, onSave }: Props) {
  const [texts, setTexts] = useState<Texts>({ ftpW: toText(value.ftpW), maxHr: toText(value.maxHr), thresholdHr: toText(value.thresholdHr) });
  const [errors, setErrors] = useState<Partial<Record<ThresholdField, string>>>({});
  const [flags, setFlags] = useState({ ftp: Boolean(value.ftpEstimated), maxHr: Boolean(value.maxHrEstimated) });
  const [estimating, setEstimating] = useState(false);
  const [estimateNote, setEstimateNote] = useState<string[] | null>(null);
  const [current, setCurrent] = useState(value);

  function parse(t: Texts): Pick<RiderThresholds, ThresholdField> {
    return { ftpW: toNumber(t.ftpW), maxHr: toNumber(t.maxHr), thresholdHr: toNumber(t.thresholdHr) };
  }

  /** Valida y guarda si cambió. Con un error no se guarda nada y el campo lo explica. */
  async function commit(t: Texts, nextFlags = flags) {
    const nums = parse(t);
    const v = validateThresholds(nums);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setErrors({});
    const next: RiderThresholds = {
      ...nums,
      ...(nums.ftpW !== null && nextFlags.ftp ? { ftpEstimated: true } : {}),
      ...(nums.maxHr !== null && nextFlags.maxHr ? { maxHrEstimated: true } : {}),
    };
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    if (await onSave(next)) setCurrent(next);
  }

  function edit(field: ThresholdField, text: string) {
    setTexts((t) => ({ ...t, [field]: text }));
    // Escribir a mano un valor deja de ser una estimación.
    if (field === 'ftpW') setFlags((f) => ({ ...f, ftp: false }));
    if (field === 'maxHr') setFlags((f) => ({ ...f, maxHr: false }));
  }

  async function estimate() {
    setEstimating(true);
    setEstimateNote(null);
    try {
      const e = await estimateFromHistory(Date.now());
      const notes: string[] = [];
      const nextTexts = { ...texts };
      const nextFlags = { ...flags };
      if (e.ftp) {
        nextTexts.ftpW = String(e.ftp.ftpW);
        nextFlags.ftp = true;
        notes.push(
          `FTP estimado: ${e.ftp.ftpW} W, el ${Math.round(FTP_FACTOR_20MIN * 100)} % de tu mejor media de ${FTP_WINDOW_S / 60} minutos (${Math.round(e.ftp.best20W)} W).`,
        );
      } else {
        notes.push(
          e.ridesWithPower === 0
            ? 'Sin FTP estimado: tus salidas no traen potencia.'
            : `Sin FTP estimado: ninguna salida con potencia tiene ${FTP_WINDOW_S / 60} minutos seguidos con un valor razonable.`,
        );
      }
      if (e.maxHr) {
        nextTexts.maxHr = String(e.maxHr.maxHr);
        nextFlags.maxHr = true;
        notes.push(`Pulso máximo estimado: ${e.maxHr.maxHr} lpm, el más alto que has mantenido varios segundos.`);
      } else {
        notes.push(e.ridesWithHr === 0 ? 'Sin pulso máximo estimado: tus salidas no traen pulso.' : 'Sin pulso máximo estimado: los pulsos registrados no son creíbles.');
      }
      setTexts(nextTexts);
      setFlags(nextFlags);
      setEstimateNote(notes);
      await commit(nextTexts, nextFlags);
    } catch {
      setEstimateNote(['No se han podido leer tus salidas. Vuelve a intentarlo.']);
    } finally {
      setEstimating(false);
    }
  }

  return (
    <Disclosure
      id="umbrales"
      name="ajustes"
      icon={HeartPulse}
      accent="speed"
      title="Tu forma: FTP y pulso"
      meta={summary(current)}
      defaultOpen={defaultOpen}
    >
      <Banner>
        Con tu FTP y tu pulso máximo, la app mide la <b>carga</b> de cada salida y tu forma. Si no los sabes, déjalos
        vacíos: no se inventa nada.
      </Banner>
      <Field
        id="ftpW"
        label="FTP"
        suffix="W"
        inputMode="numeric"
        autoComplete="off"
        placeholder="Sin definir"
        value={texts.ftpW}
        error={errors.ftpW}
        help={
          flags.ftp
            ? 'Estimado desde tus salidas. Cámbialo si conoces el real.'
            : `La potencia que podrías aguantar una hora, entre ${FTP_MIN_W} y ${FTP_MAX_W} W.`
        }
        onChange={(e) => edit('ftpW', e.target.value)}
        onBlur={() => void commit(texts)}
      />
      <Field
        id="maxHr"
        label="Pulso máximo"
        suffix="lpm"
        inputMode="numeric"
        autoComplete="off"
        placeholder="Sin definir"
        value={texts.maxHr}
        error={errors.maxHr}
        help={
          flags.maxHr
            ? 'Estimado desde tus salidas. Cámbialo si conoces el real.'
            : `El más alto que has llegado a tener, entre ${MAX_HR_MIN} y ${MAX_HR_MAX} lpm.`
        }
        onChange={(e) => edit('maxHr', e.target.value)}
        onBlur={() => void commit(texts)}
      />
      <Field
        id="thresholdHr"
        label="Pulso de umbral (opcional)"
        suffix="lpm"
        inputMode="numeric"
        autoComplete="off"
        placeholder="Sin definir"
        value={texts.thresholdHr}
        error={errors.thresholdHr}
        help="Si lo conoces, las zonas de pulso se calculan con él en lugar del máximo."
        onChange={(e) => edit('thresholdHr', e.target.value)}
        onBlur={() => void commit(texts)}
      />
      <button type="button" className="btn btn--secondary btn--block" onClick={() => void estimate()} disabled={estimating}>
        {estimating ? <LoaderCircle className="ic spin" aria-hidden="true" /> : <Sparkles className="ic" aria-hidden="true" />}
        {estimating ? 'Estimando…' : 'Estimar con mis salidas'}
      </button>
      <p className="help">
        Usa tus salidas de los últimos {Math.round(ESTIMATE_WINDOW_DAYS / 30)} meses con potencia o pulso. Es una estimación: el
        FTP real se mide con una prueba.
      </p>
      {estimateNote ? (
        <div role="status" className="help-list-note">
          {estimateNote.map((n) => (
            <p className="help" key={n}>
              {n}
            </p>
          ))}
        </div>
      ) : null}
    </Disclosure>
  );
}
