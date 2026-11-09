import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { CircleAlert } from '../icons';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'children'> & {
  label: string;
  /** Ayuda bajo el campo: «Tu salida media: 74 km». */
  help?: ReactNode;
  /** Error: qué pasa y cómo arreglarlo. Sustituye a la ayuda y marca el campo como no válido. */
  error?: ReactNode;
  /** Unidad dentro del campo, a la derecha: «km». */
  suffix?: string;
  /** Botón dentro del campo (mostrar la clave): `.icon-btn`. */
  inlineAction?: ReactNode;
  /** Clase extra para el `input` («input--key»). */
  inputClassName?: string;
};

/**
 * Campo con etiqueta visible encima, ayuda o error debajo, unidad y botón opcionales. El error se
 * enlaza con `aria-describedby` y `aria-invalid`, y no depende solo del color: lleva icono y texto.
 */
export function Field({ label, help, error, suffix, inlineAction, inputClassName, id, ...input }: Props) {
  const auto = useId();
  const inputId = id ?? `${auto}-in`;
  const noteId = `${auto}-note`;
  const hasNote = Boolean(error || help);
  const control = (
    <input
      {...input}
      id={inputId}
      className={inputClassName ? `input ${inputClassName}` : 'input'}
      aria-invalid={error ? true : undefined}
      aria-describedby={hasNote ? noteId : undefined}
    />
  );
  return (
    <div className="field" data-invalid={error ? '' : undefined}>
      <label className="field-label" htmlFor={inputId}>
        {label}
      </label>
      {suffix || inlineAction ? (
        <div className={suffix ? 'input-wrap unit-wrap' : 'input-wrap'}>
          {control}
          {suffix ? (
            <span className="sfx" aria-hidden="true">
              {suffix}
            </span>
          ) : null}
          {inlineAction}
        </div>
      ) : (
        control
      )}
      {error ? (
        <p className="field-error" id={noteId}>
          <CircleAlert className="ic" aria-hidden="true" />
          {error}
        </p>
      ) : help ? (
        <p className="field-help" id={noteId}>
          {help}
        </p>
      ) : null}
    </div>
  );
}
