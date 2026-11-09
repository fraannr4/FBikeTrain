import type { ReactNode } from 'react';

type Props = {
  /** El `h1` de la pantalla. Se encoge al desplazar (solo CSS, `animation-timeline`). */
  title: string;
  /** Línea pequeña sobre el título. */
  kicker?: ReactNode;
  /** Entradilla bajo el título (máx. 34 caracteres por línea). */
  lead?: ReactNode;
  id?: string;
  /** Lo que va dentro de la cabecera tras la entradilla (p. ej. un segmentado en apaisado). */
  children?: ReactNode;
};

/** Cabecera de página con el relieve grabado de fondo, la firma visual del kit. */
export function PageHead({ title, kicker, lead, id, children }: Props) {
  return (
    <div className="page-head">
      {kicker ? <p className="page-kicker">{kicker}</p> : null}
      <h1 className="page-title" id={id}>
        {title}
      </h1>
      {lead ? <p className="page-lead">{lead}</p> : null}
      {children}
    </div>
  );
}
