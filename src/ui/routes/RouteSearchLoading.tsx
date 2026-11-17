import { RouteLoadingScene } from '../components/RouteLoadingScene';
import { formatCount } from '../format';
import './RouteSearchLoading.css';

type Props = {
  message: string;
  elapsed: number;
  used: number;
  budget: number;
  help?: string;
  onCancel: () => void;
};

/** Presentación de la búsqueda: solo muestra datos reales del generador. */
export function RouteSearchLoading({ message, elapsed, used, budget, help, onCancel }: Props) {
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
        {help ? <p className="route-search-loading__help">{help}</p> : null}
        <div className="route-search-loading__footer">
          <span className="route-search-loading__elapsed">{formatCount(elapsed)} s transcurridos</span>
          <button type="button" className="btn btn--secondary" onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </section>
  );
}
