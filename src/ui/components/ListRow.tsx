import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Accent } from '../accent';
import { ChevronRight, type LucideIcon } from '../icons';

type ListProps = {
  children: ReactNode;
  /** Separadores que empiezan tras el icono (listas de navegación). */
  inset?: boolean;
  /** Nombre de la lista si no la nombra un título cercano. */
  label?: string;
  className?: string;
};

/** Lista agrupada (`ul.list`): cada hijo es un `ListRow`. */
export function List({ children, inset, label, className }: ListProps) {
  const cls = ['list', inset ? 'list--inset' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <ul className={cls} aria-label={label}>
      {children}
    </ul>
  );
}

type RowProps = {
  title: ReactNode;
  /** Segunda línea, gris: «Ayer, jueves 5, con 1542 m». */
  meta?: ReactNode;
  /** Icono en su caja de 42 px, teñida con el acento. */
  icon?: LucideIcon;
  /** Contenido propio en la caja (la forma de una ruta). Gana a `icon`. */
  lead?: ReactNode;
  accent?: Accent;
  /** Icono en tono de aviso: «Copia de seguridad» con cambios sin copiar. */
  leadTone?: 'warn';
  /** Cifra a la derecha: «87,6» con `unit` «km». */
  value?: ReactNode;
  unit?: string;
  /** Contenido propio a la derecha (un interruptor, una pastilla). */
  trail?: ReactNode;
  /** Con `to`, la fila es un enlace; con `onClick`, un botón; sin nada, solo muestra. */
  to?: string;
  onClick?: () => void;
  /** Nombre accesible completo si el texto visible no basta. */
  ariaLabel?: string;
  /** `id` del título, para que un control de `trail` se nombre con él. */
  titleId?: string;
};

/**
 * Fila de lista: caja con icono o forma, título (salta de línea, nunca se corta), meta gris y, a la
 * derecha, cifra y flecha. Mide al menos 64 px de alto: se toca entera.
 */
export function ListRow({ title, meta, icon: Icon, lead, accent, leadTone, value, unit, trail, to, onClick, ariaLabel, titleId }: RowProps) {
  const body = (
    <>
      {lead !== undefined ? (
        <span className="row-lead row-lead--shape" aria-hidden="true">
          {lead}
        </span>
      ) : Icon ? (
        <span className={leadTone ? `row-lead row-lead--${leadTone}` : 'row-lead'} aria-hidden="true">
          <Icon className="ic" />
        </span>
      ) : null}
      <span className="row-main">
        <span className="row-title" id={titleId}>
          {title}
        </span>
        {meta ? <span className="row-meta">{meta}</span> : null}
      </span>
      {value !== undefined || trail !== undefined || to || onClick ? (
        <span className="row-trail">
          {value !== undefined ? (
            <span className="row-val">
              {value}
              {unit ? <span className="u">{unit}</span> : null}
            </span>
          ) : null}
          {trail}
          {to || onClick ? <ChevronRight className="chev" aria-hidden="true" /> : null}
        </span>
      ) : null}
    </>
  );

  return (
    <li>
      {to ? (
        <Link className="row" to={to} data-m={accent} aria-label={ariaLabel}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" className="row" data-m={accent} aria-label={ariaLabel} onClick={onClick}>
          {body}
        </button>
      ) : (
        <div className="row" data-m={accent}>
          {body}
        </div>
      )}
    </li>
  );
}
