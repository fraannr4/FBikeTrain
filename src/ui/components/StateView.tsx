import type { ReactNode } from 'react';
import type { LucideIcon } from '../icons';

type Props = {
  icon: LucideIcon;
  title: string;
  text?: ReactNode;
  /** Botón o enlace que resuelve el estado: «Importar salidas», «Reintentar». */
  action?: ReactNode;
  /** `empty` (por defecto), `error` (se anuncia) o `done`. */
  tone?: 'empty' | 'error' | 'done';
  /** Nivel del título: 3 dentro de una sección con su `h2`; 2 si ocupa la pantalla. */
  level?: 2 | 3;
  className?: string;
};

/**
 * Estado vacío, de error o de hecho: dice qué pasa y qué hacer, con la acción a mano.
 * El de error lleva `role="alert"` para que el lector de pantalla lo diga al aparecer.
 */
export function StateView({ icon: Icon, title, text, action, tone = 'empty', level = 3, className }: Props) {
  const Title = level === 2 ? 'h2' : 'h3';
  const cls = ['state', tone !== 'empty' ? `state--${tone}` : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={cls} role={tone === 'error' ? 'alert' : undefined}>
      <span className="state-ic" aria-hidden="true">
        <Icon className="ic" />
      </span>
      <Title className="state-title">{title}</Title>
      {text ? <p className="state-text">{text}</p> : null}
      {action ?? null}
    </div>
  );
}
