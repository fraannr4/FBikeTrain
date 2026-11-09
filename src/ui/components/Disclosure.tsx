import type { ReactNode, SyntheticEvent } from 'react';
import type { Accent } from '../accent';
import { ChevronDown, type LucideIcon } from '../icons';

type Props = {
  title: string;
  /** Resumen de lo que hay dentro, visible cerrado: «Rutas: conectada». */
  meta?: ReactNode;
  icon: LucideIcon;
  accent?: Accent;
  /** Mismo `name` en varios: abrir uno cierra los demás (acordeón nativo). */
  name?: string;
  id?: string;
  /** Abierto al empezar. */
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  /** Borde rojo: zona de borrar datos. */
  danger?: boolean;
  /** Icono en tono de aviso (falta algo) o de error (algo no funciona). */
  leadTone?: 'warn' | 'bad';
  children: ReactNode;
};

/**
 * Grupo plegable nativo (`details` > `summary`), con la cabecera como una fila: icono, título,
 * resumen y flecha que gira. Teclado, lector de pantalla y búsqueda en la página sin JS.
 */
export function Disclosure({ title, meta, icon: Icon, accent, name, id, defaultOpen, onToggle, danger, leadTone, children }: Props) {
  const toggle = onToggle ? (e: SyntheticEvent<HTMLDetailsElement>) => onToggle(e.currentTarget.open) : undefined;
  // `name` en <details> aún no está en los tipos de React 18: va como atributo suelto.
  const extra = name ? ({ name } as Record<string, string>) : undefined;
  return (
    <details
      className={danger ? 'disclosure disclosure--danger' : 'disclosure'}
      id={id}
      open={defaultOpen}
      onToggle={toggle}
      {...extra}
    >
      <summary data-m={accent}>
        <span className={leadTone ? `row-lead row-lead--${leadTone}` : 'row-lead'} aria-hidden="true">
          <Icon className="ic" />
        </span>
        <span className="row-main">
          <span className="row-title">{title}</span>
          {meta ? <span className="row-meta">{meta}</span> : null}
        </span>
        <ChevronDown className="chev" aria-hidden="true" />
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
