import type { ReactNode } from 'react';
import type { LucideIcon } from '../icons';

type Props = {
  titleId: string;
  title: string;
  icon: LucideIcon;
  /** Acción a la derecha del título: «Ver detalle», «Todas», editar… (`.card-link` o `.icon-btn`). */
  action?: ReactNode;
  /** Frente a qué se compara la tarjeta, dicho una sola vez. */
  sub?: ReactNode;
  className?: string;
  children: ReactNode;
};

/**
 * Tarjeta del kit: cabecera con el icono del acento en su caja (`.card-ic`), `h2.card-title` y
 * acción; subtítulo opcional y cuerpo. El acento lo da `data-m` o `--acc` en la propia tarjeta.
 */
export function Panel({ titleId, title, icon: Icon, action, sub, className, children }: Props) {
  return (
    <section aria-labelledby={titleId} className={className ? `card ${className}` : 'card'}>
      <div className="card-h">
        <span className="card-ic" aria-hidden="true">
          <Icon className="ic" />
        </span>
        <h2 className="card-title" id={titleId}>
          {title}
        </h2>
        {action ? <div className="end">{action}</div> : null}
      </div>
      {sub ? <p className="card-sub">{sub}</p> : null}
      {children}
    </section>
  );
}
