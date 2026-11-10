import type { ReactNode } from 'react';
import { AppBar } from './AppBar';
import { PageHead } from './PageHead';
import { useDesktopLayout } from '../hooks/useDesktopLayout';

type Props = {
  /** `h1` de la pantalla (en Subidas, «Historial»: la pestaña). */
  title: string;
  /** Título de la barra compacta si no es `title` (en Subidas, «Subidas»: la vista). */
  barTitle?: string;
  /** Pantalla madre: con ella, «Volver a X» en la barra. Sin ella, la marca (pantallas raíz). */
  back?: string;
  /** Botones de icono de la barra superior. */
  actions?: ReactNode;
  kicker?: ReactNode;
  lead?: ReactNode;
  /** Bajo la cabecera, antes del contenido, con el mismo hueco: un segmentado de vistas. */
  nav?: ReactNode;
  /**
   * `dense`: listas con segmentado (en apaisado, cabecera de una línea).
   * `narrow`: una columna (Más, Ajustes, Importar): en apaisado, el título pasa a la barra.
   */
  variant?: 'dense' | 'narrow';
  /** Aria-busy mientras carga. */
  busy?: boolean;
  className?: string;
  /** Mapa junto a los controles en PC; en móvil se conserva la hoja del mapa. */
  desktopMap?: ReactNode;
  children?: ReactNode;
};

/** Pantalla del kit: barra superior, cabecera con relieve y la rejilla `.page` de 28 px de hueco. */
export function Page(props: Props) {
  const { title, barTitle, back, actions, kicker, lead, nav, variant, busy, className, desktopMap, children } = props;
  // Con la prop presente (aunque aún sin mapa) el envoltorio no cambia: los hijos no se remontan al llegar el mapa.
  const withMap = 'desktopMap' in props;
  const desktop = useDesktopLayout();
  const cls = ['page', variant ? `page--${variant}` : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <>
      <AppBar title={barTitle ?? title} back={back} actions={actions} />
      <div className={cls} aria-busy={busy || undefined}>
        <PageHead title={title} kicker={kicker} lead={nav ? undefined : lead} />
        {nav}
        {nav && lead ? <p className="page-lead page-lead--sub">{lead}</p> : null}
        {withMap ? (
          <div className={desktop && desktopMap ? 'route-workspace' : 'route-workspace route-workspace--off'}>
            <div className="route-controls">{children}</div>
            {desktop && desktopMap ? <aside className="route-map-panel" aria-label="Vista del recorrido">{desktopMap}</aside> : null}
          </div>
        ) : children}
      </div>
    </>
  );
}
