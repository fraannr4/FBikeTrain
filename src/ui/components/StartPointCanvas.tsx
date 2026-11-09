import { useEffect, useRef } from 'react';
import type { Map as LeafletMap, Marker } from 'leaflet';
import type { LatLng } from '../../domain/types';
import { CYCLOSM_ATTRIBUTION, CYCLOSM_URL } from './RideMap';

type Props = {
  value: LatLng | null;
  home: LatLng | null;
  onChange: (p: LatLng) => void;
};

/** Sin punto ni Casa, el mapa abre sobre la península. */
const SPAIN = { lat: 40.2, lng: -3.6, zoom: 6 };
const POINT_ZOOM = 13;

/**
 * Mapa de Leaflet con CyclOSM para elegir el inicio: tocar mueve el punto y el punto se arrastra.
 * Leaflet se carga aparte, solo cuando se abre este mapa.
 */
export function StartPointCanvas({ value, home, onChange }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const makeMarker = useRef<((p: LatLng) => Marker) | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const first = useRef(value ?? home);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | undefined;
    import('leaflet').then((L) => {
      const node = el.current;
      if (cancelled || !node) return;
      const at = first.current;
      const m = L.map(node, { scrollWheelZoom: false, zoomControl: true }).setView(
        at ? [at.lat, at.lng] : [SPAIN.lat, SPAIN.lng],
        at ? POINT_ZOOM : SPAIN.zoom,
      );
      L.tileLayer(CYCLOSM_URL, { subdomains: 'abc', maxZoom: 20, attribution: CYCLOSM_ATTRIBUTION }).addTo(m);
      const icon = L.divIcon({ className: 'start-pin', html: '<span></span>', iconSize: [44, 44], iconAnchor: [22, 22] });
      makeMarker.current = (p) => {
        const mk = L.marker([p.lat, p.lng], { icon, draggable: true, keyboard: false, title: 'Inicio de la ruta' }).addTo(m);
        mk.on('dragend', () => {
          const ll = mk.getLatLng();
          onChangeRef.current({ lat: ll.lat, lng: ll.lng });
        });
        return mk;
      };
      m.on('click', (e) => onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
      // Dentro de una hoja que sube, el tamaño llega tarde: se recalcula cuando cambia.
      ro = new ResizeObserver(() => m.invalidateSize());
      ro.observe(node);
      map.current = m;
      if (valueRef.current) marker.current = makeMarker.current(valueRef.current);
    });
    return () => {
      cancelled = true;
      ro?.disconnect();
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
    // El mapa se crea una vez; el punto lo sigue el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!value) { marker.current?.remove(); marker.current = null; return; }
    if (!map.current || !makeMarker.current) return;
    if (marker.current) marker.current.setLatLng([value.lat, value.lng]);
    else marker.current = makeMarker.current(value);
  }, [value]);

  return (
    <div
      ref={el}
      className="start-map"
      role="application"
      aria-label="Mapa para elegir el inicio. Toca un punto o arrastra el marcador."
    />
  );
}
