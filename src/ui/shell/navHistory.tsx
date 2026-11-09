import { createContext, useContext, useRef, type MouseEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { screenName } from './screens';

type Entry = { key: string; pathname: string };

const PrevContext = createContext<Entry | null>(null);

/**
 * Lleva la pila de pantallas visitadas dentro de la app para saber a cuál vuelve «Volver».
 * Se recalcula al pintar, de forma idempotente (dos pasadas de StrictMode dejan la misma pila):
 * una clave ya vista recorta la pila hasta ella (atrás o adelante del navegador), REPLACE cambia
 * la cima y el resto apila. La clave «default» solo coincide con la misma pantalla.
 */
export function NavHistoryProvider({ children }: { children: ReactNode }) {
  const { key, pathname } = useLocation();
  const type = useNavigationType();
  const stack = useRef<Entry[]>([]);

  const s = stack.current;
  // Un cambio de dirección hecho fuera del router (enlace «#/…», escribir la dirección) llega sin
  // clave propia: todas esas entradas son «default». Entre ellas solo vale la misma pantalla, desde
  // la cima: volver a la de entrada recorta; ir a otra pantalla apila.
  let at = -1;
  for (let i = s.length - 1; i >= 0 && at < 0; i--) {
    if (s[i].key === key && (key !== 'default' || s[i].pathname === pathname)) at = i;
  }
  if (at >= 0) s.length = at + 1;
  else if (type === 'REPLACE' && s.length > 0) s[s.length - 1] = { key, pathname };
  else s.push({ key, pathname });
  const prev = s.length > 1 ? s[s.length - 2] : null;

  return <PrevContext.Provider value={prev}>{children}</PrevContext.Provider>;
}

export type BackTarget = {
  /** «Volver a Rutas», «Volver al historial». */
  label: string;
  /** Adónde lleva el enlace si no se vuelve con el historial del navegador. */
  to: string;
  onClick: (e: MouseEvent<HTMLAnchorElement>) => void;
  /** Vuelve atrás desde código (gesto del borde). */
  go: () => void;
};

/**
 * Destino de «Volver». Si se llegó desde otra pantalla de la app, vuelve con el historial del
 * navegador (conserva el desplazamiento de la lista) y dice a cuál: «Volver a Inicio». Si se entró
 * directamente (enlace, recarga), lleva a la pantalla madre `parent`.
 */
export function useBack(parent: string): BackTarget {
  const prev = useContext(PrevContext);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const fromApp = prev !== null && prev.pathname !== pathname;
  const to = fromApp ? prev.pathname : parent;

  const go = () => {
    if (fromApp) navigate(-1);
    else navigate(parent);
  };
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
    if (!fromApp) return; // el enlace lleva a la pantalla madre
    e.preventDefault();
    navigate(-1);
  };
  return { label: backLabel(screenName(to)), to, onClick, go };
}

/** «Volver a Rutas»; con el artículo cuando el nombre es común: «Volver al historial». */
function backLabel(name: string): string {
  return name === 'Historial' ? 'Volver al historial' : `Volver a ${name}`;
}
