import type { GentePending } from '../shell/GentePendingContext';

/** Una parte de «Gente». Cada una conserva su dirección: los avisos push siguen abriendo donde toca. */
export type GentePart = {
  id: 'chats' | 'amigos' | 'retos' | 'ciclistas';
  label: string;
  to: string;
  /** La pantalla es de esta parte (también sus pantallas hijas). */
  match: (pathname: string) => boolean;
};

export const GENTE_PARTS: GentePart[] = [
  { id: 'chats', label: 'Chats', to: '/chat', match: (p) => p.startsWith('/chat') },
  { id: 'amigos', label: 'Amigos', to: '/perfil/amigos', match: (p) => p.startsWith('/perfil/amigos') || p.startsWith('/amigos') },
  { id: 'retos', label: 'Retos', to: '/retos', match: (p) => p.startsWith('/retos') },
  { id: 'ciclistas', label: 'Ciclistas', to: '/ciclistas', match: (p) => p.startsWith('/ciclistas') || p.startsWith('/personas/') },
];

/** Lo pendiente de una parte; Ciclistas nunca cuenta. */
export const partCount = (part: GentePart, p: GentePending): number => (part.id === 'ciclistas' ? 0 : p[part.id]);

/** Nombre accesible con el contador: «Chats, 2 sin leer», «Amigos, 1 solicitud», «Retos, 3 pendientes». */
export function partLabel(part: GentePart, p: GentePending): string {
  const n = partCount(part, p);
  if (n === 0) return part.label;
  if (part.id === 'chats') return `${part.label}, ${n} sin leer`;
  if (part.id === 'amigos') return `${part.label}, ${n === 1 ? '1 solicitud' : `${n} solicitudes`}`;
  return `${part.label}, ${n === 1 ? '1 pendiente' : `${n} pendientes`}`;
}
