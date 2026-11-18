import { useEffect } from 'react';

const APP = 'FBikeTrain';

/** Título de la pestaña del navegador: nombra la pantalla, para el historial y los lectores de pantalla. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP}` : APP;
    return () => { document.title = APP; };
  }, [title]);
}
