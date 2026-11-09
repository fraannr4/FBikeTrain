import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

/** Clave de localStorage que lee también el script previo de index.html. */
export const THEME_KEY = 'fbt-theme';

const listeners = new Set<() => void>();

/** Tema activo, leído de `data-theme` en `<html>`. Sin atributo, oscuro. */
export function getTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function setTheme(t: Theme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', t);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    // Almacenamiento bloqueado (ventana privada): el tema vale para esta sesión.
  }
  // La barra del navegador móvil toma el fondo del tema recién aplicado.
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (bg && meta) meta.setAttribute('content', bg);
  listeners.forEach((cb) => cb());
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const serverTheme = (): Theme => 'dark';

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, serverTheme);
}
