import type { LatLng } from '../../domain/types';
import { House } from '../icons';
import { StartPointCanvas } from './StartPointCanvas';

type Props = {
  value: LatLng | null;
  home: LatLng | null;
  onChange: (p: LatLng) => void;
  /** Guardar el punto elegido como Casa (Ajustes). */
  onSaveHome: (p: LatLng) => void;
};

const same = (a: LatLng | null, b: LatLng | null) => !!a && !!b && a.lat === b.lat && a.lng === b.lng;

/** Inicio en el mapa CyclOSM y, si el punto no es Casa, el botón para guardarlo como Casa. */
export function StartPointMap({ value, home, onChange, onSaveHome }: Props) {
  return (
    <div className="start-pick">
      <StartPointCanvas value={value} home={home} onChange={onChange} />
      {value && !same(value, home) ? (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => onSaveHome(value)}>
          <House className="ic" aria-hidden="true" />
          Guardar como Casa
        </button>
      ) : null}
    </div>
  );
}
