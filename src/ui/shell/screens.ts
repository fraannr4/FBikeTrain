import { Calendar, Target } from '../icons';

/** Las cinco pestañas de la barra inferior. */
export type TabId = 'inicio' | 'historial' | 'rutas' | 'plan' | 'mas';

/** Ruta de la pantalla raíz de cada pestaña. */
export const TAB_ROOT: Record<TabId, string> = {
  inicio: '/',
  historial: '/historial',
  rutas: '/rutas',
  plan: '/plan',
  mas: '/mas',
};

/** Pestaña a la que pertenece una ruta. Importar y Ajustes se abren desde Más. */
export function tabOf(pathname: string): TabId {
  if (pathname.startsWith('/historial')) return 'historial';
  if (pathname.startsWith('/rutas')) return 'rutas';
  if (pathname.startsWith('/plan')) return 'plan';
  if (pathname.startsWith('/mas') || pathname.startsWith('/importar') || pathname.startsWith('/ajustes')) return 'mas';
  return 'inicio';
}

const NAMES: Record<string, string> = {
  '/': 'Inicio',
  '/historial': 'Historial',
  '/historial/subidas': 'Subidas',
  '/historial/repetidas': 'Repetidas',
  '/rutas': 'Rutas',
  '/rutas/ia': 'Rutas con IA',
  '/rutas/biblioteca': 'Biblioteca de rutas',
  '/plan': 'Plan',
  '/plan/objetivos': 'Objetivos',
  '/mas': 'Más',
  '/importar': 'Importar',
  '/ajustes': 'Ajustes',
};

/** Nombre de la pantalla, para «Volver a Historial». Una salida concreta es «Salida». */
export function screenName(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (NAMES[path]) return NAMES[path];
  if (path.startsWith('/historial/subidas/')) return 'Subidas';
  if (path.startsWith('/historial/repetidas/')) return 'Repetidas';
  if (path.startsWith('/historial/')) return 'Salida';
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
