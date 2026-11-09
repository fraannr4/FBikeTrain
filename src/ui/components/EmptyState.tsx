import type { ReactNode } from 'react';
import type { LucideIcon } from '../icons';
import { StateView } from './StateView';

type Props = { icon: LucideIcon; title: string; text: ReactNode; action?: ReactNode };

/** Estado vacío: dice qué falta y qué hacer, con la acción a mano. Es `StateView` con tono vacío. */
export function EmptyState({ icon, title, text, action }: Props) {
  return <StateView icon={icon} title={title} text={text} action={action} />;
}
