import { Calendar, Target } from '../icons';

/**
 * Las pestañas del muelle. Con cuenta registrada, la quinta es «Gente» y «mas» agrupa lo que cuelga de
 * tu foto («Tú»); en el modo local, la quinta es «Más».
 */
export type TabId = 'inicio' | 'historial' | 'rutas' | 'plan' | 'gente' | 'mas';

/** Ruta de la pantalla raíz de cada pestaña. */
export const TAB_ROOT: Record<TabId, string> = {
  inicio: '/',
  historial: '/historial',
  rutas: '/rutas',
  plan: '/plan',
  gente: '/gente',
  mas: '/mas',
};

const GENTE = ['/gente', '/chat', '/retos', '/ciclistas', '/perfil/amigos', '/amigos', '/personas/'];
const MAS = ['/perfil', '/mas', '/importar', '/compartido', '/ajustes', '/zona'];

/** Pestaña de cada pantalla: Chats, Amigos, Retos y Ciclistas son de «Gente»; tu perfil y tus datos, de «Más». */
export function tabOf(pathname: string): TabId {
  if (pathname.startsWith('/historial')) return 'historial';
  if (pathname.startsWith('/rutas')) return 'rutas';
  if (pathname.startsWith('/plan')) return 'plan';
  if (GENTE.some((p) => pathname.startsWith(p))) return 'gente';
  if (MAS.some((p) => pathname.startsWith(p))) return 'mas';
  return 'inicio';
}

const NAMES: Record<string, string> = {
  '/': 'Inicio',
  '/historial': 'Salidas',
  '/historial/subidas': 'Subidas',
  '/historial/repetidas': 'Repetidas',
  '/rutas': 'Rutas',
  '/rutas/biblioteca': 'Biblioteca de rutas',
  '/plan': 'Plan',
  '/plan/objetivos': 'Objetivos',
  '/mas': 'Más',
  '/perfil': 'Tú',
  '/gente': 'Gente',
  '/perfil/nuevo': 'Tu perfil ciclista',
  '/importar': 'Importar',
  '/compartido': 'Ficheros compartidos',
  '/ajustes': 'Ajustes',
  '/zona': 'Tu zona',
  '/amigos': 'Amigos',
  '/perfil/amigos': 'Amigos',
  '/ciclistas': 'Ciclistas',
  '/retos/anteriores': 'Retos anteriores',
  '/retos': 'Retos',
  '/retos/nuevo': 'Nuevo reto',
  '/chat': 'Chat',
};

/** Nombre de la pantalla, para «Volver a Salidas». Una salida concreta es «Salida». */
export function screenName(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (NAMES[path]) return NAMES[path];
  if (path.startsWith('/historial/subidas/')) return 'Subidas';
  if (path.startsWith('/historial/repetidas/')) return 'Repetidas';
  if (path.startsWith('/historial/')) return 'Salida';
  if (path.startsWith('/retos/')) return 'Reto';
  if (path.startsWith('/chat/')) return 'Conversación';
  if (path.startsWith('/personas/')) return 'Perfil del ciclista';
  return 'Inicio';
}

/** Vistas de Historial: el segmentado de enlaces que comparten Salidas, Subidas y Repetidas. */
export const HISTORIAL_VIEWS = [
  { to: '/historial', label: 'Salidas' },
  { to: '/historial/subidas', label: 'Subidas' },
  { to: '/historial/repetidas', label: 'Repetidas' },
];

/** Vistas de Plan: Calendario y Objetivos, con su icono como en el prototipo. */
export const PLAN_VIEWS = [
  { to: '/plan', label: 'Calendario', icon: Calendar },
  { to: '/plan/objetivos', label: 'Objetivos', icon: Target },
];
