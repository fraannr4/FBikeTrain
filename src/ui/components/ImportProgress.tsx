import type { CSSProperties } from 'react';
import type { ImportPhase } from '../../import/importService';
import { formatCount } from '../format';
import { Check, File, LoaderCircle } from '../icons';

type Props = {
  /** Lo que se importa: «export_123.zip» o «12 ficheros». */
  fileLabel: string;
  /** Tamaño ya formateado: «412 MB». */
  fileMeta?: string;
  done: number;
  total: number;
  phase: ImportPhase;
  /** «Parar la importación»: la pantalla pide confirmación antes de parar. */
  onCancel: () => void;
};

const STEPS: { phase: ImportPhase; title: string; now: string }[] = [
  { phase: 'open', title: 'Abrir el archivo', now: 'Abriendo' },
  { phase: 'activities', title: 'Leer y guardar las actividades', now: 'Leyendo' },
  { phase: 'finish', title: 'Terminar', now: 'Terminando' },
];

/**
 * Importación en curso: el fichero, el porcentaje en dorsal con su barra, «3 de 10» y las tres fases
 * como hitos kilométricos unidos por la carretera. El `<progress>` nativo da el rol y el valor; la
 * barra visible solo escala en X.
 */
export function ImportProgress({ fileLabel, fileMeta, done, total, phase, onCancel }: Props) {
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const current = STEPS.findIndex((s) => s.phase === phase);
  return (
    <div className="card run" data-m="dist">
      <div className="file-row">
        <span className="row-lead" aria-hidden="true">
          <File className="ic" />
        </span>
        <span className="row-main">
          <span className="file-name" title={fileLabel}>
            {fileLabel}
          </span>
          {fileMeta ? <span className="file-meta">{fileMeta}</span> : null}
        </span>
      </div>

      <div className="glance">
        <p className="glance-v" aria-hidden="true">
          <span>{formatCount(ratio * 100)}</span>
          <span className="u"> %</span>
        </p>
        <progress className="sr-only" aria-label="Importando" value={done} max={Math.max(total, 1)} />
        <div className="meter" style={{ '--p': ratio } as CSSProperties} aria-hidden="true">
          <i />
        </div>
        <p className="run-sub">
          Van <b className="run-count">{`${formatCount(done)} de ${formatCount(total)}`}</b>. Las actividades que no
          son de bici no cuentan.
        </p>
      </div>

      <ol className="steps run-steps" aria-label="Fases">
        {STEPS.map((s, i) => {
          const st = i < current ? 'done' : i === current ? 'now' : 'todo';
          return (
            <li key={s.phase} data-st={st} aria-current={st === 'now' ? 'step' : undefined}>
              <span className="hito-n" aria-hidden="true">
                {st === 'done' ? <Check className="ic" /> : i + 1}
              </span>
              <span className="step-main">
                <span className="step-title">{s.title}</span>
                <span className="step-state">
                  {st === 'now' ? <LoaderCircle className="ic spin" aria-hidden="true" /> : null}
                  {st === 'done' ? 'Hecho' : st === 'now' ? s.now : 'Pendiente'}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <button type="button" className="btn btn--secondary btn--block run-stop" onClick={onCancel}>
        Parar la importación
      </button>
    </div>
  );
}
