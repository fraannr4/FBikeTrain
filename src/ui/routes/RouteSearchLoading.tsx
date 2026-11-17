import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RouteLoadingScene } from '../components/RouteLoadingScene';
import { formatCount } from '../format';
import './RouteSearchLoading.css';

type Props = {
  message: string;
  elapsed: number;
  used: number;
  budget: number;
  help?: string;
  /** Rutas ya aceptadas en esta búsqueda: quedan detrás del recuadro, así que se cuentan aquí. */
  found?: number;
  onCancel: () => void;
};

/** Presentación de la búsqueda: solo muestra datos reales del generador. */
export function RouteSearchLoading({ message, elapsed, used, budget, help, found = 0, onCancel }: Props) {
  return (
    <section className="card route-search-loading" aria-label="Progreso de la búsqueda">
      <header className="route-search-loading__heading">
        <p className="route-search-loading__eyebrow"><span aria-hidden="true" />Cartografía viva</p>
        <h3>Explorando<br />tu zona.</h3>
      </header>
      <RouteLoadingScene />
      <div className="route-search-loading__body">
        <p className="route-search-loading__message" role="status" aria-atomic="true">
          <span className="route-search-loading__signal" aria-hidden="true"><i /><i /><i /></span>
          <span>{message}</span>
        </p>
        {/* Consultas consumidas, nunca porcentaje de finalización de la búsqueda. */}
        <div
          className="sr-only"
          role="progressbar"
          aria-label="Consultas al motor de rutas"
          aria-valuemin={0}
          aria-valuemax={budget}
          aria-valuenow={used > 0 ? used : undefined}
          aria-valuetext={used > 0 ? `${formatCount(used)} de ${formatCount(budget)} consultas consumidas` : 'Sin consultas al motor de rutas todavía'}
        />
        {found > 0 ? (
          <p className="route-search-loading__found">
            {found === 1 ? '1 ruta lista' : `${formatCount(found)} rutas listas`}
          </p>
        ) : null}
        {help ? <p className="route-search-loading__help">{help}</p> : null}
        <div className="route-search-loading__footer">
          <span className="route-search-loading__elapsed">{formatCount(elapsed)} s transcurridos</span>
          <button type="button" className="btn btn--secondary" onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </section>
  );
}

/** Lo que dura la salida. Debe coincidir con la transición de `.route-search-overlay` en el CSS. */
const EXIT_MS = 260;

/**
 * El recuadro de búsqueda, en grande y por encima de la pantalla: entra al empezar a buscar y
 * sale al terminar o cancelar. Mientras sale conserva lo último que mostró y ya no recibe pulsaciones.
 */
export function RouteSearchOverlay({ open, ...props }: Props & { open: boolean }) {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<'open' | 'closed'>('closed');
  const last = useRef(props);
  if (open) last.current = props;
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      root.current?.removeAttribute('inert');
      // Dos fotogramas: el primero pinta el estado de partida y el segundo arranca la transición.
      let inner = 0;
      const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setState('open')); });
      return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
    }
    setState('closed');
    // Al salir ya no recibe foco ni pulsaciones (React 18 no tipa `inert` como prop).
    root.current?.setAttribute('inert', '');
    const timer = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, [mounted]);

  if (!mounted) return null;
  return createPortal(
    <div
      ref={root}
      className="route-search-overlay"
      data-state={state}
      role="dialog"
      aria-modal="true"
      aria-label="Buscando rutas"
      tabIndex={-1}
    >
      <div className="route-search-overlay__backdrop" aria-hidden="true" />
      <RouteSearchLoading {...last.current} />
    </div>,
    document.body,
  );
}
