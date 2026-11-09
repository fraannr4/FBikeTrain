import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { InitialAnswers } from '../../ai/levelSummary';
import { Bike, Upload } from '../icons';
import { Stepper } from './Stepper';

type Props = {
  onSave: (a: InitialAnswers) => void;
  busy?: boolean;
};

const QUESTIONS = [
  { key: 'kmPorSalida', q: '¿Cuántos km sueles hacer en una salida?', label: 'Distancia', unit: 'km', min: 10, max: 200, step: 5, decimals: 0 },
  { key: 'desnivelPorSalidaM', q: '¿Cuánto desnivel sueles subir en una salida?', label: 'Desnivel', unit: 'm', min: 0, max: 4000, step: 50, decimals: 0 },
  { key: 'velocidadMediaKmh', q: '¿A qué velocidad media sueles ir?', label: 'Velocidad', unit: 'km/h', min: 10, max: 45, step: 0.5, decimals: 1 },
] as const;

const START: InitialAnswers = { kmPorSalida: 50, desnivelPorSalidaM: 600, velocidadMediaKmh: 25 };

/**
 * Con menos de 5 salidas no hay referencia: tres cifras declaradas la sustituyen. Se guardan en
 * este navegador y la IA solo recibe estas cifras.
 */
export function InitialQuestions({ onSave, busy }: Props) {
  const [a, setA] = useState<InitialAnswers>(START);
  return (
    <section className="section card ia-initial" aria-labelledby="ia-ini-t">
      <div className="card-h">
        <span className="card-ic" data-m="dist" aria-hidden="true">
          <Bike className="ic" />
        </span>
        <h2 className="card-title" id="ia-ini-t">
          Cuéntanos cómo sales
        </h2>
      </div>
      <p className="muted">
        Con menos de 5 salidas no hay con qué medir tu nivel. Con estas tres cifras, la IA ajusta las rutas a ti.
      </p>
      {QUESTIONS.map((x) => (
        <div className="gen-group" key={x.key}>
          <p className="gen-label">
            {x.q}
          </p>
          <Stepper
            label={x.label}
            unit={x.unit}
            value={a[x.key]}
            onChange={(v) => setA((p) => ({ ...p, [x.key]: v }))}
            min={x.min}
            max={x.max}
            step={x.step}
            decimals={x.decimals}
          />
        </div>
      ))}
      <button type="button" className="btn btn--primary btn--block" disabled={busy} onClick={() => onSave(a)}>
        Guardar y seguir
      </button>
      <Link className="btn btn--ghost" to="/importar">
        <Upload className="ic" aria-hidden="true" />O importa tus salidas de Strava
      </Link>
    </section>
  );
}
