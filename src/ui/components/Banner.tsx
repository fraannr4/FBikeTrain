import type { ReactNode } from 'react';
import { CircleAlert, Info, TriangleAlert, type LucideIcon } from '../icons';

type Tone = 'info' | 'warn' | 'error';
const ICONS: Record<Tone, LucideIcon> = { info: Info, warn: TriangleAlert, error: CircleAlert };

type Props = {
  tone?: Tone;
  /** Icono propio; por defecto, el del tono. */
  icon?: LucideIcon;
  children: ReactNode;
  /** Botón fantasma tras el texto: «Reintentar». */
  action?: ReactNode;
  className?: string;
};

/** Mensaje en línea: información, aviso o error. Lo importante, en `<b>`. El de error se anuncia. */
export function Banner({ tone = 'info', icon, children, action, className }: Props) {
  const Icon = icon ?? ICONS[tone];
  const cls = ['banner', tone !== 'info' ? `banner--${tone}` : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={cls} role={tone === 'error' ? 'alert' : undefined}>
      <Icon className="ic" aria-hidden="true" />
      <p>{children}</p>
      {action ?? null}
    </div>
  );
}
