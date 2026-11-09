import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '../../domain/types';
import { SegmentedControl } from '../components/SegmentedControl';
import { StartPointMap } from '../components/StartPointMap';
import { House, MapPin, Navigation } from '../icons';

export type StartKind = 'casa' | 'aqui' | 'mapa';
/** Puntos elegidos en esta pantalla: tu ubicación y el del mapa. */
export type PickedPoints = { aqui: LatLng | null; mapa: LatLng | null };

type Props = {
  home: LatLng | null;
  kind: StartKind;
  points: PickedPoints;
  onKind: (k: StartKind) => void;
  onPick: (k: 'aqui' | 'mapa', p: LatLng) => void;
  onSaveHome: (p: LatLng) => void;
};

type Locate = 'idle' | 'busy' | 'error' | 'unsupported';

const HOME_HELP = 'Tu punto guardado en Ajustes. La IA nunca lo ve.';

/** Punto de salida de la petición, o `null` si aún falta elegirlo. */
export function startPoint(kind: StartKind, home: LatLng | null, points: PickedPoints): LatLng | null {
  return kind === 'casa' ? home : points[kind];
}

/** «Desde Casa», «Desde donde estás», «Desde un punto del mapa». */
export const START_TEXT: Record<StartKind, string> = {
  casa: 'Desde Casa',
  aqui: 'Desde donde estás',
  mapa: 'Desde un punto del mapa',
};

/**
 * Sale de: Casa (si está guardada), tu ubicación o un punto del mapa. La ubicación se pide al
 * elegir «Aquí»; el mapa se abre al elegir «Mapa».
 */
export function StartChoice({ home, kind, points, onKind, onPick, onSaveHome }: Props) {
  const [locate, setLocate] = useState<Locate>('idle');
  const retryRef = useRef<HTMLButtonElement>(null);
  const failed = kind === 'aqui' && locate === 'error';

  // Sin ubicación, la ayuda y «Volver a intentarlo» quedarían bajo el dock: se traen a la vista.
  useEffect(() => {
    if (failed) retryRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [failed]);

  const askLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocate('unsupported');
      return;
    }
    setLocate('busy');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocate('idle');
        onPick('aqui', { lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => setLocate('error'),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const choose = (k: StartKind) => {
    onKind(k);
    if (k === 'aqui' && !points.aqui && locate !== 'busy') askLocation();
  };

  const options = [
    ...(home ? [{ value: 'casa' as const, label: 'Casa', icon: House }] : []),
    { value: 'aqui' as const, label: 'Aquí', icon: Navigation },
    { value: 'mapa' as const, label: 'Mapa', icon: MapPin },
  ];

  let help: string;
  if (kind === 'casa') help = HOME_HELP;
  else if (kind === 'mapa') help = points.mapa ? 'Toca el mapa o arrastra el punto para moverlo.' : 'Elige el inicio en el mapa';
  else if (locate === 'busy') help = 'Buscando dónde estás…';
  else if (locate === 'unsupported') help = 'Este navegador no da la ubicación. Elige el inicio en el mapa.';
  else if (locate === 'error') help = 'No se ha podido leer tu ubicación. Revisa el permiso del navegador o elige en el mapa.';
  else help = points.aqui ? 'Sale de donde estás ahora.' : 'El navegador te pedirá permiso para usar tu ubicación.';

  return (
    <div className="gen-group">
      <p className="gen-label" aria-hidden="true">
        Sale de
      </p>
      <SegmentedControl label="Sale de" options={options} value={kind} onChange={choose} />
      <p className="field-help" aria-live="polite">
        {help}
      </p>
      {failed ? (
        <button type="button" className="btn btn--ghost" ref={retryRef} onClick={askLocation}>
          Volver a intentarlo
        </button>
      ) : null}
      {kind === 'mapa' ? (
        <StartPointMap value={points.mapa} home={home} onChange={(p) => onPick('mapa', p)} onSaveHome={onSaveHome} />
      ) : null}
    </div>
  );
}
