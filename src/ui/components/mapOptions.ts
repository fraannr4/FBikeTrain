import type { MapOptions } from 'leaflet';

/**
 * Opciones base de los mapas de salida. La rueda nunca amplía (desplaza la página) y el zoom va en
 * botones propios con nombre en castellano. Con `mobile`, el mapa está incrustado en una página que
 * se desplaza con el dedo: no se arrastra. Con `reduced`, Leaflet no anima zoom, teselas ni marcas.
 */
export function mapOptions(reduced: boolean, mobile: boolean): MapOptions {
  return {
    scrollWheelZoom: false,
    zoomControl: false,
    dragging: !mobile,
    ...(reduced ? { zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false } : {}),
  };
}
